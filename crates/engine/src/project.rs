//! Arquivo de projeto `.freebi`: um zip com `project.json` e os dados em Parquet.
//! Funciona igual no Windows e no Linux.

use crate::engine::{Engine, Table};
use crate::model::{Measure, Relationship, TableMeta};
use anyhow::{bail, Context, Result};
use polars::prelude::*;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};

#[derive(Serialize, Deserialize)]
struct ProjectFile {
    format: String,
    version: u32,
    tables: Vec<TableMeta>,
    relationships: Vec<Relationship>,
    measures: Vec<Measure>,
    report: serde_json::Value,
}

const FORMAT: &str = "freebi-project";

impl Engine {
    pub fn save_project(&self, path: &str) -> Result<()> {
        let pf = ProjectFile {
            format: FORMAT.into(),
            version: 1,
            tables: self.tables.values().map(|t| t.meta.clone()).collect(),
            relationships: self.relationships.clone(),
            measures: self.measures.clone(),
            report: self.report.clone(),
        };
        // Grava num arquivo temporário e renomeia, para não corromper o projeto se falhar no meio.
        let tmp = format!("{path}.tmp");
        {
            let f = std::fs::File::create(&tmp).with_context(|| format!("criando {tmp}"))?;
            let mut zip = ::zip::ZipWriter::new(f);
            let opts = ::zip::write::SimpleFileOptions::default().compression_method(::zip::CompressionMethod::Deflated);
            zip.start_file("project.json", opts)?;
            zip.write_all(serde_json::to_string_pretty(&pf)?.as_bytes())?;
            let stored = ::zip::write::SimpleFileOptions::default().compression_method(::zip::CompressionMethod::Stored);
            for (i, t) in self.tables.values().enumerate() {
                let mut buf = Vec::new();
                let mut df = t.raw.clone();
                ParquetWriter::new(&mut buf).with_compression(ParquetCompression::Zstd(None)).finish(&mut df)?;
                zip.start_file(format!("data/{i}.parquet"), stored)?;
                zip.write_all(&buf)?;
            }
            zip.finish()?;
        }
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn load_project(path: &str) -> Result<Engine> {
        let f = std::fs::File::open(path).with_context(|| format!("abrindo {path}"))?;
        let mut zip = ::zip::ZipArchive::new(f).context("arquivo de projeto inválido")?;
        let mut json = String::new();
        zip.by_name("project.json")?.read_to_string(&mut json)?;
        let pf: ProjectFile = serde_json::from_str(&json)?;
        if pf.format != FORMAT {
            bail!("este arquivo não é um projeto do Free BI");
        }
        let mut e = Engine::new();
        for (i, meta) in pf.tables.into_iter().enumerate() {
            let mut buf = Vec::new();
            zip.by_name(&format!("data/{i}.parquet"))?.read_to_end(&mut buf)?;
            let raw = ParquetReader::new(Cursor::new(buf)).finish()?;
            e.tables.insert(meta.name.clone(), Table { meta, df: raw.clone(), raw, errors: vec![] });
        }
        e.relationships = pf.relationships;
        e.measures = pf.measures;
        e.report = pf.report;
        e.refresh_all();
        Ok(e)
    }
}
