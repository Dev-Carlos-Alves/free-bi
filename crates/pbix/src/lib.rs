//! Leitor de arquivos `.pbix` do Power BI Desktop.
//!
//! Extrai o layout do relatório (páginas e visuais), o tema, e o modelo de dados
//! importado: tabelas com os valores das colunas, medidas DAX, colunas calculadas,
//! relações e consultas Power Query. O formato do modelo segue o [MS-XLDM]; a
//! descompressão XPress9 usa o código MIT publicado pela Microsoft (em `vendor/`).

mod abf;
mod meta;
pub mod report;
mod vertipaq;
mod xml;

pub use meta::{CalcColumnDef, MeasureDef, QueryDef, RelationshipDef};
pub use report::{FieldProj, PageDef, ReportDef, VisualDef};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::io::{Read, Seek};
use vertipaq::Dictionary;

/// Valores de uma coluna. Datas/horas vêm como dias desde 1899-12-30 (padrão OLE).
#[derive(Debug, Clone)]
pub enum ColumnValues {
    Int(Vec<Option<i64>>),
    Float(Vec<Option<f64>>),
    Text(Vec<Option<String>>),
    Bool(Vec<Option<bool>>),
    DateTime(Vec<Option<f64>>),
}

impl ColumnValues {
    pub fn len(&self) -> usize {
        match self {
            ColumnValues::Int(v) => v.len(),
            ColumnValues::Float(v) | ColumnValues::DateTime(v) => v.len(),
            ColumnValues::Text(v) => v.len(),
            ColumnValues::Bool(v) => v.len(),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Clone)]
pub struct PbixColumn {
    pub name: String,
    pub values: ColumnValues,
}

#[derive(Debug, Clone)]
pub struct PbixTable {
    pub name: String,
    pub columns: Vec<PbixColumn>,
}

pub struct Pbix {
    pub report: ReportDef,
    pub tables: Vec<PbixTable>,
    pub measures: Vec<MeasureDef>,
    pub calc_columns: Vec<CalcColumnDef>,
    pub relationships: Vec<RelationshipDef>,
    pub queries: Vec<QueryDef>,
    /// Avisos não fatais (colunas que não puderam ser lidas etc.).
    pub warnings: Vec<String>,
}

pub fn open(path: &str) -> Result<Pbix> {
    let f = std::fs::File::open(path).with_context(|| format!("abrindo {path}"))?;
    read(f)
}

pub fn read<R: Read + Seek>(r: R) -> Result<Pbix> {
    let mut zip = zip::ZipArchive::new(r).context("o arquivo não é um .pbix válido (zip)")?;
    let report = read_report(&mut zip)?;
    let mut warnings = Vec::new();

    let raw = match read_entry(&mut zip, "DataModel") {
        Some(b) => b,
        None => {
            warnings.push("O arquivo não tem modelo de dados embutido (relatório com conexão ao vivo).".into());
            return Ok(Pbix {
                report,
                tables: vec![],
                measures: vec![],
                calc_columns: vec![],
                relationships: vec![],
                queries: vec![],
                warnings,
            });
        }
    };
    let abf = abf::Abf::parse(abf::decompress_datamodel(&raw)?)?;
    let meta = meta::read(abf.file("metadata.sqlitedb")?)?;

    let mut tables: Vec<PbixTable> = meta.tables.iter().map(|t| PbixTable { name: t.clone(), columns: vec![] }).collect();
    for col in &meta.columns {
        // Ignora tabelas internas (ex.: LocalDateTable / DateTableTemplate).
        let Some(t) = tables.iter_mut().find(|t| t.name == col.table) else { continue };
        match decode_column(&abf, col) {
            Ok(values) => t.columns.push(PbixColumn { name: col.name.clone(), values }),
            Err(e) => warnings.push(format!("{}[{}]: {e}", col.table, col.name)),
        }
    }
    tables.retain(|t| !t.columns.is_empty());
    for t in &mut tables {
        let n = t.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
        t.columns.retain(|c| {
            let ok = c.values.len() == n;
            if !ok {
                warnings.push(format!("{}[{}]: tamanho divergente, coluna ignorada", t.name, c.name));
            }
            ok
        });
    }
    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    let keep = |t: &str| names.contains(&t);
    Ok(Pbix {
        report,
        measures: meta.measures.iter().filter(|m| keep(&m.table)).cloned().collect(),
        calc_columns: meta.calc_columns.iter().filter(|c| keep(&c.table)).cloned().collect(),
        relationships: meta.relationships.iter().filter(|r| keep(&r.from_table) && keep(&r.to_table)).cloned().collect(),
        queries: meta.queries.iter().filter(|q| keep(&q.table)).cloned().collect(),
        tables,
        warnings,
    })
}

fn decode_column(abf: &abf::Abf, col: &meta::ColumnSchema) -> Result<ColumnValues> {
    let dict = match &col.dictionary {
        Some(d) => Some(vertipaq::parse_dictionary(abf.file(d)?)?),
        None => None,
    };
    let mut ids: Vec<i64> = Vec::new();
    let mut null_mask: Vec<bool> = Vec::new();
    for idf in &col.idfs {
        let metas = vertipaq::parse_idfmeta(abf.file(&format!("{idf}meta"))?)?;
        let part = vertipaq::decode_ids(abf.file(idf)?, &metas)?;
        // Para colunas codificadas por valor, o id 2 em segmentos com nulos significa nulo.
        let mut pos = 0usize;
        for m in &metas {
            let n = (m.records as usize).min(part.len() - pos);
            for &id in &part[pos..pos + n] {
                null_mask.push(m.has_nulls && id == 2);
            }
            pos += n;
        }
        null_mask.resize(ids.len() + part.len(), false);
        ids.extend(part);
    }

    let dt = col.data_type;
    let scale = if dt == 10 { 10000.0 } else { 1.0 };
    Ok(match dict {
        Some(Dictionary::Strings(s)) => {
            let v: Vec<Option<String>> = ids.iter().map(|&id| dict_idx(&s, id).map(|i| s[i].clone())).collect();
            if dt == 11 {
                ColumnValues::Bool(v.into_iter().map(|x| x.map(|s| s.eq_ignore_ascii_case("true"))).collect())
            } else {
                ColumnValues::Text(v)
            }
        }
        Some(Dictionary::Longs(d)) => {
            let get = |id: i64| dict_idx(&d, id).map(|i| d[i]);
            match dt {
                8 | 10 => ColumnValues::Float(ids.iter().map(|&id| get(id).map(|x| x as f64 / scale)).collect()),
                9 => ColumnValues::DateTime(ids.iter().map(|&id| get(id).map(|x| x as f64)).collect()),
                11 => ColumnValues::Bool(ids.iter().map(|&id| get(id).map(|x| x != 0)).collect()),
                _ => ColumnValues::Int(ids.iter().map(|&id| get(id)).collect()),
            }
        }
        Some(Dictionary::Reals(d)) => {
            let get = |id: i64| dict_idx(&d, id).map(|i| d[i]);
            match dt {
                9 => ColumnValues::DateTime(ids.iter().map(|&id| get(id)).collect()),
                6 => ColumnValues::Int(ids.iter().map(|&id| get(id).map(|x| x.round() as i64)).collect()),
                _ => ColumnValues::Float(ids.iter().map(|&id| get(id).map(|x| x / scale)).collect()),
            }
        }
        None => {
            // Codificação por valor: valor = (id + BaseId) / Magnitude.
            let base = col.base_id.unwrap_or(0.0);
            let mag = col.magnitude.filter(|m| *m != 0.0).unwrap_or(1.0);
            let val = |k: usize| -> Option<f64> {
                if null_mask.get(k).copied().unwrap_or(false) {
                    None
                } else {
                    Some((ids[k] as f64 + base) / mag)
                }
            };
            match dt {
                6 => ColumnValues::Int((0..ids.len()).map(|k| val(k).map(|x| x.round() as i64)).collect()),
                9 => ColumnValues::DateTime((0..ids.len()).map(val).collect()),
                11 => ColumnValues::Bool((0..ids.len()).map(|k| val(k).map(|x| x != 0.0)).collect()),
                2 => ColumnValues::Text((0..ids.len()).map(|k| val(k).map(|x| x.to_string())).collect()),
                _ => ColumnValues::Float((0..ids.len()).map(|k| val(k).map(|x| x / scale)).collect()),
            }
        }
    })
}

fn dict_idx<T>(d: &[T], id: i64) -> Option<usize> {
    let k = id - 3;
    (k >= 0 && (k as usize) < d.len()).then_some(k as usize)
}

fn read_entry<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    let mut buf = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn read_json<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Value> {
    let b = read_entry(zip, name)?;
    let text = if b.len() > 1 && (b.starts_with(&[0xFF, 0xFE]) || b[1] == 0) {
        xml::decode_utf16le(&b)
    } else {
        String::from_utf8_lossy(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).to_string()
    };
    serde_json::from_str(&text).ok()
}

fn read_report<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Result<ReportDef> {
    let names: Vec<String> = (0..zip.len()).filter_map(|i| zip.name_for_index(i).and_then(|n| n.ok().map(|n| n.to_string()))).collect();
    let theme = names
        .iter()
        .find(|n| n.starts_with("Report/StaticResources/RegisteredResources/") && n.ends_with(".json"))
        .cloned()
        .and_then(|n| read_json(zip, &n));

    // Formato PBIR (Power BI 2024+).
    if names.iter().any(|n| n == "Report/definition/pages/pages.json") {
        let pages_meta = read_json(zip, "Report/definition/pages/pages.json").unwrap_or(Value::Null);
        let mut order: Vec<String> = pages_meta["pageOrder"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        for n in &names {
            if let Some(rest) = n.strip_prefix("Report/definition/pages/") {
                if let Some(p) = rest.strip_suffix("/page.json") {
                    if !order.iter().any(|o| o == p) {
                        order.push(p.to_string());
                    }
                }
            }
        }
        let mut pages = Vec::new();
        for p in order {
            let pj = read_json(zip, &format!("Report/definition/pages/{p}/page.json")).unwrap_or(Value::Null);
            let prefix = format!("Report/definition/pages/{p}/visuals/");
            let mut visuals: Vec<VisualDef> = names
                .iter()
                .filter(|n| n.starts_with(&prefix) && n.ends_with("/visual.json"))
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .filter_map(|n| read_json(zip, &n))
                .map(|v| report::visual_from_pbir(&v))
                .collect();
            visuals.sort_by(|a, b| a.z.partial_cmp(&b.z).unwrap_or(std::cmp::Ordering::Equal));
            pages.push(PageDef {
                name: p.clone(),
                display_name: pj["displayName"].as_str().unwrap_or(&p).to_string(),
                width: pj["width"].as_f64().unwrap_or(1280.0),
                height: pj["height"].as_f64().unwrap_or(720.0),
                visuals,
            });
        }
        return Ok(ReportDef { pages, theme });
    }
    if let Some(layout) = read_json(zip, "Report/Layout") {
        return Ok(ReportDef { pages: report::report_from_legacy(&layout), theme });
    }
    Err(anyhow!("não encontrei o layout do relatório no .pbix"))
}
