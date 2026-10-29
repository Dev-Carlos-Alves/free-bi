//! Aplicação das etapas de transformação ("Power Query" simplificado).

use crate::model::{Cmp, DType, Step};
use anyhow::{bail, Result};
use polars::prelude::*;

pub fn dtype_of(d: DType) -> DataType {
    match d {
        DType::Text => DataType::String,
        DType::Integer => DataType::Int64,
        DType::Decimal => DataType::Float64,
        DType::Boolean => DataType::Boolean,
        DType::Date => DataType::Date,
        DType::DateTime => DataType::Datetime(TimeUnit::Milliseconds, None),
    }
}

pub fn dtype_name(d: &DataType) -> &'static str {
    match d {
        DataType::String => "text",
        DataType::Boolean => "boolean",
        DataType::Date => "date",
        DataType::Datetime(..) => "datetime",
        DataType::Float32 | DataType::Float64 => "decimal",
        d if d.is_integer() => "integer",
        DataType::Null => "text",
        _ => "text",
    }
}

/// Converte um valor JSON num literal comparável com a coluna.
pub fn json_lit(v: &serde_json::Value) -> Expr {
    match v {
        serde_json::Value::Null => lit(NULL),
        serde_json::Value::Bool(b) => lit(*b),
        serde_json::Value::Number(n) => match n.as_i64() {
            Some(i) => lit(i),
            None => lit(n.as_f64().unwrap_or(0.0)),
        },
        serde_json::Value::String(s) => lit(s.clone()),
        other => lit(other.to_string()),
    }
}

pub fn compare(e: Expr, cmp: Cmp, v: &serde_json::Value) -> Expr {
    let text = || e.clone().cast(DataType::String).str().to_lowercase();
    let pat = || lit(v.as_str().map(str::to_lowercase).unwrap_or_else(|| v.to_string()));
    // Textos comparados com número: compara como texto.
    let rhs = || {
        if v.is_string() {
            lit(v.as_str().unwrap().to_string())
        } else {
            json_lit(v)
        }
    };
    let lhs = || if v.is_string() { e.clone().cast(DataType::String) } else { e.clone() };
    match cmp {
        Cmp::Eq => lhs().eq(rhs()),
        Cmp::Ne => lhs().neq(rhs()),
        Cmp::Gt => lhs().gt(rhs()),
        Cmp::Ge => lhs().gt_eq(rhs()),
        Cmp::Lt => lhs().lt(rhs()),
        Cmp::Le => lhs().lt_eq(rhs()),
        Cmp::Contains => text().str().contains_literal(pat()),
        Cmp::NotContains => text().str().contains_literal(pat()).not(),
        Cmp::StartsWith => text().str().starts_with(pat()),
        Cmp::EndsWith => text().str().ends_with(pat()),
        Cmp::IsNull => e.is_null(),
        Cmp::NotNull => e.is_not_null(),
    }
}

pub fn apply_steps(df: DataFrame, steps: &[Step]) -> Result<DataFrame> {
    let mut lf = df.lazy();
    for s in steps {
        let schema = lf.collect_schema()?;
        let has = |c: &str| schema.contains(c);
        let need = |c: &str| -> Result<()> {
            if !has(c) {
                bail!("a coluna '{c}' não existe (etapa {s:?})");
            }
            Ok(())
        };
        lf = match s {
            Step::RemoveColumns { columns } => {
                let keep: Vec<Expr> = schema.iter_names().filter(|n| !columns.iter().any(|c| c == n.as_str())).map(|n| col(n.clone())).collect();
                lf.select(keep)
            }
            Step::KeepColumns { columns } => lf.select(columns.iter().filter(|c| has(c)).map(|c| col(c.as_str())).collect::<Vec<_>>()),
            Step::RenameColumn { from, to } => {
                need(from)?;
                lf.rename([from.as_str()], [to.as_str()], true)
            }
            Step::ChangeType { column, dtype } => {
                need(column)?;
                let target = dtype_of(*dtype);
                let src = schema.get(column).cloned().unwrap_or(DataType::String);
                let c = col(column.as_str());
                let e = match (&src, *dtype) {
                    // Texto com vírgula decimal (padrão brasileiro) → número.
                    (DataType::String, DType::Decimal | DType::Integer) => c
                        .str()
                        .replace_all(lit("."), lit(""), true)
                        .str()
                        .replace_all(lit(","), lit("."), true)
                        .cast(DataType::Float64)
                        .cast(target),
                    (DataType::String, DType::Date) => c.str().to_date(StrptimeOptions { strict: false, ..Default::default() }),
                    (DataType::String, DType::Boolean) => c.str().to_lowercase().is_in(lit(Series::new("t".into(), ["true", "sim", "1", "yes", "verdadeiro"])).implode(false), false),
                    _ => c.cast(target),
                };
                lf.with_column(e.alias(column.as_str()))
            }
            Step::FilterRows { column, cmp, value } => {
                need(column)?;
                lf.filter(compare(col(column.as_str()), *cmp, value).fill_null(lit(false)))
            }
            Step::ReplaceValue { column, find, replace } => {
                need(column)?;
                let c = col(column.as_str());
                let e = if schema.get(column) == Some(&DataType::String) {
                    c.str().replace_all(lit(find.clone()), lit(replace.clone()), true)
                } else {
                    let f: f64 = find.replace(',', ".").parse().unwrap_or(f64::NAN);
                    let r: f64 = replace.replace(',', ".").parse().unwrap_or(f64::NAN);
                    when(c.clone().cast(DataType::Float64).eq(lit(f))).then(lit(r)).otherwise(c.cast(DataType::Float64))
                };
                lf.with_column(e.alias(column.as_str()))
            }
            Step::FillNull { column, value } => {
                need(column)?;
                lf.with_column(col(column.as_str()).fill_null(json_lit(value)).alias(column.as_str()))
            }
            Step::RemoveNullRows { column } => {
                need(column)?;
                lf.filter(col(column.as_str()).is_not_null())
            }
            Step::RemoveDuplicates { columns } => {
                let subset = if columns.is_empty() { None } else { Some(cols(columns.clone())) };
                lf.unique_stable(subset, UniqueKeepStrategy::First)
            }
            Step::Trim { column } => {
                need(column)?;
                lf.with_column(col(column.as_str()).str().strip_chars(lit(NULL)).alias(column.as_str()))
            }
            Step::Uppercase { column } => {
                need(column)?;
                lf.with_column(col(column.as_str()).str().to_uppercase().alias(column.as_str()))
            }
            Step::Lowercase { column } => {
                need(column)?;
                lf.with_column(col(column.as_str()).str().to_lowercase().alias(column.as_str()))
            }
            Step::SplitColumn { column, delimiter } => {
                need(column)?;
                // Divide em duas colunas: antes e depois do primeiro delimitador.
                let parts = col(column.as_str()).cast(DataType::String).str().splitn(lit(delimiter.clone()), 2);
                lf.with_columns([
                    parts.clone().struct_().field_by_index(0).alias(format!("{column}.1")),
                    parts.struct_().field_by_index(1).alias(format!("{column}.2")),
                ])
            }
            Step::Sort { column, descending } => {
                need(column)?;
                lf.sort([column.as_str()], SortMultipleOptions::default().with_order_descending(*descending).with_nulls_last(true))
            }
            Step::KeepTopRows { n } => lf.limit(*n as u32),
        };
    }
    Ok(lf.collect()?)
}
