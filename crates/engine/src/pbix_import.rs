//! Converte um `.pbix` lido pelo `freebi-pbix` num modelo + relatório do Free BI.

use crate::engine::Engine;
use crate::model::*;
use crate::model::FieldRef;
use anyhow::Result;
use freebi_pbix::{ColumnValues, FieldProj, Pbix};
use polars::prelude::*;
use serde_json::{json, Value};

#[derive(Debug, serde::Serialize)]
pub struct ImportSummary {
    pub tables: usize,
    pub rows: usize,
    pub measures: usize,
    pub relationships: usize,
    pub pages: usize,
    pub visuals: usize,
    pub warnings: Vec<String>,
}

fn to_column(name: &str, v: &ColumnValues) -> Column {
    let n: PlSmallStr = name.into();
    match v {
        ColumnValues::Int(x) => Column::new(n, x),
        ColumnValues::Float(x) => Column::new(n, x),
        ColumnValues::Text(x) => Column::new(n, x),
        ColumnValues::Bool(x) => Column::new(n, x),
        ColumnValues::DateTime(x) => {
            // Datas OLE: dias desde 1899-12-30. 25569 = 1970-01-01.
            if x.iter().flatten().all(|d| d.fract() == 0.0) {
                let days: Vec<Option<i32>> = x.iter().map(|d| d.map(|d| (d - 25569.0) as i32)).collect();
                Column::new(n, days).cast(&DataType::Date).expect("date")
            } else {
                let ms: Vec<Option<i64>> = x.iter().map(|d| d.map(|d| ((d - 25569.0) * 86_400_000.0).round() as i64)).collect();
                Column::new(n, ms).cast(&DataType::Datetime(TimeUnit::Milliseconds, None)).expect("datetime")
            }
        }
    }
}

fn field(f: &FieldProj) -> Value {
    let (agg, date_part) = match f.aggregation.as_deref() {
        Some(a) if a.starts_with("date:") => {
            let part = match &a[5..] {
                "ano" | "year" => "year",
                "trimestre" | "quarter" => "quarter",
                "mês" | "mes" | "month" => "month",
                _ => "day",
            };
            (Value::Null, json!(part))
        }
        Some(a) => (json!(a), Value::Null),
        None => (Value::Null, Value::Null),
    };
    json!({
        "kind": if f.kind == "measure" { "measure" } else { "column" },
        "table": f.table,
        "name": f.name,
        "agg": agg,
        "date_part": date_part,
        "label": f.display_name,
    })
}

fn map_type(t: &str) -> &'static str {
    match t {
        "clusteredColumnChart" => "column",
        "columnChart" | "stackedColumnChart" => "stacked_column",
        "hundredPercentStackedColumnChart" => "stacked_column",
        "clusteredBarChart" => "bar",
        "barChart" | "stackedBarChart" | "hundredPercentStackedBarChart" => "stacked_bar",
        "lineChart" => "line",
        "areaChart" | "stackedAreaChart" => "area",
        "lineClusteredColumnComboChart" | "lineStackedColumnComboChart" => "combo",
        "pieChart" => "pie",
        "donutChart" => "donut",
        "card" | "cardVisual" | "kpi" | "multiRowCard" => "card",
        "tableEx" => "table",
        "pivotTable" => "matrix",
        "slicer" | "advancedSlicerVisual" => "slicer",
        "textbox" => "text",
        "scatterChart" => "scatter",
        "gauge" => "gauge",
        "funnel" => "funnel",
        "treemap" => "treemap",
        "waterfallChart" => "column",
        "shape" | "basicShape" | "image" | "actionButton" => "shape",
        _ => "unsupported",
    }
}

