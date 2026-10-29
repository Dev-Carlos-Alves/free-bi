//! Estado do modelo e execução das consultas das visuais.

use crate::dax::{self, qual, Catalog, Compiler};
use crate::model::*;
use crate::model::FieldRef;
use crate::transform::{apply_steps, compare, dtype_name};
use anyhow::{anyhow, bail, Context, Result};
use indexmap::IndexMap;
use polars::prelude::*;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, VecDeque};

pub struct Table {
    pub meta: TableMeta,
    /// Dados como vieram da fonte (antes das etapas).
    pub raw: DataFrame,
    /// Dados finais (etapas + colunas calculadas).
    pub df: DataFrame,
    /// Erros ao aplicar etapas/colunas calculadas.
    pub errors: Vec<String>,
}

#[derive(Default)]
pub struct Engine {
    pub tables: IndexMap<String, Table>,
    pub relationships: Vec<Relationship>,
    pub measures: Vec<Measure>,
    /// Definição do relatório (páginas/visuais) — mantida pelo frontend.
    pub report: Value,
}

impl Engine {
    pub fn new() -> Self {
        Engine { report: Value::Null, ..Default::default() }
    }

    // ------------------------------------------------------------------ catálogo

    pub fn catalog(&self) -> Catalog {
        Catalog {
            columns: self
                .tables
                .iter()
                .map(|(n, t)| (n.clone(), t.df.get_column_names().iter().map(|c| c.to_string()).collect()))
                .collect(),
            measures: self.measures.iter().map(|m| (m.name.to_lowercase(), (m.table.clone(), m.expression.clone()))).collect(),
        }
    }

    pub fn table(&self, name: &str) -> Result<&Table> {
        self.tables.get(name).ok_or_else(|| anyhow!("tabela '{name}' não existe"))
    }

    // ------------------------------------------------------------------ tabelas

    pub fn add_table(&mut self, meta: TableMeta, raw: DataFrame) -> Result<String> {
        let mut name = meta.name.trim().to_string();
        if name.is_empty() {
            name = "Tabela".into();
        }
        let base = name.clone();
        let mut k = 2;
        while self.tables.contains_key(&name) {
            name = format!("{base} ({k})");
            k += 1;
        }
        let meta = TableMeta { name: name.clone(), ..meta };
        self.tables.insert(name.clone(), Table { meta, df: raw.clone(), raw, errors: vec![] });
        self.refresh_all();
        Ok(name)
    }

    /// Reaplica etapas e colunas calculadas de todas as tabelas.
    pub fn refresh_all(&mut self) {
        let names: Vec<String> = self.tables.keys().cloned().collect();
        for n in &names {
            let t = &self.tables[n];
            let (df, mut errors) = match apply_steps(t.raw.clone(), &t.meta.steps) {
                Ok(df) => (df, vec![]),
                Err(e) => (t.raw.clone(), vec![format!("Etapas: {e}")]),
            };
            let t = self.tables.get_mut(n).unwrap();
            t.df = df;
            t.errors.clear();
            t.errors.append(&mut errors);
        }
        for n in &names {
            let calcs = self.tables[n].meta.calc_columns.clone();
            for c in calcs {
                if let Err(e) = self.compute_calc_column(n, &c) {
                    self.tables.get_mut(n).unwrap().errors.push(format!("Coluna calculada [{}]: {e}", c.name));
                }
            }
        }
    }

    fn compute_calc_column(&mut self, table: &str, c: &CalcColumn) -> Result<()> {
        let cat = self.catalog();
        let comp = Compiler::new(&cat, table);
        let expr = comp.row(&dax::parse(&c.expression)?)?;
        let mut used = comp.tables.borrow().clone();
        used.insert(table.to_string());
        let lf = self.build_frame(table, &used)?;
        let out = lf.select([expr.alias("__calc")]).collect()?;
        let series = out.column("__calc")?.as_materialized_series().clone().with_name(c.name.as_str().into());
        let t = self.tables.get_mut(table).unwrap();
        if series.len() != t.df.height() {
            bail!("a coluna gerou {} linhas, a tabela tem {}", series.len(), t.df.height());
        }
        t.df.with_column(series.into_column())?;
        Ok(())
    }

    // ------------------------------------------------------------------ joins

    fn edges(&self) -> Vec<&Relationship> {
        self.relationships.iter().filter(|r| r.active).collect()
    }

