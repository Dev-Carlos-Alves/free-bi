//! Tipos serializáveis do modelo semântico (tabelas, relações, medidas, relatório).

use serde::{Deserialize, Serialize};

/// Origem dos dados de uma tabela.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Source {
    Csv { path: String },
    Excel { path: String, sheet: String },
    Parquet { path: String },
    Json { path: String },
    /// Dados digitados/colados ou importados sem arquivo de origem.
    Embedded,
}

impl Source {
    pub fn path(&self) -> Option<&str> {
        match self {
            Source::Csv { path } | Source::Parquet { path } | Source::Json { path } => Some(path),
            Source::Excel { path, .. } => Some(path),
            Source::Embedded => None,
        }
    }
}

/// Etapa de transformação (um "Power Query" simplificado).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Step {
    RemoveColumns { columns: Vec<String> },
    KeepColumns { columns: Vec<String> },
    RenameColumn { from: String, to: String },
    ChangeType { column: String, dtype: DType },
    FilterRows { column: String, cmp: Cmp, value: serde_json::Value },
    ReplaceValue { column: String, find: String, replace: String },
    FillNull { column: String, value: serde_json::Value },
    RemoveNullRows { column: String },
    RemoveDuplicates { columns: Vec<String> },
    Trim { column: String },
    Uppercase { column: String },
    Lowercase { column: String },
    SplitColumn { column: String, delimiter: String },
    Sort { column: String, descending: bool },
    KeepTopRows { n: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DType {
    Text,
    Integer,
    Decimal,
    Boolean,
    Date,
    DateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cmp {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    IsNull,
    NotNull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalcColumn {
    pub name: String,
    pub expression: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Measure {
    pub name: String,
    /// Tabela "dona" da medida (onde ela aparece no painel de campos).
    pub table: String,
    pub expression: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
}

/// Relação muitos-para-um: `from_table[from_column]` (lado N) → `to_table[to_column]` (lado 1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Relationship {
    pub id: String,
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

/// Metadados persistidos de uma tabela (os dados ficam em parquet dentro do projeto).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMeta {
    pub name: String,
    pub source: Source,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub calc_columns: Vec<CalcColumn>,
    /// Colunas calculadas que vieram prontas de um .pbix (valores importados, só referência).
    #[serde(default)]
    pub imported_calc_columns: Vec<CalcColumn>,
    /// Consulta Power Query (M) original, quando importada de um .pbix.
    #[serde(default)]
    pub origin_query: Option<String>,
}

/// Referência a uma coluna, com parte de data opcional (hierarquia de datas).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldRef {
    pub table: String,
    pub column: String,
    #[serde(default)]
    pub date_part: Option<DatePart>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatePart {
    Year,
    Quarter,
    Month,
    Day,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Agg {
    Sum,
    Avg,
    Min,
    Max,
    Count,
    DistinctCount,
    None,
}

/// Um valor numa visual: coluna agregada ou medida.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ValueSpec {
    Column { field: FieldRef, agg: Agg },
    Measure { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filter {
    pub field: FieldRef,
    #[serde(flatten)]
    pub kind: FilterKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FilterKind {
    /// Lista de valores selecionados (segmentação/seleção cruzada).
    In { values: Vec<serde_json::Value> },
    NotIn { values: Vec<serde_json::Value> },
    Range { min: Option<f64>, max: Option<f64> },
    Compare { cmp: Cmp, value: serde_json::Value },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VisualQuery {
    #[serde(default)]
    pub group_by: Vec<FieldRef>,
    #[serde(default)]
    pub values: Vec<ValueSpec>,
    #[serde(default)]
    pub filters: Vec<Filter>,
    /// Índice da coluna de saída usada para ordenar.
    #[serde(default)]
    pub sort_by: Option<usize>,
    #[serde(default)]
    pub sort_desc: bool,
    #[serde(default)]
    pub limit: Option<usize>,
    /// Calcula também a linha de total (tabelas).
    #[serde(default)]
    pub totals: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub dtype: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total: Option<Vec<serde_json::Value>>,
    pub row_count: usize,
}
