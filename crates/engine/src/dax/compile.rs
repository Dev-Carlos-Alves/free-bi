//! Compila a AST de DAX para expressões do Polars.
//!
//! Dois contextos, como no DAX: *agregação* (medidas, avaliadas por grupo da visual)
//! e *linha* (colunas calculadas, iteradores `SUMX`, filtros de `CALCULATE`).
//! As colunas aparecem no frame unificado com o nome qualificado `Tabela[Coluna]`.
//!
//! Limitação conhecida: `ALL`/`REMOVEFILTERS`/`ALLSELECTED` dentro de `CALCULATE`
//! removem o agrupamento da visual (viram total geral), mas os filtros da página continuam.

use super::parser::{parse, Ast, BinOp};
use anyhow::{anyhow, bail, Result};
use polars::prelude::*;
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};

pub fn qual(table: &str, col: &str) -> String {
    format!("{table}[{col}]")
}

/// Informações do modelo necessárias para resolver nomes.
pub struct Catalog {
    /// tabela → colunas
    pub columns: HashMap<String, Vec<String>>,
    /// nome da medida (minúsculo) → (tabela, expressão)
    pub measures: HashMap<String, (String, String)>,
}

impl Catalog {
    fn find_table(&self, name: &str) -> Option<String> {
        self.columns.keys().find(|t| t.eq_ignore_ascii_case(name)).cloned()
    }
    fn col_in(&self, table: &str, col: &str) -> Option<String> {
        self.columns.get(table)?.iter().find(|c| c.eq_ignore_ascii_case(col)).cloned()
    }
}

/// Uma agregação "fora do grupo" (ALL) que precisa ser calculada sobre o frame inteiro.
pub struct Deferred {
    pub alias: String,
    pub expr: Expr,
}

pub struct Compiler<'a> {
    pub cat: &'a Catalog,
    pub home: String,
    /// Prefixo para nomes de colunas auxiliares (únicos por visual).
    pub prefix: String,
    /// Tabelas referenciadas (para montar os joins).
    pub tables: RefCell<BTreeSet<String>>,
    pub deferred: RefCell<Vec<Deferred>>,
    vars: RefCell<Vec<HashMap<String, Expr>>>,
    depth: RefCell<usize>,
    parsed: RefCell<HashMap<String, Ast>>,
}

enum Resolved {
    Column(String, String),
    Measure(String),
}

fn and(a: Option<Expr>, b: Expr) -> Expr {
    match a {
        Some(a) => a.and(b),
        None => b,
    }
}

fn blank() -> Expr {
    lit(NULL).cast(DataType::Float64)
}

impl<'a> Compiler<'a> {
    pub fn new(cat: &'a Catalog, home: &str) -> Self {
        Compiler {
            cat,
            home: home.to_string(),
            prefix: String::new(),
            tables: RefCell::new(BTreeSet::new()),
            deferred: RefCell::new(Vec::new()),
            vars: RefCell::new(Vec::new()),
            depth: RefCell::new(0),
            parsed: RefCell::new(HashMap::new()),
        }
    }

    fn resolve(&self, table: &Option<String>, name: &str) -> Result<Resolved> {
        match table {
            Some(t) => {
                let tt = self.cat.find_table(t).ok_or_else(|| anyhow!("tabela '{t}' não existe"))?;
                if let Some(c) = self.cat.col_in(&tt, name) {
                    return Ok(Resolved::Column(tt, c));
                }
                if self.cat.measures.contains_key(&name.to_lowercase()) {
                    return Ok(Resolved::Measure(name.to_string()));
                }
                bail!("coluna '{t}'[{name}] não existe")
            }
            None => {
                if self.cat.measures.contains_key(&name.to_lowercase()) {
                    return Ok(Resolved::Measure(name.to_string()));
                }
                if let Some(c) = self.cat.col_in(&self.home, name) {
                    return Ok(Resolved::Column(self.home.clone(), c));
                }
                let hits: Vec<(String, String)> = self
                    .cat
                    .columns
                    .keys()
                    .filter_map(|t| self.cat.col_in(t, name).map(|c| (t.clone(), c)))
                    .collect();
                match hits.len() {
                    1 => Ok(Resolved::Column(hits[0].0.clone(), hits[0].1.clone())),
                    0 => bail!("[{name}] não é medida nem coluna conhecida"),
                    _ => bail!("[{name}] é ambíguo; use Tabela[{name}]"),
                }
            }
        }
    }

