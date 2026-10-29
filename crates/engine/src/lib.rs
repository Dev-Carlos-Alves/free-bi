//! Motor do Free BI: carga de dados, modelo semântico, DAX e consultas das visuais.
//!
//! A interface (Tauri ou servidor HTTP) fala com o motor por [`Engine::handle`],
//! que recebe um comando e argumentos JSON e devolve JSON.

pub mod dax;
mod engine;
pub mod load;
pub mod model;
mod pbix_import;
mod project;
pub mod transform;

pub use engine::{to_rows, Engine, Table};
pub use pbix_import::ImportSummary;

use anyhow::{anyhow, bail, Result};
use model::*;
use polars::prelude::*;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| anyhow!("argumento '{key}': {e}"))
}

fn opt<T: DeserializeOwned>(args: &Value, key: &str) -> Option<T> {
    args.get(key).cloned().and_then(|v| serde_json::from_value(v).ok())
}

impl Engine {
    /// Carrega um arquivo como uma ou mais tabelas (uma por planilha no Excel).
    pub fn load_file(&mut self, path: &str, sheets: Option<Vec<String>>) -> Result<Vec<String>> {
        let ext = load::extension(path);
        let base = load::table_name_from_path(path);
        let mut added = vec![];
        match ext.as_str() {
            "csv" | "txt" | "tsv" => {
                let df = load::read_csv(path)?;
                added.push(self.add_table(meta(&base, Source::Csv { path: path.into() }), df)?);
            }
            "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" => {
                let all = load::excel_sheets(path)?;
                let chosen = sheets.unwrap_or_else(|| all.clone());
                for sheet in chosen {
                    let df = load::read_excel(path, &sheet)?;
                    let name = if all.len() == 1 { base.clone() } else { sheet.clone() };
                    added.push(self.add_table(meta(&name, Source::Excel { path: path.into(), sheet }), df)?);
                }
            }
            "parquet" => {
                let df = load::read_parquet(path)?;
                added.push(self.add_table(meta(&base, Source::Parquet { path: path.into() }), df)?);
            }
            "json" | "ndjson" | "jsonl" => {
                let df = load::read_json(path)?;
                added.push(self.add_table(meta(&base, Source::Json { path: path.into() }), df)?);
            }
            other => bail!("formato .{other} não suportado (use CSV, Excel, Parquet, JSON ou .pbix)"),
        }
        Ok(added)
    }

    /// Relê os arquivos de origem (botão "Atualizar").
    pub fn refresh_sources(&mut self) -> Vec<String> {
        let mut errors = vec![];
        let names: Vec<String> = self.tables.keys().cloned().collect();
        for n in names {
            let src = self.tables[&n].meta.source.clone();
            if matches!(src, Source::Embedded) {
                continue;
            }
            match load::read_any(&src) {
                Ok(df) => self.tables.get_mut(&n).unwrap().raw = df,
                Err(e) => errors.push(format!("{n}: {e}")),
            }
        }
        self.refresh_all();
        errors
    }

    /// Sugere relações por colunas de mesmo nome (lado 1 = valores únicos).
    pub fn detect_relationships(&mut self) -> Vec<Relationship> {
        let mut found = vec![];
        let names: Vec<String> = self.tables.keys().cloned().collect();
        for a in &names {
            for b in &names {
                if a == b {
                    continue;
                }
                let (ta, tb) = (&self.tables[a].df, &self.tables[b].df);
                for ca in ta.get_column_names() {
                    let Some(cb) = tb.get_column_names().into_iter().find(|c| c.eq_ignore_ascii_case(ca)) else { continue };
                    let (sa, sb) = (ta.column(ca).unwrap(), tb.column(cb).unwrap());
                    let ub = sb.n_unique().unwrap_or(0);
                    let ua = sa.n_unique().unwrap_or(0);
                    let b_is_one = ub == tb.height() && tb.height() > 0;
                    let a_is_many = ta.height() > tb.height() || ua < ta.height();
                    let exists = self.relationships.iter().chain(found.iter()).any(|r: &Relationship| {
                        (r.from_table == *a && r.to_table == *b) || (r.from_table == *b && r.to_table == *a && r.from_column.eq_ignore_ascii_case(cb))
                    });
                    if b_is_one && a_is_many && !exists {
                        found.push(Relationship {
                            id: uuid::Uuid::new_v4().to_string(),
                            from_table: a.clone(),
                            from_column: ca.to_string(),
                            to_table: b.clone(),
                            to_column: cb.to_string(),
                            active: true,
                        });
                    }
                }
            }
        }
        self.relationships.extend(found.clone());
        found
    }