    /// Caminho (sequência de relações) de `from` até `to`, seguindo N→1.
    fn path(&self, from: &str, to: &str) -> Option<Vec<&Relationship>> {
        if from == to {
            return Some(vec![]);
        }
        let edges = self.edges();
        let mut prev: HashMap<String, &Relationship> = HashMap::new();
        let mut q = VecDeque::from([from.to_string()]);
        let mut seen = BTreeSet::from([from.to_string()]);
        while let Some(cur) = q.pop_front() {
            for r in edges.iter().filter(|r| r.from_table == cur) {
                if seen.insert(r.to_table.clone()) {
                    prev.insert(r.to_table.clone(), r);
                    if r.to_table == to {
                        let mut path = vec![];
                        let mut node = to.to_string();
                        while node != from {
                            let r = prev[&node];
                            path.push(r);
                            node = r.from_table.clone();
                        }
                        path.reverse();
                        return Some(path);
                    }
                    q.push_back(r.to_table.clone());
                }
            }
        }
        None
    }

    fn choose_base(&self, used: &BTreeSet<String>, preferred: &[String]) -> Result<String> {
        let reaches_all = |b: &str| used.iter().all(|t| self.path(b, t).is_some());
        for p in preferred.iter().chain(used.iter()).chain(self.tables.keys()) {
            if self.tables.contains_key(p) && reaches_all(p) {
                return Ok(p.clone());
            }
        }
        let list: Vec<&str> = used.iter().map(|s| s.as_str()).collect();
        bail!("não há relação que ligue as tabelas {list:?}; crie a relação na visão Modelo")
    }

    fn qualified(&self, table: &str) -> Result<LazyFrame> {
        let t = self.table(table)?;
        let exprs: Vec<Expr> = t.df.get_column_names().iter().map(|c| col(c.as_str()).alias(qual(table, c))).collect();
        Ok(t.df.clone().lazy().select(exprs))
    }

    /// Frame com a tabela base e as tabelas relacionadas necessárias (left join).
    pub fn build_frame(&self, base: &str, used: &BTreeSet<String>) -> Result<LazyFrame> {
        let mut lf = self.qualified(base)?;
        let mut joined = BTreeSet::from([base.to_string()]);
        let mut n = 0;
        for t in used {
            let path = self.path(base, t).ok_or_else(|| anyhow!("sem relação entre '{base}' e '{t}'"))?;
            for r in path {
                if !joined.insert(r.to_table.clone()) {
                    continue;
                }
                let lt = self.table(&r.from_table)?.df.schema().get(&r.from_column).cloned();
                let rt = self.table(&r.to_table)?.df.schema().get(&r.to_column).cloned();
                let jk = format!("__jk{n}");
                n += 1;
                let (mut lk, mut rk) = (col(qual(&r.from_table, &r.from_column)), col(qual(&r.to_table, &r.to_column)));
                if lt != rt {
                    lk = lk.cast(DataType::String);
                    rk = rk.cast(DataType::String);
                }
                let lj = format!("{jk}l");
                let right = self.qualified(&r.to_table)?.with_column(rk.alias(jk.as_str()));
                lf = lf
                    .with_column(lk.alias(lj.as_str()))
                    .join(right, [col(lj.as_str())], [col(jk.as_str())], JoinArgs::new(JoinType::Left))
                    .drop(cols([lj.clone()]));
            }
        }
        Ok(lf)
    }

    // ------------------------------------------------------------------ consultas

    fn field_expr(&self, f: &FieldRef, used: &mut BTreeSet<String>) -> Result<Expr> {
        let t = self.table(&f.table)?;
        if !t.df.schema().contains(&f.column) {
            bail!("a coluna {}[{}] não existe", f.table, f.column);
        }
        used.insert(f.table.clone());
        let c = col(qual(&f.table, &f.column));
        Ok(match f.date_part {
            None => c,
            Some(DatePart::Year) => c.dt().year().cast(DataType::Int64),
            Some(DatePart::Quarter) => c.dt().quarter().cast(DataType::Int64),
            Some(DatePart::Month) => c.dt().month().cast(DataType::Int64),
            Some(DatePart::Day) => c.dt().day().cast(DataType::Int64),
        })
    }

    fn filter_expr(&self, f: &Filter, used: &mut BTreeSet<String>) -> Result<Expr> {
        let e = self.field_expr(&f.field, used)?;
        let set = |values: &[Value]| -> Expr {
            let strs: Vec<String> = values.iter().filter(|v| !v.is_null()).map(value_key).collect();
            let has_null = values.iter().any(|v| v.is_null());
            let mut m = e
                .clone()
                .cast(DataType::String)
                .is_in(lit(Series::new("v".into(), strs)).implode(false), false)
                .fill_null(lit(false));
            if has_null {
                m = m.or(e.clone().is_null());
            }
            m
        };
        Ok(match &f.kind {
            FilterKind::In { values } => set(values),
            FilterKind::NotIn { values } => set(values).not(),
            FilterKind::Range { min, max } => {
                let x = e.cast(DataType::Float64);
                let mut m = lit(true);
                if let Some(a) = min {
                    m = m.and(x.clone().gt_eq(lit(*a)));
                }
                if let Some(b) = max {
                    m = m.and(x.lt_eq(lit(*b)));
                }
                m.fill_null(lit(false))
            }
            FilterKind::Compare { cmp, value } => compare(e, *cmp, value).fill_null(lit(false)),
        })
    }

