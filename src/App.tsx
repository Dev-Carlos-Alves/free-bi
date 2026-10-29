import { useEffect } from "react";
import { getData, importPbix, newProject, openProject, refreshData, saveProject } from "./actions";
import { Dialogs, openDialog } from "./components/dialogs";
import { FieldsPane } from "./panes/FieldsPane";
import { FiltersPane } from "./panes/FiltersPane";
import { VisualizationsPane } from "./panes/VisualizationsPane";
import { useStore, type View } from "./store";
import { DataView } from "./views/DataView";
import { ModelView } from "./views/ModelView";
import { remove, ReportView } from "./views/ReportView";

export function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const dirty = useStore((s) => s.dirty);
  const path = useStore((s) => s.projectPath);
  const model = useStore((s) => s.model);

  useEffect(() => {
    void useStore.getState().reloadModel();
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = (e.target as HTMLElement).closest("input,textarea,select");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openProject();
      } else if (!typing && mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (!typing && mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && s.selectedVisual && s.view === "report") {
        e.preventDefault();
        remove(s.selectedVisual);
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
  const firstTable = model.tables[0]?.name;

  return (
    <div className="app">
      <header className="ribbon">
        <div className="brand">
          <span className="logo">▮▮▮</span> Free BI
        </div>
        <div className="rgroup">
          <button onClick={newProject} title="Novo relatório">📄<span>Novo</span></button>
          <button onClick={openProject} title="Abrir projeto .freebi (Ctrl+O)">📂<span>Abrir</span></button>
          <button onClick={() => saveProject(false)} title="Salvar (Ctrl+S)">💾<span>Salvar</span></button>
          <button onClick={() => saveProject(true)} title="Salvar como (Ctrl+Shift+S)">🗂<span>Salvar como</span></button>
        </div>
        <div className="rgroup">
          <button className="accent" onClick={getData} title="CSV, Excel, Parquet, JSON">🛢<span>Obter dados</span></button>
          <button onClick={importPbix} title="Abrir um relatório do Power BI (.pbix)">⇪<span>Importar .pbix</span></button>
          <button onClick={refreshData} title="Recarregar arquivos de origem">⟳<span>Atualizar</span></button>
        </div>
        <div className="rgroup">
          <button disabled={!firstTable} onClick={() => openDialog({ kind: "measure", table: firstTable! })}>ƒx<span>Nova medida</span></button>
          <button disabled={!firstTable} onClick={() => openDialog({ kind: "calc-column", table: firstTable! })}>ƒ<span>Nova coluna</span></button>
        </div>
        <div className="rgroup">
          <button onClick={() => useStore.getState().undo()} title="Desfazer (Ctrl+Z)">↶<span>Desfazer</span></button>
          <button onClick={() => useStore.getState().redo()} title="Refazer (Ctrl+Y)">↷<span>Refazer</span></button>
        </div>
        <span className="grow" />
        <button className="about" onClick={() => openDialog({ kind: "about" })}>?</button>
      </header>
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
        {view === "report" && (
          <aside className="panes">
            <FiltersPane />
            <VisualizationsPane />
            <FieldsPane />
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