    fn column(&self, t: &str, c: &str) -> Expr {
        self.tables.borrow_mut().insert(t.to_string());
        col(qual(t, c))
    }

    fn lookup_var(&self, name: &str) -> Option<Expr> {
        self.vars.borrow().iter().rev().find_map(|s| s.get(&name.to_lowercase()).cloned())
    }

    fn measure_ast(&self, name: &str) -> Result<Ast> {
        let key = name.to_lowercase();
        if let Some(a) = self.parsed.borrow().get(&key) {
            return Ok(a.clone());
        }
        let (_, src) = self.cat.measures.get(&key).ok_or_else(|| anyhow!("medida [{name}] não existe"))?;
        let ast = parse(src).map_err(|e| anyhow!("na medida [{name}]: {e}"))?;
        self.parsed.borrow_mut().insert(key, ast.clone());
        Ok(ast)
    }

    // ------------------------------------------------------------ contexto de agregação

    /// Compila uma medida inteira.
    pub fn measure(&self, src: &str) -> Result<Expr> {
        let ast = parse(src)?;
        self.agg(&ast, None)
    }

    pub fn agg(&self, ast: &Ast, mask: Option<Expr>) -> Result<Expr> {
        Ok(match ast {
            Ast::Num(n) => lit(*n),
            Ast::Str(s) => lit(s.clone()),
            Ast::Bool(b) => lit(*b),
            Ast::Var(v) => self.lookup_var(v).ok_or_else(|| anyhow!("variável '{v}' não definida"))?,
            Ast::Let { vars, body } => {
                self.vars.borrow_mut().push(HashMap::new());
                for (n, e) in vars {
                    let ex = self.agg(e, mask.clone())?;
                    self.vars.borrow_mut().last_mut().unwrap().insert(n.to_lowercase(), ex);
                }
                let r = self.agg(body, mask);
                self.vars.borrow_mut().pop();
                r?
            }
            Ast::Ref { table, name } => match self.resolve(table, name)? {
                Resolved::Measure(m) => {
                    if *self.depth.borrow() > 32 {
                        bail!("referência circular entre medidas envolvendo [{m}]");
                    }
                    let a = self.measure_ast(&m)?;
                    *self.depth.borrow_mut() += 1;
                    let r = self.agg(&a, mask);
                    *self.depth.borrow_mut() -= 1;
                    r?
                }
                Resolved::Column(t, c) => {
                    bail!("a coluna {t}[{c}] precisa de uma agregação (ex.: SUM({t}[{c}])) numa medida")
                }
            },
            Ast::Table(t) => bail!("tabela '{t}' usada onde se esperava um valor"),
            Ast::Neg(e) => lit(0.0) - self.agg(e, mask)?,
            Ast::Not(e) => self.agg(e, mask)?.not(),
            Ast::Bin { op, l, r } => bin(*op, self.agg(l, mask.clone())?, self.agg(r, mask)?),
            Ast::In { e, list } => {
                let v = self.agg(e, mask)?;
                in_list(v, list)?
            }
            Ast::Call { name, args } => self.agg_call(name, args, mask)?,
        })
    }