    pub fn query(&self, q: &VisualQuery) -> Result<QueryResult> {
        let cat = self.catalog();
        let mut used = BTreeSet::new();
        let mut preferred: Vec<String> = Vec::new();
        let mut value_exprs = Vec::new();
        let mut deferred = Vec::new();
        let mut names = Vec::new();

        for (i, v) in q.values.iter().enumerate() {
            let e = match v {
                ValueSpec::Measure { name } => {
                    let m = self
                        .measures
                        .iter()
                        .find(|m| m.name.eq_ignore_ascii_case(name))
                        .ok_or_else(|| anyhow!("medida [{name}] não existe"))?;
                    let mut comp = Compiler::new(&cat, &m.table);
                    comp.prefix = i.to_string();
                    let e = comp.measure(&m.expression).with_context(|| format!("medida [{}]", m.name))?;
                    let t = comp.tables.borrow().clone();
                    preferred.extend(t.iter().cloned());
                    used.extend(t);
                    for d in comp.deferred.into_inner() {
                        deferred.push(d.expr.alias(d.alias.as_str()));
                    }
                    names.push(m.name.clone());
                    e
                }
                ValueSpec::Column { field, agg } => {
                    let c = self.field_expr(field, &mut used)?;
                    preferred.push(field.table.clone());
                    names.push(field.column.clone());
                    match agg {
                        Agg::Sum => c.sum(),
                        Agg::Avg => c.mean(),
                        Agg::Min => c.min(),
                        Agg::Max => c.max(),
                        Agg::Count => c.count().cast(DataType::Int64),
                        Agg::DistinctCount => c.n_unique().cast(DataType::Int64),
                        Agg::None => c.first(),
                    }
                }
            };
            value_exprs.push(e.alias(format!("v{i}")));
        }

        let mut key_exprs = Vec::new();
        for (i, g) in q.group_by.iter().enumerate() {
            key_exprs.push(self.field_expr(g, &mut used)?.alias(format!("k{i}")));
            let label = match g.date_part {
                Some(DatePart::Year) => format!("{} (Ano)", g.column),
                Some(DatePart::Quarter) => format!("{} (Trimestre)", g.column),
                Some(DatePart::Month) => format!("{} (Mês)", g.column),
                Some(DatePart::Day) => format!("{} (Dia)", g.column),
                None => g.column.clone(),
            };
            names.insert(i, label);
        }
        let mut filters = Vec::new();
        for f in &q.filters {
            filters.push(self.filter_expr(f, &mut used)?);
        }
        if used.is_empty() {
            if let Some(m) = q.values.iter().find_map(|v| match v {
                ValueSpec::Measure { name } => self.measures.iter().find(|m| &m.name == name),
                _ => None,
            }) {
                used.insert(m.table.clone());
            } else {
                bail!("a visual não tem campos");
            }
        }

        let base = self.choose_base(&used, &preferred)?;
        let mut lf = self.build_frame(&base, &used)?;
        for f in filters {
            lf = lf.filter(f);
        }
        let filtered = lf.clone();
        if !deferred.is_empty() {
            lf = lf.with_columns(deferred.clone());
        }

        let nk = key_exprs.len();
        let mut df = if nk > 0 {
            if value_exprs.is_empty() {
                lf.select(key_exprs.clone()).unique(None, UniqueKeepStrategy::Any).collect()?
            } else {
                lf.group_by(key_exprs.clone()).agg(value_exprs.clone()).collect()?
            }
        } else {
            lf.select(value_exprs.clone()).collect()?
        };

        // Como no Power BI: grupos sem nenhum valor são ocultados.
        if nk > 0 && !q.values.is_empty() {
            let any = (0..q.values.len()).map(|i| col(format!("v{i}")).is_not_null()).reduce(|a, b| a.or(b)).unwrap();
            df = df.lazy().filter(any).collect()?;
        }

        // Ordenação.
        let width = df.width();
        let sort_col = match q.sort_by {
            Some(i) if i < width => Some(i),
            _ if nk > 0 => Some(0),
            _ => None,
        };
        if let Some(i) = sort_col {
            let name = df.get_column_names()[i].to_string();
            let desc = q.sort_by.is_some() && q.sort_desc;
            let mut by = vec![name.clone()];
            let mut descs = vec![desc];
            for k in 0..nk {
                let kn = format!("k{k}");
                if kn != name {
                    by.push(kn);
                    descs.push(false);
                }
            }
            df = df.sort(by, SortMultipleOptions::default().with_order_descending_multi(descs).with_nulls_last(true))?;
        }
        let row_count = df.height();
        if let Some(l) = q.limit {
            df = df.head(Some(l));
        }

        let total = if q.totals && !value_exprs.is_empty() {
            let mut t = filtered;
            if !deferred.is_empty() {
                t = t.with_columns(deferred);
            }
            let tdf = t.select(value_exprs).collect()?;
            let mut row: Vec<Value> = vec![Value::Null; nk];
            row.extend(to_rows(&tdf)?.into_iter().next().unwrap_or_default());
            Some(row)
        } else {
            None
        };

        let columns = df
            .columns()
            .iter()
            .zip(names.iter())
            .map(|(c, n)| ColumnInfo { name: n.clone(), dtype: dtype_name(c.dtype()).into() })
            .collect();
        Ok(QueryResult { columns, rows: to_rows(&df)?, total, row_count })
    }

