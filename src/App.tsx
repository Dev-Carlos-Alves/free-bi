import { useEffect } from "react";
import { openProject, saveProject } from "./actions";
import { Dialogs } from "./components/dialogs";
import { Ribbon } from "./components/Ribbon";
import { FieldsPane } from "./panes/FieldsPane";
import { FiltersPane } from "./panes/FiltersPane";
import { SelectionPane } from "./panes/SelectionPane";
import { VisualizationsPane } from "./panes/VisualizationsPane";
import { copyVisual, cutVisual, pasteVisual, removeVisual } from "./reportOps";
import { useStore, type View } from "./store";
import { DataView } from "./views/DataView";
import { ModelView } from "./views/ModelView";
import { ReportView } from "./views/ReportView";

export function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const dirty = useStore((s) => s.dirty);
  const path = useStore((s) => s.projectPath);
  const panes = useStore((s) => s.prefs.panes);

  useEffect(() => {
    void useStore.getState().reloadModel();
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = (e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable]");
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const onReport = s.view === "report";
      if (mod && key === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (mod && key === "o") {
        e.preventDefault();
        void openProject();
      } else if (typing) {
        return;
      } else if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        s.redo();
      } else if (onReport && mod && key === "c" && s.selectedVisual) {
        e.preventDefault();
        copyVisual();
      } else if (onReport && mod && key === "x" && s.selectedVisual) {
        e.preventDefault();
        cutVisual();
      } else if (onReport && mod && key === "v" && s.clipboard) {
        e.preventDefault();
        pasteVisual();
      } else if (e.key === "Escape") {
        if (s.painter) useStore.setState({ painter: null });
        else if (s.focusVisual) useStore.setState({ focusVisual: null });
      } else if (onReport && (e.key === "Delete" || e.key === "Backspace") && s.selectedVisual) {
        e.preventDefault();
        removeVisual(s.selectedVisual);
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  useEffect(() => {
    const name = path ? path.split(/[\\/]/).pop() : "Sem título";
    document.title = `${dirty ? "● " : ""}${name} — Free BI`;
  }, [dirty, path]);

  const nav: { v: View; icon: string; label: string }[] = [
    { v: "report", icon: "▥", label: "Relatório" },
    { v: "data", icon: "▦", label: "Dados" },
    { v: "model", icon: "⛓", label: "Modelo" },
  ];
  const anyPane = panes.filters || panes.visualizations || panes.fields || panes.selection;

  return (
    <div className="app">
      <Ribbon />
      <div className="body">
        <nav className="leftnav">
          {nav.map((n) => (
            <button key={n.v} className={view === n.v ? "active" : ""} onClick={() => setView(n.v)} title={n.label}>
              <span>{n.icon}</span>
              <small>{n.label}</small>
            </button>
          ))}
        </nav>
        <main className="main">
          {view === "report" && <ReportView />}
          {view === "data" && <DataView />}
          {view === "model" && <ModelView />}
        </main>
        {view === "report" && anyPane && (
          <aside className="panes">
            {panes.selection && <SelectionPane />}
            {panes.filters && <FiltersPane />}
            {panes.visualizations && <VisualizationsPane />}
            {panes.fields && <FieldsPane />}
          </aside>
        )}
        {view === "data" && (
          <aside className="panes single">
            <FieldsPane />
          </aside>
        )}
      </div>
      {busy && (
        <div className="busy">
          <div className="spinner" /> {busy}
        </div>
      )}
      {toast && <div className={`toast ${toast.kind}`} onClick={() => useStore.setState({ toast: null })}>{toast.text}</div>}
      <Dialogs />
    </div>
  );
}
