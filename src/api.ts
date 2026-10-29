// Ponte com o motor em Rust: via Tauri (app desktop) ou HTTP (modo navegador, `freebi-web`).

import type { ImportSummary, Measure, Model, QueryResult, Relationship, Report, Step, VisualQuery } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("call", { cmd, args });
  }
  const res = await fetch(`/api/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return (text ? JSON.parse(text) : null) as T;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Abre um seletor de arquivo e devolve o caminho que o motor consegue ler. */
export async function pickFile(filters: FileFilter[]): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, filters });
    return typeof r === "string" ? r : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      if (!res.ok) throw new Error(await res.text());
      resolve(((await res.json()) as { path: string }).path);
    };
    input.click();
  });
}

/** Escolhe onde salvar. No navegador o arquivo é gerado no servidor e baixado em seguida. */
export async function pickSavePath(defaultName: string): Promise<{ path: string; download: boolean } | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const r = await save({ defaultPath: defaultName, filters: [{ name: "Projeto Free BI", extensions: ["freebi"] }] });
    return r ? { path: r.endsWith(".freebi") ? r : r + ".freebi", download: false } : null;
  }
  const name = window.prompt("Nome do arquivo", defaultName);
  if (!name) return null;
  const res = await fetch(`/api/temp_path?name=${encodeURIComponent(name.endsWith(".freebi") ? name : name + ".freebi")}`);
  return { path: ((await res.json()) as { path: string }).path, download: true };
}

/** Caminho para salvar um arquivo qualquer (CSV etc.). */
export async function pickExportPath(defaultName: string, ext: string): Promise<{ path: string; download: boolean } | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const r = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return r ? { path: r, download: false } : null;
  }
  const res = await fetch(`/api/temp_path?name=${encodeURIComponent(defaultName)}`);
  return { path: ((await res.json()) as { path: string }).path, download: true };
}

export function downloadServerFile(path: string) {
  const a = document.createElement("a");
  a.href = `/api/download?path=${encodeURIComponent(path)}`;
  a.download = path.split(/[\\/]/).pop() ?? "projeto.freebi";
  a.click();
}

export const api = {
  model: () => call<Model>("model"),
  reportGet: () => call<Report | null>("report_get"),
  reportSet: (report: Report) => call("report_set", { report }),
  queries: (queries: VisualQuery[]) => call<({ ok: QueryResult } | { error: string })[]>("queries", { queries }),
  query: (query: VisualQuery) => call<QueryResult>("query", { query }),
  exportCsv: (query: VisualQuery, path: string) => call<{ rows: number }>("export_csv", { query, path }),
  tablePage: (table: string, offset: number, limit: number, sort?: string | null, desc?: boolean) =>
    call<QueryResult>("table_page", { table, offset, limit, sort, desc }),
  excelSheets: (path: string) => call<string[]>("excel_sheets", { path }),
  loadFile: (path: string, sheets?: string[]) => call<{ added: string[]; relationships: Relationship[] }>("load_file", { path, sheets }),
  importPbix: (path: string) => call<ImportSummary>("import_pbix", { path }),
  saveProject: (path: string) => call("save_project", { path }),
  openProject: (path: string) => call("open_project", { path }),
  newProject: () => call("new_project"),
  refresh: () => call<string[]>("refresh"),
  setSteps: (table: string, steps: Step[]) => call<string[]>("set_steps", { table, steps }),
  addStep: (table: string, step: Step) => call("add_step", { table, step }),
  renameTable: (from: string, to: string) => call("rename_table", { from, to }),
  deleteTable: (name: string) => call("delete_table", { name }),
  addCalcColumn: (table: string, name: string, expression: string) => call("add_calc_column", { table, name, expression }),
  removeCalcColumn: (table: string, name: string) => call("remove_calc_column", { table, name }),
  evalMeasure: (table: string, expression: string) => call<unknown>("eval_measure", { table, expression }),
  setMeasure: (measure: Measure, old_name?: string) => call<{ value: unknown }>("set_measure", { measure, old_name }),
  deleteMeasure: (name: string) => call("delete_measure", { name }),
  addRelationship: (relationship: Omit<Relationship, "id"> & { id?: string }) =>
    call<Relationship>("add_relationship", { relationship: { id: "", ...relationship } }),
  deleteRelationship: (id: string) => call("delete_relationship", { id }),
  setRelationshipActive: (id: string, active: boolean) => call("set_relationship_active", { id, active }),
  setSortBy: (table: string, column: string, by: string | null) => call("set_sort_by", { table, column, by }),
  detectRelationships: () => call<Relationship[]>("detect_relationships"),
  columnStats: (table: string, column: string) =>
    call<{ count: number; nulls: number; distinct: number; min: number | null; max: number | null }>("column_stats", { table, column }),
};

export { isTauri };