fn convert_report(p: &Pbix) -> Value {
    let theme = p.report.theme.as_ref().map(|t| {
        let page_bg = t["visualStyles"]["page"]["*"]["background"][0]["color"]["solid"]["color"].clone();
        let vis_bg = t["visualStyles"]["*"]["*"]["background"][0]["color"]["solid"]["color"].clone();
        json!({
            "name": t["name"],
            "colors": t["dataColors"],
            "background": t["background"],
            "foreground": t["foreground"],
            "table_accent": t["tableAccent"],
            "page_background": page_bg,
            "visual_background": vis_bg,
        })
    });
    let pages: Vec<Value> = p
        .report
        .pages
        .iter()
        .map(|pg| {
            let visuals: Vec<Value> = pg
                .visuals
                .iter()
                .map(|v| {
                    let ty = map_type(&v.visual_type);
                    let role = |names: &[&str]| -> Vec<Value> {
                        names.iter().flat_map(|n| v.projections.get(*n).into_iter().flatten()).map(field).collect()
                    };
                    let mut fields = serde_json::Map::new();
                    match ty {
                        "table" | "matrix" => {
                            fields.insert("rows".into(), json!(role(&["Rows"])));
                            fields.insert("columns".into(), json!(role(&["Values", "Columns"])));
                        }
                        "card" | "gauge" => {
                            fields.insert("values".into(), json!(role(&["Values", "Fields", "Data", "Y", "Indicator"])));
                        }
                        "slicer" => {
                            fields.insert("category".into(), json!(role(&["Values", "Category", "Field"])));
                        }
                        "scatter" => {
                            fields.insert("category".into(), json!(role(&["Category", "Details"])));
                            fields.insert("values".into(), json!(role(&["X", "Y", "Size"])));
                        }
                        _ => {
                            fields.insert("category".into(), json!(role(&["Category", "Axis", "Group"])));
                            fields.insert("values".into(), json!(role(&["Y", "Values"])));
                            fields.insert("values2".into(), json!(role(&["Y2"])));
                            fields.insert("legend".into(), json!(role(&["Series", "Legend"])));
                        }
                    }
                    let text: Vec<Value> = v
                        .paragraphs
                        .iter()
                        .map(|p| json!(p.iter().map(|r| json!({"value": r.value, "bold": r.bold, "size": r.font_size, "color": r.color})).collect::<Vec<_>>()))
                        .collect();
                    json!({
                        "id": v.name,
                        "type": ty,
                        "source_type": v.visual_type,
                        "x": v.x, "y": v.y, "w": v.width, "h": v.height,
                        "title": v.title,
                        "fields": fields,
                        "sort": v.sort.as_ref().map(|s| json!({"field": field(&s.field), "desc": s.descending})),
                        "text": text,
                        "options": {
                            "slicer_mode": v.slicer_mode.as_deref().map(|m| m.to_lowercase()),
                            "labels": true,
                        },
                    })
                })
                .collect();
            json!({
                "id": pg.name,
                "name": pg.display_name,
                "width": pg.width,
                "height": pg.height,
                "visuals": visuals,
            })
        })
        .collect();
    json!({ "theme": theme, "pages": pages })
}

impl Engine {
    /// Substitui o modelo atual pelo conteúdo de um `.pbix`.
    pub fn import_pbix(&mut self, path: &str) -> Result<ImportSummary> {
        let p = freebi_pbix::open(path)?;
        *self = Engine::new();
        let mut rows = 0;
        for t in &p.tables {
            let cols: Vec<Column> = t.columns.iter().map(|c| to_column(&c.name, &c.values)).collect();
            let h = cols.first().map(|c| c.len()).unwrap_or(0);
            rows += h;
            let df = DataFrame::new(h, cols)?;
            let imported: Vec<CalcColumn> = p
                .calc_columns
                .iter()
                .filter(|c| c.table == t.name)
                .map(|c| CalcColumn { name: c.name.clone(), expression: c.expression.clone() })
                .collect();
            let meta = TableMeta {
                name: t.name.clone(),
                source: Source::Embedded,
                steps: vec![],
                calc_columns: vec![],
                imported_calc_columns: imported,
                origin_query: p.queries.iter().find(|q| q.table == t.name).map(|q| q.expression.clone()),
            };
            self.tables.insert(t.name.clone(), crate::engine::Table { meta, df: df.clone(), raw: df, errors: vec![] });
        }
        self.relationships = p
            .relationships
            .iter()
            .enumerate()
            .map(|(i, r)| Relationship {
                id: format!("r{i}"),
                from_table: r.from_table.clone(),
                from_column: r.from_column.clone(),
                to_table: r.to_table.clone(),
                to_column: r.to_column.clone(),
                active: r.active,
            })
            .collect();
        self.measures = p
            .measures
            .iter()
            .map(|m| Measure {
                name: m.name.clone(),
                table: m.table.clone(),
                expression: m.expression.clone(),
                format: m.format_string.clone(),
                folder: m.display_folder.clone(),
            })
            .collect();
        self.report = convert_report(&p);

        let mut warnings = p.warnings.clone();
        for m in &self.measures {
            if let Err(e) = self.eval_measure(&m.table, &m.expression) {
                warnings.push(format!("Medida [{}] não suportada ainda: {e}", m.name));
            }
        }
        let visuals = p.report.pages.iter().map(|pg| pg.visuals.len()).sum();
        for pg in &p.report.pages {
            for v in &pg.visuals {
                if map_type(&v.visual_type) == "unsupported" {
                    warnings.push(format!("Visual '{}' ({}) ainda não é suportado", v.title.clone().unwrap_or_default(), v.visual_type));
                }
            }
        }
        Ok(ImportSummary {
            tables: self.tables.len(),
            rows,
            measures: self.measures.len(),
            relationships: self.relationships.len(),
            pages: p.report.pages.len(),
            visuals,
            warnings,
        })
    }
}