    pub fn model_json(&self) -> Value {
        let tables: Vec<Value> = self
            .tables
            .values()
            .map(|t| {
                let calc: Vec<&str> = t.meta.calc_columns.iter().map(|c| c.name.as_str()).collect();
                let imported: Vec<&str> = t.meta.imported_calc_columns.iter().map(|c| c.name.as_str()).collect();
                let cols: Vec<Value> = t
                    .df
                    .columns()
                    .iter()
                    .map(|c| {
                        json!({
                            "name": c.name().as_str(),
                            "dtype": transform::dtype_name(c.dtype()),
                            "calculated": calc.contains(&c.name().as_str()) || imported.contains(&c.name().as_str()),
                        })
                    })
                    .collect();
                json!({
                    "name": t.meta.name,
                    "rows": t.df.height(),
                    "columns": cols,
                    "source": t.meta.source,
                    "steps": t.meta.steps,
                    "calc_columns": t.meta.calc_columns,
                    "imported_calc_columns": t.meta.imported_calc_columns,
                    "origin_query": t.meta.origin_query,
                    "sort_by": t.meta.sort_by,
                    "errors": t.errors,
                })
            })
            .collect();
        json!({ "tables": tables, "measures": self.measures, "relationships": self.relationships })
    }

    fn table_mut(&mut self, name: &str) -> Result<&mut Table> {
        self.tables.get_mut(name).ok_or_else(|| anyhow!("tabela '{name}' não existe"))
    }