    fn arg<'b>(&self, args: &'b [Ast], i: usize, f: &str) -> Result<&'b Ast> {
        args.get(i).ok_or_else(|| anyhow!("{f}: faltam argumentos"))
    }

    /// `T` ou `FILTER(T, cond)` → máscara de linha opcional.
    fn table_arg(&self, a: &Ast) -> Result<Option<Expr>> {
        match a {
            Ast::Table(t) | Ast::Var(t) => {
                let tt = self.cat.find_table(t).ok_or_else(|| anyhow!("tabela '{t}' não existe"))?;
                self.tables.borrow_mut().insert(tt);
                Ok(None)
            }
            Ast::Call { name, args } if name == "FILTER" => {
                let inner = self.table_arg(self.arg(args, 0, "FILTER")?)?;
                let cond = self.row(self.arg(args, 1, "FILTER")?)?.fill_null(lit(false));
                Ok(Some(and(inner, cond)))
            }
            Ast::Call { name, args } if matches!(name.as_str(), "ALL" | "ALLSELECTED" | "VALUES" | "DISTINCT" | "RELATEDTABLE") => {
                if let Some(a0) = args.first() {
                    if let Ast::Table(_) = a0 {
                        return self.table_arg(a0);
                    }
                }
                Ok(None)
            }
            Ast::Call { name, args } if name == "CALCULATETABLE" => {
                let mut m = self.table_arg(self.arg(args, 0, "CALCULATETABLE")?)?;
                for f in &args[1..] {
                    m = Some(and(m, self.row(f)?.fill_null(lit(false))));
                }
                Ok(m)
            }
            other => bail!("esperava uma tabela, encontrei {other:?}"),
        }
    }

    fn agg_call(&self, name: &str, args: &[Ast], mask: Option<Expr>) -> Result<Expr> {
        let filt = |e: Expr, m: &Option<Expr>| match m {
            Some(m) => e.filter(m.clone()),
            None => e,
        };
        Ok(match name {
            "SUM" | "AVERAGE" | "MIN" | "MAX" | "MEDIAN" | "COUNT" | "COUNTA" | "DISTINCTCOUNT" | "COUNTBLANK" | "DISTINCTCOUNTNOBLANK" => {
                let e = filt(self.row(self.arg(args, 0, name)?)?, &mask);
                reduce(name.trim_end_matches('A').trim_end_matches("NOBLANK"), e, name)
            }
            "SUMX" | "AVERAGEX" | "MINX" | "MAXX" | "MEDIANX" | "COUNTX" | "COUNTAX" => {
                let m = self.table_arg(self.arg(args, 0, name)?)?;
                let m = match (mask, m) {
                    (Some(a), Some(b)) => Some(a.and(b)),
                    (a, b) => a.or(b),
                };
                let e = filt(self.row(self.arg(args, 1, name)?)?, &m);
                let base = &name[..name.len() - 1];
                reduce(base.trim_end_matches('A'), e, name)
            }
            "COUNTROWS" => {
                let m = match args.first() {
                    Some(a) => self.table_arg(a)?,
                    None => {
                        self.tables.borrow_mut().insert(self.home.clone());
                        None
                    }
                };
                match (mask, m) {
                    (Some(a), Some(b)) => a.and(b).cast(DataType::Int64).sum(),
                    (Some(a), None) | (None, Some(a)) => a.cast(DataType::Int64).sum(),
                    (None, None) => len().cast(DataType::Int64),
                }
            }
            "CALCULATE" => {
                let mut m = mask;
                let mut remove_group = false;
                for f in &args[1..] {
                    match f {
                        Ast::Call { name, .. } if matches!(name.as_str(), "ALL" | "REMOVEFILTERS" | "ALLSELECTED" | "ALLEXCEPT") => {
                            remove_group = true;
                        }
                        Ast::Call { name, args } if name == "KEEPFILTERS" => {
                            m = Some(and(m, self.row(self.arg(args, 0, "KEEPFILTERS")?)?.fill_null(lit(false))));
                        }
                        Ast::Call { name, .. } if name == "FILTER" => {
                            if let Some(x) = self.table_arg(f)? {
                                m = Some(and(m, x));
                            }
                        }
                        Ast::Call { name, .. } if name == "USERELATIONSHIP" || name == "CROSSFILTER" => {}
                        other => m = Some(and(m, self.row(other)?.fill_null(lit(false)))),
                    }
                }
                let inner = self.agg(self.arg(args, 0, "CALCULATE")?, m)?;
                if remove_group {
                    let alias = format!("__all{}_{}", self.prefix, self.deferred.borrow().len());
                    self.deferred.borrow_mut().push(Deferred { alias: alias.clone(), expr: inner });
                    col(alias).first()
                } else {
                    inner
                }
            }
            "DIVIDE" => {
                let a = self.agg(self.arg(args, 0, name)?, mask.clone())?.cast(DataType::Float64);
                let b = self.agg(self.arg(args, 1, name)?, mask.clone())?.cast(DataType::Float64);
                let alt = match args.get(2) {
                    Some(x) => self.agg(x, mask)?.cast(DataType::Float64),
                    None => blank(),
                };
                when(b.clone().eq(lit(0.0)).or(b.clone().is_null())).then(alt).otherwise(a / b)
            }
            "IF" => {
                let c = self.agg(self.arg(args, 0, name)?, mask.clone())?;
                let t = self.agg(self.arg(args, 1, name)?, mask.clone())?;
                let e = match args.get(2) {
                    Some(x) => self.agg(x, mask)?,
                    None => blank(),
                };
                when(c.fill_null(lit(false))).then(t).otherwise(e)
            }
            "SWITCH" => {
                let compiled: Result<Vec<Expr>> = args.iter().map(|a| self.agg(a, mask.clone())).collect();
                switch(compiled?, matches!(args.first(), Some(Ast::Bool(true))))?
            }
            "SELECTEDVALUE" | "FIRSTNONBLANK" | "VALUES" => {
                let e = filt(self.row(self.arg(args, 0, name)?)?, &mask);
                let alt = match args.get(1) {
                    Some(x) if name == "SELECTEDVALUE" => self.agg(x, None)?,
                    _ => lit(NULL),
                };
                when(e.clone().n_unique().eq(lit(1u32))).then(e.first()).otherwise(alt)
            }
            "HASONEVALUE" => filt(self.row(self.arg(args, 0, name)?)?, &mask).n_unique().eq(lit(1u32)),
            "ISBLANK" => self.agg(self.arg(args, 0, name)?, mask)?.is_null(),
            "BLANK" => blank(),
            "AND" => self.agg(self.arg(args, 0, name)?, mask.clone())?.and(self.agg(self.arg(args, 1, name)?, mask)?),
            "OR" => self.agg(self.arg(args, 0, name)?, mask.clone())?.or(self.agg(self.arg(args, 1, name)?, mask)?),
            "NOT" => self.agg(self.arg(args, 0, name)?, mask)?.not(),
            "COALESCE" => {
                let mut it = args.iter().rev();
                let mut acc = self.agg(it.next().ok_or_else(|| anyhow!("COALESCE vazio"))?, mask.clone())?;
                for a in it {
                    acc = self.agg(a, mask.clone())?.fill_null(acc);
                }
                acc
            }
            _ => scalar_fn(name, args.iter().map(|a| self.agg(a, mask.clone())).collect::<Result<Vec<_>>>()?)?,
        })
    }

    // ------------------------------------------------------------ contexto de linha

    pub fn row(&self, ast: &Ast) -> Result<Expr> {
        Ok(match ast {
            Ast::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 9e15 {
                    lit(*n as i64)
                } else {
                    lit(*n)
                }
            }
            Ast::Str(s) => lit(s.clone()),
            Ast::Bool(b) => lit(*b),
            Ast::Var(v) => self.lookup_var(v).ok_or_else(|| anyhow!("variável '{v}' não definida"))?,
            Ast::Let { vars, body } => {
                self.vars.borrow_mut().push(HashMap::new());
                for (n, e) in vars {
                    let ex = self.row(e)?;
                    self.vars.borrow_mut().last_mut().unwrap().insert(n.to_lowercase(), ex);
                }
                let r = self.row(body);
                self.vars.borrow_mut().pop();
                r?
            }
            Ast::Ref { table, name } => match self.resolve(table, name)? {
                Resolved::Column(t, c) => self.column(&t, &c),
                Resolved::Measure(m) => bail!("a medida [{m}] não pode ser usada linha a linha (contexto de linha)"),
            },
            Ast::Table(t) => bail!("tabela '{t}' usada onde se esperava um valor"),
            Ast::Neg(e) => lit(0) - self.row(e)?,
            Ast::Not(e) => self.row(e)?.not(),
            Ast::Bin { op, l, r } => bin(*op, self.row(l)?, self.row(r)?),
            Ast::In { e, list } => in_list(self.row(e)?, list)?,
            Ast::Call { name, args } => {
                let a = |i: usize| -> Result<Expr> { self.row(self.arg(args, i, name)?) };
                match name.as_str() {
                    "RELATED" => a(0)?,
                    "IF" => {
                        let e = if args.len() > 2 { a(2)? } else { lit(NULL) };
                        when(a(0)?.fill_null(lit(false))).then(a(1)?).otherwise(e)
                    }
                    "SWITCH" => {
                        let compiled: Result<Vec<Expr>> = args.iter().map(|x| self.row(x)).collect();
                        switch(compiled?, matches!(args.first(), Some(Ast::Bool(true))))?
                    }
                    "DIVIDE" => {
                        let x = a(0)?.cast(DataType::Float64);
                        let y = a(1)?.cast(DataType::Float64);
                        let alt = if args.len() > 2 { a(2)?.cast(DataType::Float64) } else { blank() };
                        when(y.clone().eq(lit(0.0)).or(y.clone().is_null())).then(alt).otherwise(x / y)
                    }
                    "ISBLANK" => a(0)?.is_null(),
                    "BLANK" => lit(NULL),
                    "AND" => a(0)?.and(a(1)?),
                    "OR" => a(0)?.or(a(1)?),
                    "NOT" => a(0)?.not(),
                    "COALESCE" => {
                        let mut acc = a(args.len() - 1)?;
                        for i in (0..args.len() - 1).rev() {
                            acc = a(i)?.fill_null(acc);
                        }
                        acc
                    }
                    "YEAR" => a(0)?.dt().year().cast(DataType::Int64),
                    "MONTH" => a(0)?.dt().month().cast(DataType::Int64),
                    "DAY" => a(0)?.dt().day().cast(DataType::Int64),
                    "QUARTER" => a(0)?.dt().quarter().cast(DataType::Int64),
                    "WEEKDAY" => {
                        // Polars: segunda=1..domingo=7. DAX tipo 1 (padrão): domingo=1..sábado=7.
                        let wd = a(0)?.dt().weekday().cast(DataType::Int64);
                        let kind = match args.get(1) {
                            Some(Ast::Num(n)) => *n as i64,
                            _ => 1,
                        };
                        match kind {
                            2 => wd,
                            3 => wd - lit(1),
                            _ => (wd % lit(7)) + lit(1),
                        }
                    }
                    "UPPER" => a(0)?.cast(DataType::String).str().to_uppercase(),
                    "LOWER" => a(0)?.cast(DataType::String).str().to_lowercase(),
                    "TRIM" => a(0)?.cast(DataType::String).str().strip_chars(lit(NULL)),
                    "LEN" => a(0)?.cast(DataType::String).str().len_chars().cast(DataType::Int64),
                    "LEFT" => a(0)?.cast(DataType::String).str().head(a(1)?),
                    "RIGHT" => a(0)?.cast(DataType::String).str().tail(a(1)?),
                    "MID" => a(0)?.cast(DataType::String).str().slice(a(1)? - lit(1), a(2)?),
                    "CONTAINSSTRING" => a(0)?.cast(DataType::String).str().to_lowercase().str().contains_literal(a(1)?.str().to_lowercase()),
                    "CONCATENATE" => concat_str([a(0)?.cast(DataType::String), a(1)?.cast(DataType::String)], "", true),
                    "VALUE" => a(0)?.cast(DataType::Float64),
                    _ => scalar_fn(name, args.iter().map(|x| self.row(x)).collect::<Result<Vec<_>>>()?)?,
                }
            }
        })
    }
}

