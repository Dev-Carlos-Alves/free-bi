//! Leitura de fontes de dados: CSV, Excel (xlsx/xlsm/xls/ods), Parquet e JSON.

use anyhow::{anyhow, bail, Context, Result};
use calamine::{open_workbook_auto, Data, DataType as _, Reader};
use polars::prelude::*;
use std::io::Cursor;
use std::path::Path;

/// Lista as planilhas de um arquivo Excel/ODS.
pub fn excel_sheets(path: &str) -> Result<Vec<String>> {
    let wb = open_workbook_auto(path).with_context(|| format!("abrindo {path}"))?;
    Ok(wb.sheet_names().to_vec())
}

pub fn read_excel(path: &str, sheet: &str) -> Result<DataFrame> {
    let mut wb = open_workbook_auto(path).with_context(|| format!("abrindo {path}"))?;
    let range = wb
        .worksheet_range(sheet)
        .map_err(|e| anyhow!("planilha '{sheet}': {e}"))?;
    let mut rows = range.rows().skip_while(|r| r.iter().all(|c| matches!(c, Data::Empty)));
    let header = rows.next().ok_or_else(|| anyhow!("planilha '{sheet}' está vazia"))?;
    let names = unique_names(header.iter().map(cell_to_string));
    let body: Vec<&[Data]> = rows.filter(|r| !r.iter().all(|c| matches!(c, Data::Empty))).collect();

    let mut columns = Vec::with_capacity(names.len());
    for (i, name) in names.iter().enumerate() {
        let cells: Vec<&Data> = body.iter().map(|r| r.get(i).unwrap_or(&Data::Empty)).collect();
        columns.push(excel_column(name, &cells));
    }
    // Remove colunas totalmente vazias e sem cabeçalho (sobras comuns em planilhas).
    let columns: Vec<Column> = columns
        .into_iter()
        .zip(names.iter())
        .filter(|(c, n)| !(n.starts_with("Coluna") && c.null_count() == c.len()))
        .map(|(c, _)| c)
        .collect();
    Ok(DataFrame::new(body.len(), columns)?)
}

fn cell_to_string(c: &Data) -> String {
    match c {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", *f as i64),
        other => other.to_string(),
    }
}

fn unique_names(raw: impl Iterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (i, n) in raw.enumerate() {
        let base = if n.is_empty() { format!("Coluna{}", i + 1) } else { n };
        let mut name = base.clone();
        let mut k = 2;
        while out.contains(&name) {
            name = format!("{base}.{k}");
            k += 1;
        }
        out.push(name);
    }
    out
}

fn excel_column(name: &str, cells: &[&Data]) -> Column {
    let non_empty: Vec<&&Data> = cells.iter().filter(|c| !matches!(c, Data::Empty | Data::Error(_))).collect();
    let all = |f: fn(&Data) -> bool| !non_empty.is_empty() && non_empty.iter().all(|c| f(c));
    let name: PlSmallStr = name.into();

    if all(|c| matches!(c, Data::Int(_) | Data::Float(_))) {
        let integral = non_empty.iter().all(|c| match c {
            Data::Int(_) => true,
            Data::Float(f) => f.fract() == 0.0 && f.abs() < 9e15,
            _ => false,
        });
        if integral {
            let v: Vec<Option<i64>> = cells
                .iter()
                .map(|c| match c {
                    Data::Int(i) => Some(*i),
                    Data::Float(f) => Some(*f as i64),
                    _ => None,
                })
                .collect();
            return Column::new(name, v);
        }
        let v: Vec<Option<f64>> = cells
            .iter()
            .map(|c| match c {
                Data::Int(i) => Some(*i as f64),
                Data::Float(f) => Some(*f),
                _ => None,
            })
            .collect();
        return Column::new(name, v);
    }
    if all(|c| matches!(c, Data::Bool(_))) {
        let v: Vec<Option<bool>> = cells.iter().map(|c| if let Data::Bool(b) = c { Some(*b) } else { None }).collect();
        return Column::new(name, v);
    }
    if all(|c| matches!(c, Data::DateTime(_) | Data::DateTimeIso(_))) {
        let dts: Vec<Option<chrono::NaiveDateTime>> = cells.iter().map(|c| c.as_datetime()).collect();
        let date_only = dts.iter().flatten().all(|d| d.time() == chrono::NaiveTime::MIN);
        if date_only {
            let v: Vec<Option<i32>> = dts
                .iter()
                .map(|d| d.map(|d| (d.date() - chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()).num_days() as i32))
                .collect();
            return Column::new(name, v).cast(&DataType::Date).expect("cast date");
        }
        let v: Vec<Option<i64>> = dts.iter().map(|d| d.map(|d| d.and_utc().timestamp_millis())).collect();
        return Column::new(name, v)
            .cast(&DataType::Datetime(TimeUnit::Milliseconds, None))
            .expect("cast datetime");
    }
    let v: Vec<Option<String>> = cells
        .iter()
        .map(|c| match c {
            Data::Empty | Data::Error(_) => None,
            other => Some(cell_to_string(other)),
        })
        .collect();
    Column::new(name, v)
}

