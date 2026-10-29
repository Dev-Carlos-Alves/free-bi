//! Leitura do `metadata.sqlitedb` (esquema TMSCHEMA) embutido no backup ABF.

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};

#[derive(Debug, Clone)]
pub struct ColumnSchema {
    pub table: String,
    pub name: String,
    pub dictionary: Option<String>,
    pub idfs: Vec<String>,
    /// 2=texto, 6=inteiro, 8=decimal, 9=data/hora, 10=moeda, 11=booleano.
    pub data_type: i64,
    pub base_id: Option<f64>,
    pub magnitude: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MeasureDef {
    pub table: String,
    pub name: String,
    pub expression: String,
    pub display_folder: Option<String>,
    pub format_string: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CalcColumnDef {
    pub table: String,
    pub name: String,
    pub expression: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RelationshipDef {
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    pub active: bool,
    pub both_directions: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct QueryDef {
    pub table: String,
    pub expression: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SortByDef {
    pub table: String,
    pub column: String,
    pub sort_by: String,
}

pub struct Metadata {
    pub sort_by_columns: Vec<SortByDef>,
    pub tables: Vec<String>,
    pub columns: Vec<ColumnSchema>,
    pub measures: Vec<MeasureDef>,
    pub calc_columns: Vec<CalcColumnDef>,
    pub relationships: Vec<RelationshipDef>,
    pub queries: Vec<QueryDef>,
}

fn has_column(db: &Connection, table: &str, col: &str) -> bool {
    let Ok(mut st) = db.prepare(&format!("PRAGMA table_info([{table}])")) else { return false };
    let names: Vec<String> = st
        .query_map([], |r| r.get::<_, String>(1))
        .map(|it| it.flatten().collect())
        .unwrap_or_default();
    names.iter().any(|n| n.eq_ignore_ascii_case(col))
}

pub fn read(sqlite_bytes: &[u8]) -> Result<Metadata> {
    let path = std::env::temp_dir().join(format!("freebi-meta-{}-{}.sqlite", std::process::id(), unique()));
    std::fs::write(&path, sqlite_bytes)?;
    let result = (|| {
        let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        read_db(&db)
    })();
    let _ = std::fs::remove_file(&path);
    result
}

fn unique() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

fn read_db(db: &Connection) -> Result<Metadata> {
    let type_col = if has_column(db, "Column", "Type") { "c.Type" } else { "c.BindingType" };
    let dtype = if has_column(db, "Column", "InferredDataType") {
        "CASE WHEN c.ExplicitDataType = 1 THEN c.InferredDataType ELSE c.ExplicitDataType END"
    } else {
        "c.ExplicitDataType"
    };

    let mut tables = Vec::new();
    {
        let mut st = db.prepare("SELECT Name FROM [Table] WHERE SystemFlags = 0 ORDER BY ID")?;
        for r in st.query_map([], |r| r.get::<_, String>(0))? {
            tables.push(r?);
        }
    }

    let sql = format!(
        "SELECT t.Name, COALESCE(c.ExplicitName, c.InferredName), sfd.FileName, sfi.FileName,
                {dtype}, ds.BaseId, ds.Magnitude
         FROM Column c
         JOIN [Table] t ON c.TableId = t.ID
         JOIN ColumnStorage cs ON c.ColumnStorageID = cs.ID
         LEFT JOIN DictionaryStorage ds ON ds.ID = cs.DictionaryStorageID
         LEFT JOIN StorageFile sfd ON sfd.ID = ds.StorageFileID
         JOIN ColumnPartitionStorage cps ON cps.ColumnStorageID = cs.ID
         JOIN StorageFile sfi ON sfi.ID = cps.StorageFileID
         JOIN PartitionStorage ps ON ps.ID = cps.PartitionStorageID
         WHERE {type_col} IN (1,2,4) AND t.SystemFlags = 0
         ORDER BY t.ID, cs.StoragePosition, ps.StoragePosition"
    );
    let mut columns: Vec<ColumnSchema> = Vec::new();
    {
        let mut st = db.prepare(&sql).context("consulta de esquema")?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<f64>>(5)?,
                r.get::<_, Option<f64>>(6)?,
            ))
        })?;
        for row in rows {
            let (table, name, dict, idf, dt, base, mag) = row?;
            if let Some(c) = columns.iter_mut().find(|c| c.table == table && c.name == name) {
                c.idfs.push(idf);
                continue;
            }
            columns.push(ColumnSchema {
                table,
                name,
                dictionary: dict,
                idfs: vec![idf],
                data_type: dt.unwrap_or(2),
                base_id: base,
                magnitude: mag,
            });
        }
    }

    let folder = if has_column(db, "Measure", "DisplayFolder") { "m.DisplayFolder" } else { "NULL" };
    let fmt = if has_column(db, "Measure", "FormatString") { "m.FormatString" } else { "NULL" };
    let mut measures = Vec::new();
    {
        let mut st = db.prepare(&format!(
            "SELECT t.Name, m.Name, m.Expression, {folder}, {fmt} FROM Measure m JOIN [Table] t ON m.TableID = t.ID ORDER BY m.ID"
        ))?;
        for r in st.query_map([], |r| {
            Ok(MeasureDef {
                table: r.get(0)?,
                name: r.get(1)?,
                expression: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                display_folder: r.get(3)?,
                format_string: r.get(4)?,
            })
        })? {
            measures.push(r?);
        }
    }

    let mut calc_columns = Vec::new();
    {
        let mut st = db.prepare(&format!(
            "SELECT t.Name, c.ExplicitName, c.Expression FROM Column c JOIN [Table] t ON c.TableID = t.ID WHERE {type_col} = 2"
        ))?;
        for r in st.query_map([], |r| {
            Ok(CalcColumnDef {
                table: r.get(0)?,
                name: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                expression: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            })
        })? {
            calc_columns.push(r?);
        }
    }

    let rc = |modern: &str| -> String {
        if has_column(db, "Relationship", modern) {
            modern.to_string()
        } else {
            modern.replacen("From", "FromEnd", 1).replacen("To", "ToEnd", 1)
        }
    };
    let mut relationships = Vec::new();
    {
        let sql = format!(
            "SELECT ft.Name, fc.ExplicitName, tt.Name, tc.ExplicitName, rel.IsActive, rel.CrossFilteringBehavior
             FROM Relationship rel
             LEFT JOIN [Table] ft ON rel.{} = ft.ID
             LEFT JOIN [Column] fc ON rel.{} = fc.ID
             LEFT JOIN [Table] tt ON rel.{} = tt.ID
             LEFT JOIN [Column] tc ON rel.{} = tc.ID
             WHERE ft.SystemFlags = 0 AND tt.SystemFlags = 0",
            rc("FromTableID"),
            rc("FromColumnID"),
            rc("ToTableID"),
            rc("ToColumnID")
        );
        let mut st = db.prepare(&sql)?;
        for r in st.query_map([], |r| {
            Ok(RelationshipDef {
                from_table: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                from_column: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                to_table: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                to_column: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                active: r.get::<_, Option<i64>>(4)?.unwrap_or(1) != 0,
                both_directions: r.get::<_, Option<i64>>(5)?.unwrap_or(1) == 2,
            })
        })? {
            relationships.push(r?);
        }
    }

    let mut queries = Vec::new();
    if has_column(db, "Partition", "Type") {
        let mut st = db.prepare("SELECT t.Name, p.QueryDefinition FROM Partition p JOIN [Table] t ON t.ID = p.TableID WHERE p.Type = 4")?;
        for r in st.query_map([], |r| {
            Ok(QueryDef { table: r.get(0)?, expression: r.get::<_, Option<String>>(1)?.unwrap_or_default() })
        })? {
            queries.push(r?);
        }
    }

    let mut sort_by_columns = Vec::new();
    if has_column(db, "Column", "SortByColumnID") {
        let mut st = db.prepare(
            "SELECT t.Name, COALESCE(c.ExplicitName, c.InferredName), COALESCE(sc.ExplicitName, sc.InferredName)
             FROM Column c JOIN [Table] t ON c.TableID = t.ID JOIN Column sc ON sc.ID = c.SortByColumnID",
        )?;
        for r in st.query_map([], |r| Ok(SortByDef { table: r.get(0)?, column: r.get(1)?, sort_by: r.get(2)? }))? {
            sort_by_columns.push(r?);
        }
    }

    Ok(Metadata { sort_by_columns, tables, columns, measures, calc_columns, relationships, queries })
}