    /// Ponto único de entrada para a interface.
    pub fn handle(&mut self, cmd: &str, args: &Value) -> Result<Value> {
        Ok(match cmd {
            "model" => self.model_json(),
            "report_get" => self.report.clone(),
            "report_set" => {
                self.report = args.get("report").cloned().unwrap_or(Value::Null);
                Value::Null
            }
            "query" => {
                let q: VisualQuery = arg(args, "query")?;
                serde_json::to_value(self.query(&q)?)?
            }
            "queries" => {
                // Várias consultas de uma vez (uma página inteira); erros por visual.
                let qs: Vec<VisualQuery> = arg(args, "queries")?;
                Value::Array(
                    qs.iter()
                        .map(|q| match self.query(q) {
                            Ok(r) => json!({ "ok": r }),
                            Err(e) => json!({ "error": format!("{e:#}") }),
                        })
                        .collect(),
                )
            }
            "export_csv" => {
                // Exporta o resultado de uma visual em CSV no padrão do Excel brasileiro (; e vírgula decimal).
                let q: VisualQuery = arg(args, "query")?;
                let path: String = arg(args, "path")?;
                let mut q = q;
                q.limit = None;
                let r = self.query(&q)?;
                let cell = |v: &Value| -> String {
                    match v {
                        Value::Null => String::new(),
                        Value::Number(n) => n.to_string().replace('.', ","),
                        Value::String(s) if s.contains([';', '"', '\n']) => format!("\"{}\"", s.replace('"', "\"\"")),
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    }
                };
                let mut out = String::from("\u{feff}");
                out.push_str(&r.columns.iter().map(|c| c.name.clone()).collect::<Vec<_>>().join(";"));
                out.push('\n');
                for row in &r.rows {
                    out.push_str(&row.iter().map(cell).collect::<Vec<_>>().join(";"));
                    out.push('\n');
                }
                std::fs::write(&path, out)?;
                json!({ "rows": r.rows.len() })
            }
            "write_text" => {
                // Grava um arquivo de texto escolhido pelo usuário (ex.: tema JSON exportado).
                std::fs::write(arg::<String>(args, "path")?, arg::<String>(args, "text")?)?;
                Value::Null
            }
            "table_page" => {
                let table: String = arg(args, "table")?;
                let offset = opt::<usize>(args, "offset").unwrap_or(0);
                let limit = opt::<usize>(args, "limit").unwrap_or(200);
                let sort: Option<String> = opt(args, "sort");
                let desc = opt::<bool>(args, "desc").unwrap_or(false);
                serde_json::to_value(self.table_page(&table, offset, limit, sort.as_deref().map(|s| (s, desc)))?)?
            }
            "excel_sheets" => json!(load::excel_sheets(&arg::<String>(args, "path")?)?),
            "load_file" => {
                let added = self.load_file(&arg::<String>(args, "path")?, opt(args, "sheets"))?;
                let rels = if self.tables.len() > 1 { self.detect_relationships() } else { vec![] };
                json!({ "added": added, "relationships": rels })
            }
            "import_pbix" => serde_json::to_value(self.import_pbix(&arg::<String>(args, "path")?)?)?,
            "save_project" => {
                self.save_project(&arg::<String>(args, "path")?)?;
                Value::Null
            }
            "open_project" => {
                *self = Engine::load_project(&arg::<String>(args, "path")?)?;
                Value::Null
            }
            "new_project" => {
                *self = Engine::new();
                Value::Null
            }
            "refresh" => json!(self.refresh_sources()),
            "set_steps" => {
                let table: String = arg(args, "table")?;
                let steps: Vec<Step> = arg(args, "steps")?;
                self.table_mut(&table)?.meta.steps = steps;
                self.refresh_all();
                json!(self.table(&table)?.errors)
            }
            "add_step" => {
                let table: String = arg(args, "table")?;
                let step: Step = arg(args, "step")?;
                self.table_mut(&table)?.meta.steps.push(step);
                self.refresh_all();
                let errs = self.table(&table)?.errors.clone();
                if let Some(e) = errs.iter().find(|e| e.starts_with("Etapas")) {
                    self.table_mut(&table)?.meta.steps.pop();
                    self.refresh_all();
                    bail!("{e}");
                }
                Value::Null
            }
            "rename_table" => {
                let from: String = arg(args, "from")?;
                let to: String = arg(args, "to")?;
                if self.tables.contains_key(&to) {
                    bail!("já existe uma tabela chamada '{to}'");
                }
                let idx = self.tables.get_index_of(&from).ok_or_else(|| anyhow!("tabela '{from}' não existe"))?;
                let (_, mut t) = self.tables.shift_remove_index(idx).unwrap();
                t.meta.name = to.clone();
                self.tables.insert(to.clone(), t);
                let last = self.tables.len() - 1;
                self.tables.move_index(last, idx);
                for r in &mut self.relationships {
                    if r.from_table == from {
                        r.from_table = to.clone();
                    }
                    if r.to_table == from {
                        r.to_table = to.clone();
                    }
                }
                for m in &mut self.measures {
                    if m.table == from {
                        m.table = to.clone();
                    }
                    m.expression = rename_table_refs(&m.expression, &from, &to);
                }
                self.refresh_all();
                Value::Null
            }
            "delete_table" => {
                let name: String = arg(args, "name")?;
                self.tables.shift_remove(&name);
                self.relationships.retain(|r| r.from_table != name && r.to_table != name);
                Value::Null
            }
            "add_calc_column" => {
                let table: String = arg(args, "table")?;
                let c = CalcColumn { name: arg(args, "name")?, expression: arg(args, "expression")? };
                let t = self.table_mut(&table)?;
                t.meta.calc_columns.retain(|x| x.name != c.name);
                t.meta.calc_columns.push(c.clone());
                self.refresh_all();
                if let Some(e) = self.table(&table)?.errors.iter().find(|e| e.contains(&format!("[{}]", c.name))).cloned() {
                    self.table_mut(&table)?.meta.calc_columns.retain(|x| x.name != c.name);
                    self.refresh_all();
                    bail!("{e}");
                }
                Value::Null
            }
            "remove_calc_column" => {
                let table: String = arg(args, "table")?;
                let name: String = arg(args, "name")?;
                self.table_mut(&table)?.meta.calc_columns.retain(|x| x.name != name);
                self.refresh_all();
                Value::Null
            }
            "eval_measure" => self.eval_measure(&arg::<String>(args, "table")?, &arg::<String>(args, "expression")?)?,
            "set_measure" => {
                let m: Measure = arg(args, "measure")?;
                let old: Option<String> = opt(args, "old_name");
                let value = self.eval_measure(&m.table, &m.expression)?;
                let key = old.unwrap_or_else(|| m.name.clone());
                if let Some(existing) = self.measures.iter_mut().find(|x| x.name.eq_ignore_ascii_case(&key)) {
                    *existing = m;
                } else {
                    self.measures.push(m);
                }
                json!({ "value": value })
            }
            "delete_measure" => {
                let name: String = arg(args, "name")?;
                self.measures.retain(|m| m.name != name);
                Value::Null
            }
            "add_relationship" => {
                let mut r: Relationship = arg(args, "relationship")?;
                if r.id.is_empty() {
                    r.id = uuid::Uuid::new_v4().to_string();
                }
                let tf = self.table(&r.from_table)?;
                let tt = self.table(&r.to_table)?;
                if !tf.df.schema().contains(&r.from_column) || !tt.df.schema().contains(&r.to_column) {
                    bail!("coluna da relação não existe");
                }
                let uniq = tt.df.column(&r.to_column)?.n_unique()?;
                if uniq != tt.df.height() {
                    // Se o lado "1" tem repetições, tenta inverter a direção.
                    let uf = tf.df.column(&r.from_column)?.n_unique()?;
                    if uf == tf.df.height() {
                        r = Relationship {
                            id: r.id,
                            from_table: r.to_table,
                            from_column: r.to_column,
                            to_table: r.from_table,
                            to_column: r.from_column,
                            active: r.active,
                        };
                    } else {
                        bail!("relações muitos-para-muitos ainda não são suportadas: nenhuma das colunas tem valores únicos");
                    }
                }
                self.relationships.push(r.clone());
                serde_json::to_value(r)?
            }
            "delete_relationship" => {
                let id: String = arg(args, "id")?;
                self.relationships.retain(|r| r.id != id);
                Value::Null
            }
            "set_relationship_active" => {
                let id: String = arg(args, "id")?;
                let active: bool = arg(args, "active")?;
                for r in &mut self.relationships {
                    if r.id == id {
                        r.active = active;
                    }
                }
                Value::Null
            }
            "set_sort_by" => {
                let table: String = arg(args, "table")?;
                let column: String = arg(args, "column")?;
                let by: Option<String> = opt(args, "by");
                let t = self.table_mut(&table)?;
                match by {
                    Some(b) if !b.is_empty() => t.meta.sort_by.insert(column, b),
                    _ => t.meta.sort_by.remove(&column),
                };
                Value::Null
            }
            "detect_relationships" => serde_json::to_value(self.detect_relationships())?,
            "column_stats" => {
                let t = self.table(&arg::<String>(args, "table")?)?;
                let c = t.df.column(&arg::<String>(args, "column")?)?;
                let s = c.as_materialized_series();
                let num = s.dtype().is_primitive_numeric();
                json!({
                    "count": s.len(),
                    "nulls": s.null_count(),
                    "distinct": s.n_unique()?,
                    "min": if num { s.cast(&DataType::Float64)?.f64()?.min() } else { None },
                    "max": if num { s.cast(&DataType::Float64)?.f64()?.max() } else { None },
                })
            }
            _ => bail!("comando desconhecido: {cmd}"),
        })
    }
}