/// Lê CSV detectando separador, vírgula decimal e codificação (UTF-8 ou Windows-1252).
pub fn read_csv(path: &str) -> Result<DataFrame> {
    let raw = std::fs::read(path).with_context(|| format!("lendo {path}"))?;
    read_csv_bytes(&raw)
}

pub fn read_csv_bytes(raw: &[u8]) -> Result<DataFrame> {
    let raw = raw.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(raw);
    let text: Vec<u8> = match std::str::from_utf8(raw) {
        Ok(_) => raw.to_vec(),
        Err(_) => {
            let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(raw);
            cow.into_owned().into_bytes()
        }
    };
    let sample = String::from_utf8_lossy(&text[..text.len().min(64 * 1024)]).to_string();
    let sep = sniff_separator(&sample);
    let decimal_comma = sep != b',' && looks_decimal_comma(&sample, sep);

    let df = CsvReadOptions::default()
        .with_has_header(true)
        .with_infer_schema_length(Some(5000))
        .with_ignore_errors(true)
        .map_parse_options(move |p| {
            p.with_separator(sep)
                .with_try_parse_dates(true)
                .with_decimal_comma(decimal_comma)
                .with_truncate_ragged_lines(true)
        })
        .into_reader_with_file_handle(Cursor::new(text))
        .finish()?;
    Ok(df)
}

fn sniff_separator(sample: &str) -> u8 {
    let lines: Vec<&str> = sample.lines().take(20).filter(|l| !l.trim().is_empty()).collect();
    let mut best = (b',', 0usize);
    for sep in [b';', b',', b'\t', b'|'] {
        let counts: Vec<usize> = lines.iter().map(|l| count_outside_quotes(l, sep as char)).collect();
        if counts.is_empty() || counts[0] == 0 {
            continue;
        }
        // Separador bom: aparece o mesmo número de vezes na maioria das linhas.
        let consistent = counts.iter().filter(|&&c| c == counts[0]).count();
        let score = consistent * 1000 + counts[0];
        if score > best.1 {
            best = (sep, score);
        }
    }
    best.0
}

fn count_outside_quotes(line: &str, sep: char) -> usize {
    let mut in_q = false;
    line.chars()
        .filter(|&c| {
            if c == '"' {
                in_q = !in_q;
            }
            !in_q && c == sep
        })
        .count()
}

fn looks_decimal_comma(sample: &str, sep: u8) -> bool {
    let sep = sep as char;
    let mut comma_nums = 0;
    let mut dot_nums = 0;
    for line in sample.lines().skip(1).take(200) {
        for field in line.split(sep) {
            let f = field.trim().trim_matches('"');
            let numeric = !f.is_empty() && f.chars().all(|c| c.is_ascii_digit() || matches!(c, ',' | '.' | '-'));
            if !numeric {
                continue;
            }
            if f.contains(',') {
                comma_nums += 1;
            } else if f.contains('.') {
                dot_nums += 1;
            }
        }
    }
    comma_nums > dot_nums
}

pub fn read_parquet(path: &str) -> Result<DataFrame> {
    let f = std::fs::File::open(path).with_context(|| format!("abrindo {path}"))?;
    Ok(ParquetReader::new(f).finish()?)
}

pub fn read_json(path: &str) -> Result<DataFrame> {
    let raw = std::fs::read(path).with_context(|| format!("lendo {path}"))?;
    let first = raw.iter().find(|b| !b.is_ascii_whitespace()).copied();
    let format = if first == Some(b'[') { JsonFormat::Json } else { JsonFormat::JsonLines };
    Ok(JsonReader::new(Cursor::new(raw)).with_json_format(format).finish()?)
}

/// Nome sugerido para a tabela a partir do arquivo.
pub fn table_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Tabela".into())
}

pub fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn read_any(source: &crate::model::Source) -> Result<DataFrame> {
    use crate::model::Source::*;
    match source {
        Csv { path } => read_csv(path),
        Excel { path, sheet } => read_excel(path, sheet),
        Parquet { path } => read_parquet(path),
        Json { path } => read_json(path),
        Embedded => bail!("tabela sem arquivo de origem"),
    }
}
