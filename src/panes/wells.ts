// Definição dos "poços" de campos de cada tipo de visual.

import { columnDtype, isNumeric } from "../queryBuilder";
import type { FieldItem, Model, Visual, VisualType, Well } from "../types";

export const DRAG_MIME = "application/x-freebi-field";

export interface WellDef {
  key: Well;
  label: string;
  max?: number;
  /** Aceita colunas como grupo (sem agregação). */
  grouping?: boolean;
}

export const VISUALS: { type: VisualType; label: string; icon: string }[] = [
  { type: "column", label: "Colunas agrupadas", icon: "▥" },
  { type: "stacked_column", label: "Colunas empilhadas", icon: "▤" },
  { type: "bar", label: "Barras agrupadas", icon: "☰" },
  { type: "stacked_bar", label: "Barras empilhadas", icon: "≣" },
  { type: "line", label: "Linhas", icon: "📈" },
  { type: "area", label: "Área", icon: "◭" },
  { type: "combo", label: "Colunas e linha", icon: "⫶" },
  { type: "pie", label: "Pizza", icon: "◔" },
  { type: "donut", label: "Rosca", icon: "◯" },
  { type: "funnel", label: "Funil", icon: "⏷" },
  { type: "treemap", label: "Treemap", icon: "▦" },
  { type: "scatter", label: "Dispersão", icon: "⁘" },
  { type: "card", label: "Cartão", icon: "▭" },
  { type: "gauge", label: "Medidor", icon: "◠" },
  { type: "table", label: "Tabela", icon: "▦" },
  { type: "matrix", label: "Matriz", icon: "⊞" },
  { type: "slicer", label: "Segmentação", icon: "☑" },
  { type: "text", label: "Caixa de texto", icon: "T" },
];

export function wellsFor(t: VisualType): WellDef[] {
  switch (t) {
    case "card":
      return [{ key: "values", label: "Campos" }];
    case "gauge":
      return [{ key: "values", label: "Valor · Máximo", max: 2 }];
    case "slicer":
      return [{ key: "category", label: "Campo", max: 1, grouping: true }];
    case "table":
      return [{ key: "columns", label: "Colunas", grouping: true }];
    case "matrix":
      return [
        { key: "rows", label: "Linhas", grouping: true },
        { key: "columns", label: "Valores" },
      ];
    case "pie":
    case "donut":
    case "funnel":
    case "treemap":
      return [
        { key: "category", label: "Legenda / Categoria", max: 1, grouping: true },
        { key: "values", label: "Valores", max: 1 },
      ];
    case "scatter":
      return [
        { key: "category", label: "Detalhes", max: 1, grouping: true },
        { key: "values", label: "Eixo X · Eixo Y · Tamanho", max: 3 },
      ];
    case "combo":
      return [
        { key: "category", label: "Eixo X", max: 1, grouping: true },
        { key: "values", label: "Eixo Y da coluna" },
        { key: "values2", label: "Eixo Y da linha" },
      ];
    case "text":
    case "shape":
    case "image":
    case "button":
    case "unsupported":
      return [];
    default:
      return [
        { key: "category", label: t === "bar" || t === "stacked_bar" ? "Eixo Y" : "Eixo X", max: 1, grouping: true },
        { key: "values", label: t === "bar" || t === "stacked_bar" ? "Eixo X" : "Eixo Y" },
        { key: "legend", label: "Legenda", max: 1, grouping: true },
      ];
  }
}

/** Ao trocar o tipo, redistribui os campos para os poços do novo tipo. */
export function convertVisual(v: Visual, to: VisualType): Visual {
  const all = Object.values(v.fields).flat().filter(Boolean) as FieldItem[];
  const groups = all.filter((f) => f.kind === "column" && (!f.agg || f.agg === "none"));
  const values = all.filter((f) => !(f.kind === "column" && (!f.agg || f.agg === "none")));
  const fields: Visual["fields"] = {};
  const wells = wellsFor(to);
  if (to === "table") fields.columns = [...groups, ...values];
  else if (to === "card" || to === "gauge") fields.values = values.slice(0, to === "gauge" ? 2 : undefined);
  else if (to === "matrix") {
    fields.rows = groups;
    fields.columns = values;
  } else {
    if (wells.some((w) => w.key === "category")) fields.category = groups.slice(0, 1);
    if (wells.some((w) => w.key === "values")) fields.values = values;
    if (wells.some((w) => w.key === "legend") && groups[1]) fields.legend = [groups[1]];
  }
  return { ...v, type: to, fields, sort: null };
}

/** Adiciona um campo no poço mais adequado (como o clique na caixa de seleção do Power BI). */
export function addFieldToVisual(model: Model, v: Visual, f: FieldItem, target?: Well): Visual {
  const wells = wellsFor(v.type);
  if (wells.length === 0) return v;
  const dtype = f.kind === "column" ? columnDtype(model, f) : undefined;
  const numericCol = f.kind === "column" && isNumeric(dtype) && !/(^id|_id$|^id_|ano|year|mes|month|codigo|código)/i.test(f.name);
  let well = target ? wells.find((w) => w.key === target) : undefined;
  if (!well) {
    const wantsValue = f.kind === "measure" || numericCol;
    well =
      (wantsValue ? wells.find((w) => !w.grouping) : wells.find((w) => w.grouping)) ??
      wells.find((w) => (v.fields[w.key]?.length ?? 0) < (w.max ?? 99)) ??
      wells[0];
  }
  let item: FieldItem = { ...f };
  if (item.kind === "column" && !well.grouping && (!item.agg || item.agg === "none")) {
    item = { ...item, agg: isNumeric(dtype) ? "sum" : "count" };
  }
  if (item.kind === "column" && well.grouping && v.type !== "table") item = { ...item, agg: null };
  const cur = v.fields[well.key] ?? [];
  const next = well.max && cur.length >= well.max ? [...cur.slice(0, well.max - 1), item] : [...cur, item];
  return { ...v, fields: { ...v.fields, [well.key]: next } };
}
