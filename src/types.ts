// Tipos compartilhados com o motor (crates/engine/src/model.rs).

export type DType = "text" | "integer" | "decimal" | "boolean" | "date" | "datetime";
export type Agg = "sum" | "avg" | "min" | "max" | "count" | "distinct_count" | "none";
export type DatePart = "year" | "quarter" | "month" | "day";

export interface ColumnMeta {
  name: string;
  dtype: DType;
  calculated: boolean;
}

export interface CalcColumn {
  name: string;
  expression: string;
}

export interface TableModel {
  name: string;
  rows: number;
  columns: ColumnMeta[];
  source: { kind: string; path?: string; sheet?: string };
  steps: Step[];
  calc_columns: CalcColumn[];
  imported_calc_columns: CalcColumn[];
  origin_query: string | null;
  sort_by: Record<string, string>;
  errors: string[];
}

export interface Measure {
  name: string;
  table: string;
  expression: string;
  format?: string | null;
  folder?: string | null;
}

export interface Relationship {
  id: string;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  active: boolean;
}

export interface Model {
  tables: TableModel[];
  measures: Measure[];
  relationships: Relationship[];
}

export type Cmp =
  | "eq" | "ne" | "gt" | "ge" | "lt" | "le"
  | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null";

export type Step =
  | { op: "remove_columns"; columns: string[] }
  | { op: "keep_columns"; columns: string[] }
  | { op: "rename_column"; from: string; to: string }
  | { op: "change_type"; column: string; dtype: DType }
  | { op: "filter_rows"; column: string; cmp: Cmp; value: unknown }
  | { op: "replace_value"; column: string; find: string; replace: string }
  | { op: "fill_null"; column: string; value: unknown }
  | { op: "remove_null_rows"; column: string }
  | { op: "remove_duplicates"; columns: string[] }
  | { op: "trim"; column: string }
  | { op: "uppercase"; column: string }
  | { op: "lowercase"; column: string }
  | { op: "split_column"; column: string; delimiter: string }
  | { op: "sort"; column: string; descending: boolean }
  | { op: "keep_top_rows"; n: number };

export interface FieldRef {
  table: string;
  column: string;
  date_part?: DatePart | null;
}

export type ValueSpec =
  | { kind: "column"; field: FieldRef; agg: Agg }
  | { kind: "measure"; name: string };

export type FilterKind =
  | { type: "in"; values: unknown[] }
  | { type: "not_in"; values: unknown[] }
  | { type: "range"; min: number | null; max: number | null }
  | { type: "compare"; cmp: Cmp; value: unknown };

export type Filter = { field: FieldRef } & FilterKind;

export interface VisualQuery {
  group_by: FieldRef[];
  values: ValueSpec[];
  filters: Filter[];
  sort_by?: number | null;
  sort_desc?: boolean;
  limit?: number | null;
  totals?: boolean;
}

export interface QueryResult {
  columns: { name: string; dtype: DType }[];
  rows: unknown[][];
  total: unknown[] | null;
  row_count: number;
}

// ---------------------------------------------------------------- relatório

/** Campo colocado numa visual. */
export interface FieldItem {
  kind: "column" | "measure";
  table: string;
  name: string;
  agg?: Agg | null;
  date_part?: DatePart | null;
  label?: string | null;
}

export type VisualType =
  | "column" | "stacked_column" | "bar" | "stacked_bar" | "line" | "area" | "combo"
  | "pie" | "donut" | "card" | "table" | "matrix" | "slicer" | "text" | "scatter"
  | "gauge" | "funnel" | "treemap" | "shape" | "image" | "button" | "unsupported";

export type ShapeKind = "rect" | "rounded" | "ellipse" | "line" | "arrow";

/** Ação de um botão (Inserir › Botões). */
export type ButtonAction = { kind: "page"; page_id: string } | { kind: "back" } | { kind: "none" };

/** Aparência do contêiner da visual (copiada pelo Pincel de formatação). */
export interface VisualStyle {
  background?: string | null;
  /** 0–100: transparência do plano de fundo. */
  transparency?: number;
  border_color?: string | null;
  border_width?: number;
  radius?: number;
  shadow?: boolean;
  title_color?: string | null;
  title_size?: number | null;
  title_align?: "left" | "center" | "right";
}

export interface TextRun {
  value: string;
  bold?: boolean;
  size?: number | null;
  color?: string | null;
}

export interface Visual {
  id: string;
  type: VisualType;
  source_type?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string | null;
  fields: Partial<Record<Well, FieldItem[]>>;
  sort?: { field: FieldItem; desc: boolean } | null;
  text?: TextRun[][];
  options?: {
    slicer_mode?: string | null;
    labels?: boolean;
    /** Formas. */
    shape?: ShapeKind;
    fill?: string | null;
    line_color?: string | null;
    line_width?: number;
    /** Imagem (data URL) e ajuste. */
    src?: string | null;
    fit?: "contain" | "cover" | "fill";
    /** Botão. */
    action?: ButtonAction;
    label?: string | null;
    /** Exibir os dados do gráfico como tabela (menu "..."). */
    as_table?: boolean;
    [k: string]: unknown;
  };
  /** Filtros desta visual. */
  filters?: ReportFilter[];
  /** Oculta no painel Seleção (a visual continua filtrando, como no Power BI). */
  hidden?: boolean;
  style?: VisualStyle;
}

export type Well = "category" | "values" | "values2" | "legend" | "rows" | "columns";

/** Filtro de relatório/página/visual (também guarda a seleção da segmentação). */
export interface ReportFilter {
  field: FieldItem;
  values?: unknown[];
  exclude?: boolean;
  cmp?: Cmp;
  value?: unknown;
}

export interface Page {
  id: string;
  name: string;
  width: number;
  height: number;
  visuals: Visual[];
  filters?: ReportFilter[];
  /** Segundo plano da página (sobrepõe o do tema). */
  background?: string | null;
}

export interface Theme {
  name?: string;
  colors?: string[];
  background?: string;
  foreground?: string;
  table_accent?: string;
  page_background?: string;
  visual_background?: string;
}

export interface Report {
  theme?: Theme | null;
  pages: Page[];
  filters?: ReportFilter[];
  /** Último tema próprio (importado do .pbix ou de um JSON), para poder voltar a ele pela galeria. */
  custom_theme?: Theme | null;
  /** Papel de parede: área em volta da página. */
  wallpaper?: string | null;
  /** Posições das tabelas na visão Modelo. */
  model_layout?: Record<string, { x: number; y: number }>;
}

export interface ImportSummary {
  tables: number;
  rows: number;
  measures: number;
  relationships: number;
  pages: number;
  visuals: number;
  warnings: string[];
}
