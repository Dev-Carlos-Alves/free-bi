//! Layout do relatório: formato PBIR (`Report/definition/**`) e legado (`Report/Layout`).

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub struct ReportDef {
    pub pages: Vec<PageDef>,
    /// Tema personalizado (JSON do tema do Power BI), se houver.
    pub theme: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageDef {
    pub name: String,
    pub display_name: String,
    pub width: f64,
    pub height: f64,
    pub visuals: Vec<VisualDef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisualDef {
    pub name: String,
    pub visual_type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z: f64,
    pub title: Option<String>,
    /// Papel (Category, Y, Values, Series, Rows, Columns...) → campos.
    pub projections: BTreeMap<String, Vec<FieldProj>>,
    pub sort: Option<SortDef>,
    /// Parágrafos de caixas de texto.
    pub paragraphs: Vec<Vec<TextRun>>,
    pub slicer_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldProj {
    pub table: String,
    pub name: String,
    /// "column", "measure" ou "aggregation".
    pub kind: String,
    /// Para "aggregation": sum, avg, count, distinct_count, min, max...
    pub aggregation: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SortDef {
    pub field: FieldProj,
    pub descending: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextRun {
    pub value: String,
    pub bold: bool,
    pub font_size: Option<f64>,
    pub color: Option<String>,
}

fn agg_name(f: i64) -> &'static str {
    match f {
        0 => "sum",
        1 => "avg",
        2 => "distinct_count",
        3 => "min",
        4 => "max",
        5 => "count",
        6 => "median",
        _ => "sum",
    }
}

/// Converte um campo de consulta (`{"Column": ...}`, `{"Measure": ...}`, `{"Aggregation": ...}`).
pub fn field_from(v: &Value, aliases: &BTreeMap<String, String>) -> Option<FieldProj> {
    let entity = |e: &Value| -> String {
        let sr = &e["Expression"]["SourceRef"];
        sr["Entity"]
            .as_str()
            .map(str::to_string)
            .or_else(|| sr["Source"].as_str().and_then(|a| aliases.get(a).cloned()))
            .unwrap_or_default()
    };
    if let Some(c) = v.get("Column") {
        return Some(FieldProj {
            table: entity(c),
            name: c["Property"].as_str()?.to_string(),
            kind: "column".into(),
            aggregation: None,
            display_name: None,
        });
    }
    if let Some(m) = v.get("Measure") {
        return Some(FieldProj {
            table: entity(m),
            name: m["Property"].as_str()?.to_string(),
            kind: "measure".into(),
            aggregation: None,
            display_name: None,
        });
    }
    if let Some(a) = v.get("Aggregation") {
        let mut inner = field_from(&a["Expression"], aliases)?;
        inner.kind = "aggregation".into();
        inner.aggregation = Some(agg_name(a["Function"].as_i64().unwrap_or(0)).into());
        return Some(inner);
    }
    if let Some(h) = v.get("HierarchyLevel") {
        // Hierarquia de datas automática: Tabela.Coluna.Variation.Date Hierarchy.Ano
        let level = h["Level"].as_str().unwrap_or_default().to_string();
        let hier = &h["Expression"]["Hierarchy"];
        let col = hier["Expression"]["PropertyVariationSource"]["Property"].as_str().unwrap_or_default().to_string();
        let table = hier["Expression"]["PropertyVariationSource"]["Expression"]["SourceRef"]["Entity"]
            .as_str()
            .map(str::to_string)
            .or_else(|| {
                hier["Expression"]["PropertyVariationSource"]["Expression"]["SourceRef"]["Source"]
                    .as_str()
                    .and_then(|a| aliases.get(a).cloned())
            })
            .unwrap_or_default();
        return Some(FieldProj {
            table,
            name: col,
            kind: "column".into(),
            aggregation: Some(format!("date:{}", level.to_lowercase())),
            display_name: None,
        });
    }
    None
}

fn literal(v: &Value) -> Option<String> {
    let s = v["expr"]["Literal"]["Value"].as_str()?;
    Some(s.trim_matches('\'').to_string())
}

fn title_of(visual: &Value) -> Option<String> {
    for path in [&visual["visualContainerObjects"]["title"], &visual["vcObjects"]["title"]] {
        if let Some(arr) = path.as_array() {
            for t in arr {
                if let Some(s) = literal(&t["properties"]["text"]) {
                    return Some(s);
                }
            }
        }
    }
    None
}

fn paragraphs_of(objects: &Value) -> Vec<Vec<TextRun>> {
    let mut out = Vec::new();
    let Some(general) = objects["general"].as_array() else { return out };
    for g in general {
        let Some(ps) = g["properties"]["paragraphs"].as_array() else { continue };
        for p in ps {
            let runs = p["textRuns"]
                .as_array()
                .map(|rs| {
                    rs.iter()
                        .map(|r| {
                            let st = &r["textStyle"];
                            TextRun {
                                value: r["value"].as_str().unwrap_or_default().to_string(),
                                bold: st["fontWeight"].as_str() == Some("bold"),
                                font_size: st["fontSize"].as_str().and_then(|s| s.trim_end_matches("pt").parse().ok()),
                                color: st["color"].as_str().map(str::to_string),
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            out.push(runs);
        }
    }
    out
}

/// Visual no formato PBIR (`visual.json`).
pub fn visual_from_pbir(v: &Value) -> VisualDef {
    let pos = &v["position"];
    let visual = &v["visual"];
    let aliases = BTreeMap::new();
    let mut projections = BTreeMap::new();
    if let Some(qs) = visual["query"]["queryState"].as_object() {
        for (role, r) in qs {
            let fields: Vec<FieldProj> = r["projections"]
                .as_array()
                .map(|ps| {
                    ps.iter()
                        .filter_map(|p| {
                            let mut f = field_from(&p["field"], &aliases)?;
                            f.display_name = p["displayName"].as_str().map(str::to_string);
                            Some(f)
                        })
                        .collect()
                })
                .unwrap_or_default();
            projections.insert(role.clone(), fields);
        }
    }
    let sort = visual["query"]["sortDefinition"]["sort"].as_array().and_then(|s| s.first()).and_then(|s| {
        Some(SortDef { field: field_from(&s["field"], &aliases)?, descending: s["direction"].as_str() == Some("Descending") })
    });
    VisualDef {
        name: v["name"].as_str().unwrap_or_default().to_string(),
        visual_type: visual["visualType"].as_str().unwrap_or("unknown").to_string(),
        x: pos["x"].as_f64().unwrap_or(0.0),
        y: pos["y"].as_f64().unwrap_or(0.0),
        width: pos["width"].as_f64().unwrap_or(300.0),
        height: pos["height"].as_f64().unwrap_or(200.0),
        z: pos["z"].as_f64().unwrap_or(0.0),
        title: title_of(visual),
        projections,
        sort,
        paragraphs: paragraphs_of(&visual["objects"]),
        slicer_mode: visual["objects"]["data"].as_array().and_then(|d| d.first()).and_then(|d| literal(&d["properties"]["mode"])),
    }
}

/// Relatório no formato legado (`Report/Layout`, JSON em UTF-16).
pub fn report_from_legacy(layout: &Value) -> Vec<PageDef> {
    let mut pages = Vec::new();
    let Some(sections) = layout["sections"].as_array() else { return pages };
    for s in sections {
        let mut visuals = Vec::new();
        for vc in s["visualContainers"].as_array().into_iter().flatten() {
            let cfg: Value = vc["config"].as_str().and_then(|c| serde_json::from_str(c).ok()).unwrap_or(Value::Null);
            let sv = &cfg["singleVisual"];
            let pq = &sv["prototypeQuery"];
            let aliases: BTreeMap<String, String> = pq["From"]
                .as_array()
                .map(|f| {
                    f.iter()
                        .filter_map(|e| Some((e["Name"].as_str()?.to_string(), e["Entity"].as_str()?.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let selects: BTreeMap<String, (FieldProj, Value)> = pq["Select"]
                .as_array()
                .map(|sel| {
                    sel.iter()
                        .filter_map(|e| Some((e["Name"].as_str()?.to_string(), (field_from(e, &aliases)?, e.clone()))))
                        .collect()
                })
                .unwrap_or_default();
            let mut projections = BTreeMap::new();
            if let Some(proj) = sv["projections"].as_object() {
                for (role, list) in proj {
                    let fields = list
                        .as_array()
                        .map(|l| {
                            l.iter()
                                .filter_map(|q| {
                                    let qr = q["queryRef"].as_str()?;
                                    let (mut f, _) = selects.get(qr)?.clone();
                                    f.display_name = sv["columnProperties"][qr]["displayName"].as_str().map(str::to_string);
                                    Some(f)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    projections.insert(role.clone(), fields);
                }
            }
            let sort = pq["OrderBy"].as_array().and_then(|o| o.first()).and_then(|o| {
                Some(SortDef { field: field_from(&o["Expression"], &aliases)?, descending: o["Direction"].as_i64() == Some(2) })
            });
            let layout0 = cfg["layouts"].as_array().and_then(|l| l.first()).map(|l| l["position"].clone()).unwrap_or(Value::Null);
            let num = |k: &str| vc[k].as_f64().or_else(|| layout0[k].as_f64()).unwrap_or(0.0);
            visuals.push(VisualDef {
                name: cfg["name"].as_str().unwrap_or_default().to_string(),
                visual_type: sv["visualType"].as_str().unwrap_or("unknown").to_string(),
                x: num("x"),
                y: num("y"),
                width: num("width"),
                height: num("height"),
                z: num("z"),
                title: title_of(sv),
                projections,
                sort,
                paragraphs: paragraphs_of(&sv["objects"]),
                slicer_mode: sv["objects"]["data"].as_array().and_then(|d| d.first()).and_then(|d| literal(&d["properties"]["mode"])),
            });
        }
        pages.push(PageDef {
            name: s["name"].as_str().unwrap_or_default().to_string(),
            display_name: s["displayName"].as_str().unwrap_or("Página").to_string(),
            width: s["width"].as_f64().unwrap_or(1280.0),
            height: s["height"].as_f64().unwrap_or(720.0),
            visuals,
        });
    }
    pages
}