fn reduce(kind: &str, e: Expr, name: &str) -> Expr {
    match kind {
        "SUM" => e.sum(),
        "AVERAGE" => e.mean(),
        "MIN" => e.min(),
        "MAX" => e.max(),
        "MEDIAN" => e.median(),
        "COUNT" => e.count().cast(DataType::Int64),
        "DISTINCTCOUNT" if name.ends_with("NOBLANK") => e.drop_nulls().n_unique().cast(DataType::Int64),
        "DISTINCTCOUNT" => e.n_unique().cast(DataType::Int64),
        "COUNTBLANK" | "COUNTBL" => e.null_count().cast(DataType::Int64),
        _ => e.sum(),
    }
}

fn scalar_fn(name: &str, a: Vec<Expr>) -> Result<Expr> {
    let get = |i: usize| a.get(i).cloned().ok_or_else(|| anyhow!("{name}: faltam argumentos"));
    Ok(match name {
        "ABS" => get(0)?.abs(),
        "ROUND" => {
            let digits = 0u32;
            let _ = digits;
            // Arredonda com número de casas literal (o caso comum).
            get(0)?.cast(DataType::Float64).round(0, RoundMode::HalfAwayFromZero)
        }
        "INT" | "TRUNC" => get(0)?.cast(DataType::Float64).floor().cast(DataType::Int64),
        "SQRT" => get(0)?.cast(DataType::Float64).sqrt(),
        "POWER" => get(0)?.cast(DataType::Float64).pow(get(1)?),
        "MOD" => get(0)? % get(1)?,
        "TRUE" => lit(true),
        "FALSE" => lit(false),
        _ => bail!("função {name} ainda não suportada pelo Free BI"),
    })
}