fn meta(name: &str, source: Source) -> TableMeta {
    TableMeta { name: name.into(), source, steps: vec![], calc_columns: vec![], imported_calc_columns: vec![], origin_query: None, sort_by: Default::default() }
}

/// Atualiza `Tabela[...]`/`'Tabela'[...]` numa expressão DAX após renomear a tabela.
fn rename_table_refs(expr: &str, from: &str, to: &str) -> String {
    let quoted_to = format!("'{}'", to.replace('\'', "''"));
    let mut out = expr.replace(&format!("'{}'", from.replace('\'', "''")), &quoted_to);
    let simple = from.chars().all(|c| c.is_alphanumeric() || c == '_');
    if simple {
        let mut res = String::new();
        let mut rest = out.as_str();
        while let Some(i) = rest.find(from) {
            let before = rest[..i].chars().last();
            let after = rest[i + from.len()..].chars().next();
            let boundary_before = before.is_none_or(|c| !(c.is_alphanumeric() || c == '_' || c == '\''));
            let boundary_after = after.is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
            res.push_str(&rest[..i]);
            if boundary_before && boundary_after {
                res.push_str(&quoted_to);
            } else {
                res.push_str(from);
            }
            rest = &rest[i + from.len()..];
        }
        res.push_str(rest);
        out = res;
    }
    out
}
