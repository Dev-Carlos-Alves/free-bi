// Estado global da aplicação (zustand).

import { create } from "zustand";
import { api } from "./api";
import type { FieldItem, Model, Page, Report, Visual } from "./types";

export type View = "report" | "data" | "model";

export interface CrossFilter {
  visualId: string;
  field: FieldItem;
  values: unknown[];
}

interface State {
  model: Model;
  report: Report;
  view: View;
  pageIndex: number;
  selectedVisual: string | null;
  crossFilter: CrossFilter | null;
  projectPath: string | null;
  dirty: boolean;
  /** Incrementado sempre que os dados/modelo mudam, para reexecutar consultas. */
  dataVersion: number;
  toast: { kind: "info" | "error"; text: string } | null;
  busy: string | null;
  history: Report[];
  future: Report[];

  setView: (v: View) => void;
  setPage: (i: number) => void;
  select: (id: string | null) => void;
  setCrossFilter: (cf: CrossFilter | null) => void;
  reloadModel: () => Promise<void>;
  setReport: (r: Report, opts?: { history?: boolean }) => void;
  updatePage: (fn: (p: Page) => Page) => void;
  updateVisual: (id: string, fn: (v: Visual) => Visual) => void;
  notify: (text: string, kind?: "info" | "error") => void;
  setBusy: (b: string | null) => void;
  setProjectPath: (p: string | null) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
}

export const emptyReport = (): Report => ({
  theme: null,
  pages: [{ id: "p1", name: "Página 1", width: 1280, height: 720, visuals: [] }],
});

export const useStore = create<State>((set, get) => ({
  model: { tables: [], measures: [], relationships: [] },
  report: emptyReport(),
  view: "report",
  pageIndex: 0,
  selectedVisual: null,
  crossFilter: null,
  projectPath: null,
  dirty: false,
  dataVersion: 0,
  toast: null,
  busy: null,
  history: [],
  future: [],

  setView: (view) => set({ view }),
  setPage: (pageIndex) => set({ pageIndex, selectedVisual: null, crossFilter: null }),
  select: (selectedVisual) => set({ selectedVisual }),
  setCrossFilter: (crossFilter) => set({ crossFilter }),
  reloadModel: async () => {
    const model = await api.model();
    set((s) => ({ model, dataVersion: s.dataVersion + 1 }));
  },
  setReport: (report, opts = {}) =>
    set((s) => ({
      report,
      dirty: true,
      history: opts.history === false ? s.history : [...s.history.slice(-49), s.report],
      future: opts.history === false ? s.future : [],
      pageIndex: Math.min(s.pageIndex, Math.max(0, report.pages.length - 1)),
    })),
  updatePage: (fn) => {
    const { report, pageIndex, setReport } = get();
    const pages = report.pages.map((p, i) => (i === pageIndex ? fn(p) : p));
    setReport({ ...report, pages });
  },
  updateVisual: (id, fn) => get().updatePage((p) => ({ ...p, visuals: p.visuals.map((v) => (v.id === id ? fn(v) : v)) })),
  notify: (text, kind = "info") => {
    set({ toast: { text, kind } });
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null });
    }, kind === "error" ? 9000 : 4000);
  },
  setBusy: (busy) => set({ busy }),
  setProjectPath: (projectPath) => set({ projectPath }),
  markSaved: () => set({ dirty: false }),
  undo: () => {
    const { history, report, future } = get();
    const prev = history[history.length - 1];
    if (!prev) return;
    set({ report: prev, history: history.slice(0, -1), future: [report, ...future], dirty: true });
  },
  redo: () => {
    const { history, report, future } = get();
    const next = future[0];
    if (!next) return;
    set({ report: next, history: [...history, report], future: future.slice(1), dirty: true });
  },
}));

export function currentPage(): Page {
  const s = useStore.getState();
  return s.report.pages[s.pageIndex] ?? s.report.pages[0];
}

let seq = 0;
export function newId(prefix = "v"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