    /// Página de dados de uma tabela (visão Dados).
    pub fn table_page(&self, name: &str, offset: usize, limit: usize, sort: Option<(&str, bool)>) -> Result<QueryResult> {
        let t = self.table(name)?;
        let mut df = t.df.clone();
        if let Some((c, desc)) = sort {
            df = df.sort([c], SortMultipleOptions::default().with_order_descending(desc).with_nulls_last(true))?;
        }
        let page = df.slice(offset as i64, limit);
        let columns = page
            .columns()
            .iter()
            .map(|c| ColumnInfo { name: c.name().to_string(), dtype: dtype_name(c.dtype()).into() })
            .collect();
        Ok(QueryResult { columns, rows: to_rows(&page)?, total: None, row_count: t.df.height() })
    }

    /// Avalia uma medida sem agrupamento (validação no editor).
    pub fn eval_measure(&self, table: &str, expression: &str) -> Result<Value> {
        let cat = self.catalog();
        let comp = Compiler::new(&cat, table);
        let e = comp.measure(expression)?;
        let mut used = comp.tables.borrow().clone();
        used.insert(table.to_string());
        let base = self.choose_base(&used, &[table.to_string()])?;
        let mut lf = self.build_frame(&base, &used)?;
        let deferred: Vec<Expr> = comp.deferred.into_inner().into_iter().map(|d| d.expr.alias(d.alias.as_str())).collect();
        if !deferred.is_empty() {
            lf = lf.with_columns(deferred);
        }
        let df = lf.select([e.alias("v")]).collect()?;
        Ok(to_rows(&df)?.into_iter().next().and_then(|r| r.into_iter().next()).unwrap_or(Value::Null))
    }
}

/// Chave textual usada para comparar valores selecionados com a coluna.
pub fn value_key(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else {
                let f = n.as_f64().unwrap_or(0.0);
                if f.fract() == 0.0 {
                    format!("{f:.1}")
                } else {
                    f.to_string()
                }
            }
        }
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

/// Converte um DataFrame em linhas JSON. Datas viram texto `AAAA-MM-DD`.
pub fn to_rows(df: &DataFrame) -> Result<Vec<Vec<Value>>> {
    let h = df.height();
    let mut cols: Vec<Vec<Value>> = Vec::with_capacity(df.width());
    for c in df.columns() {
        let s = c.as_materialized_series();
        let vals: Vec<Value> = match s.dtype() {
            DataType::Boolean => s.bool()?.iter().map(|v| v.map(Value::Bool).unwrap_or(Value::Null)).collect(),
            DataType::Float32 | DataType::Float64 => s
                .cast(&DataType::Float64)?
                .f64()?
                .iter()
                .map(|v| v.filter(|f| f.is_finite()).and_then(serde_json::Number::from_f64).map(Value::Number).unwrap_or(Value::Null))
                .collect(),
            d if d.is_integer() => s.cast(&DataType::Int64)?.i64()?.iter().map(|v| v.map(|i| Value::from(i)).unwrap_or(Value::Null)).collect(),
            DataType::String => s.str()?.iter().map(|v| v.map(|x| Value::String(x.to_string())).unwrap_or(Value::Null)).collect(),
            DataType::Datetime(..) => {
                let st = s.cast(&DataType::String)?;
                st.str()?
                    .iter()
                    .map(|v| v.map(|x| Value::String(x.to_string())).unwrap_or(Value::Null))
                    .collect()
            }
            _ => {
                let st = s.cast(&DataType::String)?;
                st.str()?.iter().map(|v| v.map(|x| Value::String(x.to_string())).unwrap_or(Value::Null)).collect()
            }
        };
        cols.push(vals);
    }
    let mut rows = Vec::with_capacity(h);
    for i in 0..h {
        rows.push(cols.iter().map(|c| c[i].clone()).collect());
    }
    Ok(rows)
}