fn switch(mut a: Vec<Expr>, is_true: bool) -> Result<Expr> {
    if a.len() < 3 {
        bail!("SWITCH precisa de pelo menos 3 argumentos");
    }
    let subject = a.remove(0);
    let default = if a.len() % 2 == 1 { a.pop().unwrap() } else { lit(NULL) };
    let mut acc = default;
    for pair in a.chunks(2).rev() {
        let cond = if is_true { pair[0].clone() } else { subject.clone().eq(pair[0].clone()) };
        acc = when(cond.fill_null(lit(false))).then(pair[1].clone()).otherwise(acc);
    }
    Ok(acc)
}

fn in_list(v: Expr, list: &[Ast]) -> Result<Expr> {
    let mut acc: Option<Expr> = None;
    for item in list {
        let e = match item {
            Ast::Num(n) => v.clone().cast(DataType::Float64).eq(lit(*n)),
            Ast::Str(s) => v.clone().cast(DataType::String).eq(lit(s.clone())),
            Ast::Bool(b) => v.clone().eq(lit(*b)),
            other => bail!("IN aceita apenas valores literais, encontrei {other:?}"),
        };
        acc = Some(match acc {
            Some(a) => a.or(e),
            None => e,
        });
    }
    Ok(acc.unwrap_or(lit(false)))
}

fn bin(op: BinOp, l: Expr, r: Expr) -> Expr {
    match op {
        BinOp::Add => l + r,
        BinOp::Sub => l - r,
        BinOp::Mul => l * r,
        BinOp::Div => l.cast(DataType::Float64) / r.cast(DataType::Float64),
        BinOp::Pow => l.cast(DataType::Float64).pow(r),
        BinOp::Concat => concat_str([l.cast(DataType::String), r.cast(DataType::String)], "", true),
        BinOp::Eq => l.eq(r),
        BinOp::Ne => l.neq(r),
        BinOp::Lt => l.lt(r),
        BinOp::Le => l.lt_eq(r),
        BinOp::Gt => l.gt(r),
        BinOp::Ge => l.gt_eq(r),
        BinOp::And => l.and(r),
        BinOp::Or => l.or(r),
    }
}
