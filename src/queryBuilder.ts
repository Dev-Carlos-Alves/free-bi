// Converte uma visual do relatório numa consulta do motor.

import type { Agg, FieldItem, FieldRef, Filter, Model, Page, Report, ReportFilter, ValueSpec, Visual, VisualQuery } from "./types";
import type { CrossFilter } from "./store";

export function fieldRef(f: FieldItem): FieldRef {
  return { table: f.table, column: f.name, date_part: f.date_part ?? null };
}

export function columnDtype(model: Model, f: FieldItem): string | undefined {
  return model.tables.find((t) => t.name === f.table)?.columns.find((c) => c.name === f.name)?.dtype;
}

export function isNumeric(dtype?: string) {
  return dtype === "integer" || dtype === "decimal";
}

/** Agregação padrão para uma coluna usada como valor (como o Power BI faz). */
export function defaultAgg(model: Model, f: FieldItem): Agg {
  return isNumeric(columnDtype(model, f)) ? "sum" : "count";
}

export function valueSpec(model: Model, f: FieldItem): ValueSpec {
  if (f.kind === "measure") return { kind: "measure", name: f.name };
  return { kind: "column", field: fieldRef(f), agg: (f.agg && f.agg !== "none" ? f.agg : defaultAgg(model, f)) as Agg };
}

export function toFilter(rf: ReportFilter): Filter | null {
  const field = fieldRef(rf.field);
  if (rf.values && rf.values.length > 0) return { field, type: rf.exclude ? "not_in" : "in", values: rf.values };
  if (rf.cmp) return { field, type: "compare", cmp: rf.cmp, value: rf.value ?? null };
  return null;
}

export function sameField(a: FieldItem, b: FieldItem) {
  return a.table === b.table && a.name === b.name && (a.date_part ?? null) === (b.date_part ?? null) && a.kind === b.kind;
}

/** Filtros que valem para uma visual: relatório, página, segmentações, seleção cruzada e da própria visual. */
export function filtersFor(report: Report, page: Page, v: Visual, cross: CrossFilter | null): Filter[] {
  const out: Filter[] = [];
  const add = (rf?: ReportFilter[]) => rf?.forEach((f) => {
    const x = toFilter(f);
    if (x) out.push(x);
  });
  add(report.filters);
  add(page.filters);
  add(v.filters);
  for (const s of page.visuals) {
    if (s.type !== "slicer" || s.id === v.id) continue;
    const field = s.fields.category?.[0];
    const sel = s.options?.selected as unknown[] | undefined;
    if (field && sel && sel.length) out.push({ field: fieldRef(field), type: "in", values: sel });
  }
  if (cross && cross.visualId !== v.id && v.type !== "slicer") {
    out.push({ field: fieldRef(cross.field), type: "in", values: cross.values });
  }
  return out;
}

export interface Plan {
  query: VisualQuery;
  /** Itens de grupo e de valor, na ordem das colunas do resultado. */
  keys: FieldItem[];
  vals: FieldItem[];
}

const CHART_LIMIT = 1000;

export function planFor(model: Model, report: Report, page: Page, v: Visual, cross: CrossFilter | null): Plan | null {
  const f = v.fields;
  const filters = filtersFor(report, page, v, cross);
  let keys: FieldItem[] = [];
  let vals: FieldItem[] = [];
  let limit: number | null = CHART_LIMIT;
  let totals = false;
  switch (v.type) {
    case "text":
    case "shape":
    case "unsupported":
      return null;
    case "card":
    case "gauge":
      vals = f.values ?? [];
      limit = null;
      break;
    case "slicer":
      keys = f.category ?? [];
      limit = 5000;
      break;
    case "table":
    case "matrix": {
      const all = [...(f.rows ?? []), ...(f.columns ?? [])];
      keys = all.filter((x) => x.kind === "column" && (!x.agg || x.agg === "none"));
      vals = all.filter((x) => !(x.kind === "column" && (!x.agg || x.agg === "none")));
      limit = 5000;
      totals = vals.length > 0;
      break;
    }
    case "scatter":
      keys = f.category ?? [];
      vals = f.values ?? [];
      break;
    default:
      keys = [...(f.category ?? []).slice(0, 1), ...(f.legend ?? []).slice(0, 1)];
      vals = [...(f.values ?? []), ...(f.values2 ?? [])];
  }
  if (keys.length === 0 && vals.length === 0) return null;

  let sort_by: number | null = null;
  let sort_desc = false;
  if (v.sort) {
    const ki = keys.findIndex((k) => sameField(k, v.sort!.field));
    const vi = vals.findIndex((k) => sameField(k, v.sort!.field) || (k.name === v.sort!.field.name && k.table === v.sort!.field.table));
    if (ki >= 0) sort_by = ki;
    else if (vi >= 0) sort_by = keys.length + vi;
    sort_desc = v.sort.desc;
  } else if (keys.length && vals.length && ["bar", "column", "stacked_bar", "stacked_column", "pie", "donut", "funnel", "treemap"].includes(v.type)) {
    // Padrão do Power BI: eixo de texto ordena pelo valor (maior primeiro); números/datas, pelo eixo.
    const dt = keys[0].date_part ? "integer" : columnDtype(model, keys[0]);
    if (!(isNumeric(dt) || dt === "date" || dt === "datetime")) {
      sort_by = keys.length;
      sort_desc = true;
    }
  } else if (v.type === "table" && vals.length) {
    sort_by = keys.length;
    sort_desc = true;
  }
  // Com legenda, a ordenação por valor é feita no cliente após pivotar.
  if (v.type !== "table" && v.type !== "matrix" && (f.legend?.length ?? 0) > 0 && sort_by !== null && sort_by >= keys.length) sort_by = null;

  return {
    keys,
    vals,
    query: {
      group_by: keys.map(fieldRef),
      values: vals.map((x) => valueSpec(model, x)),
      filters,
      sort_by,
      sort_desc,
      limit,
      totals,
    },
  };
}

export function itemLabel(f: FieldItem): string {
  if (f.label) return f.label;
  const part = f.date_part ? { year: "Ano", quarter: "Trimestre", month: "Mês", day: "Dia" }[f.date_part] : null;
  const agg = f.kind === "column" && f.agg && f.agg !== "none"
    ? { sum: "Soma de ", avg: "Média de ", min: "Mín. de ", max: "Máx. de ", count: "Contagem de ", distinct_count: "Contagem distinta de ", none: "" }[f.agg]
    : "";
  return `${agg}${f.name}${part ? ` (${part})` : ""}`;
}

export function measureFormat(model: Model, f: FieldItem): string | null {
  if (f.kind !== "measure") return null;
  return model.measures.find((m) => m.name === f.name)?.format ?? null;
}
