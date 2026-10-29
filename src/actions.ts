// Ações de arquivo e dados (usadas pela faixa de opções e pelos atalhos).

import { api, downloadServerFile, pickFile, pickSavePath } from "./api";
import { openDialog } from "./components/dialogs";
import { emptyReport, errorText, useStore } from "./store";
import type { Report } from "./types";

async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const s = useStore.getState();
  s.setBusy(label);
  try {
    return await fn();
  } catch (e) {
    s.notify(errorText(e), "error");
    return undefined;
  } finally {
    s.setBusy(null);
  }
}

function confirmDiscard(): boolean {
  return !useStore.getState().dirty || confirm("Há alterações não salvas. Continuar mesmo assim?");
}

export async function getData() {
  const path = await pickFile([{ name: "Dados", extensions: ["csv", "txt", "tsv", "xlsx", "xlsm", "xls", "ods", "parquet", "json", "ndjson"] }]);
  if (!path) return;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const load = (sheets?: string[]) =>
    withBusy("Carregando dados…", async () => {
      const r = await api.loadFile(path, sheets);
      await useStore.getState().reloadModel();
      const rels = r.relationships.length ? ` e ${r.relationships.length} relação(ões) detectada(s)` : "";
      useStore.getState().notify(`Carregado: ${r.added.join(", ")}${rels}`);
    });
  if (["xlsx", "xlsm", "xls", "ods"].includes(ext)) {
    const sheets = await withBusy("Lendo planilhas…", () => api.excelSheets(path));
    if (!sheets) return;
    if (sheets.length === 1) return load(sheets);
    openDialog({ kind: "sheets", path, sheets, onDone: (sel) => void load(sel) });
    return;
  }
  return load();
}

export async function importPbix() {
  if (!confirmDiscard()) return;
  const path = await pickFile([{ name: "Power BI", extensions: ["pbix"] }]);
  if (!path) return;
  await withBusy("Importando .pbix (descompactando modelo VertiPaq)…", async () => {
    const summary = await api.importPbix(path);
    const report = ((await api.reportGet()) as Report | null) ?? emptyReport();
    const s = useStore.getState();
    if (!report.pages?.length) report.pages = emptyReport().pages;
    useStore.setState({ report, pageIndex: 0, selectedVisual: null, crossFilter: null, history: [], future: [], dirty: true, projectPath: null });
    await s.reloadModel();
    openDialog({ kind: "import-summary", summary, file: path });
  });
}

export async function openProject() {
  if (!confirmDiscard()) return;
  const path = await pickFile([{ name: "Projeto Free BI", extensions: ["freebi"] }]);
  if (!path) return;
  await withBusy("Abrindo projeto…", async () => {
    await api.openProject(path);
    const report = ((await api.reportGet()) as Report | null) ?? emptyReport();
    useStore.setState({ report, pageIndex: 0, selectedVisual: null, crossFilter: null, history: [], future: [], dirty: false, projectPath: path });
    await useStore.getState().reloadModel();
  });
}

export async function saveProject(as = false) {
  const s = useStore.getState();
  let target = s.projectPath && !as ? { path: s.projectPath, download: false } : null;
  if (!target) target = await pickSavePath("Relatorio.freebi");
  if (!target) return;
  const t = target;
  await withBusy("Salvando…", async () => {
    await api.reportSet(useStore.getState().report);
    await api.saveProject(t.path);
    if (t.download) downloadServerFile(t.path);
    else useStore.getState().setProjectPath(t.path);
    useStore.getState().markSaved();
    useStore.getState().notify("Projeto salvo.");
  });
}

export async function newProject() {
  if (!confirmDiscard()) return;
  await api.newProject();
  useStore.setState({ report: emptyReport(), pageIndex: 0, selectedVisual: null, crossFilter: null, history: [], future: [], dirty: false, projectPath: null });
  await useStore.getState().reloadModel();
}

export async function refreshData() {
  await withBusy("Atualizando dados das fontes…", async () => {
    const errs = await api.refresh();
    await useStore.getState().reloadModel();
    if (errs.length) useStore.getState().notify(errs.join("\n"), "error");
    else useStore.getState().notify("Dados atualizados.");
  });
}
