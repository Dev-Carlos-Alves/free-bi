import { useEffect, useRef, useState } from "react";
import { errorText, newId, useStore } from "../store";
import { api, downloadServerFile, pickExportPath } from "../api";
import { planFor } from "../queryBuilder";
import type { FieldItem, Page, Visual } from "../types";
import { VisualHost } from "../visuals/VisualHost";
import { addFieldToVisual, DRAG_MIME } from "../panes/wells";
import { getData, importPbix, openProject } from "../actions";

const GRID = 8;
const snap = (n: number) => Math.round(n / GRID) * GRID;

export function ReportView() {
  const report = useStore((s) => s.report);
  const pageIndex = useStore((s) => s.pageIndex);
  const page = report.pages[pageIndex] ?? report.pages[0];
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min((el.clientWidth - 32) / page.width, (el.clientHeight - 32) / page.height);
      setScale(Math.max(0.2, s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.width, page.height]);

  const hasData = useStore((s) => s.model.tables.length > 0);
  const theme = report.theme ?? {};
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const field = JSON.parse(raw) as FieldItem;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = snap((e.clientX - rect.left) / scale - 160);
    const y = snap((e.clientY - rect.top) / scale - 100);
    createVisualWithField(field, Math.max(0, x), Math.max(0, y));
  };

  return (
    <div className="report-view">
      <div className="canvas-wrap" ref={wrap} onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().select(null)}>
        <div className="canvas-sizer" style={{ width: page.width * scale, height: page.height * scale }}>
        <div
          className="canvas"
          style={{
            width: page.width,
            height: page.height,
            transform: `scale(${scale})`,
            background: theme.page_background ?? "#FFFFFF",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              useStore.getState().select(null);
              useStore.getState().setCrossFilter(null);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          {page.visuals.length === 0 && (
            <div className="canvas-empty">
              {hasData ? (
                <>
                  <h2>Página em branco</h2>
                  <p>Escolha uma visual no painel <b>Visualizações</b> ou arraste um campo para cá.</p>
                </>
              ) : (
                <>
                  <h1>Bem-vindo ao Free BI</h1>
                  <p>Comece trazendo seus dados:</p>
                  <div className="start-actions">
                    <button className="primary" onClick={importPbix}>⇪ Importar relatório do Power BI (.pbix)</button>
                    <button onClick={getData}>🛢 Obter dados (CSV, Excel, Parquet, JSON)</button>
                    <button onClick={openProject}>📂 Abrir projeto .freebi</button>
                  </div>
                </>
              )}
            </div>
          )}
          {page.visuals.map((v) => (
            <VisualFrame key={v.id} visual={v} page={page} scale={scale} />
          ))}
        </div>
        </div>
      </div>
      <PageTabs />
    </div>
  );
}

export function createVisualWithField(field: FieldItem, x: number, y: number) {
  const s = useStore.getState();
  const numeric = field.kind === "measure";
  const v: Visual = {
    id: newId(),
    type: numeric ? "card" : "column",
    x,
    y,
    w: numeric ? 240 : 420,
    h: numeric ? 120 : 280,
    title: null,
    fields: {},
    options: { labels: false },
  };
  const filled = addFieldToVisual(s.model, v, field);
  s.updatePage((p) => ({ ...p, visuals: [...p.visuals, filled] }));
  s.select(v.id);
}

function VisualFrame({ visual, page, scale }: { visual: Visual; page: Page; scale: number }) {
  const selected = useStore((s) => s.selectedVisual === visual.id);
  const theme = useStore((s) => s.report.theme);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const box = drag ?? visual;

  const startDrag = (e: React.MouseEvent, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (mode === "move" && target.closest("input,button,select,textarea,.slicer-list,.tablewrap,a")) {
      useStore.getState().select(visual.id);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    useStore.getState().select(visual.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { x: visual.x, y: visual.y, w: visual.w, h: visual.h };
    let moved = false;
    let last = start;
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      last =
        mode === "move"
          ? { ...start, x: clamp(snap(start.x + dx), 0, page.width - start.w), y: clamp(snap(start.y + dy), 0, page.height - start.h) }
          : { ...start, w: clamp(snap(start.w + dx), 80, page.width - start.x), h: clamp(snap(start.h + dy), 48, page.height - start.y) };
      setDrag(last);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      if (moved) useStore.getState().updateVisual(visual.id, (v) => ({ ...v, ...last }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const transparent = visual.type === "text" || visual.type === "shape";
  return (
    <div
      className={`visual ${selected ? "selected" : ""} type-${visual.type}`}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        background: transparent ? "transparent" : theme?.visual_background ?? "#FFFFFF",
        boxShadow: transparent ? "none" : undefined,
      }}
      onMouseDown={(e) => startDrag(e, "move")}
    >
      {visual.title && visual.type !== "text" && <div className="visual-title" style={{ color: theme?.foreground ?? undefined }}>{visual.title}</div>}
      <div className="visual-body">
        <VisualHost visual={visual} page={page} />
      </div>
      {selected && (
        <>
          <div className="resize" onMouseDown={(e) => startDrag(e, "resize")} />
          <div className="visual-tools">
            <button title="Exportar dados (CSV)" onMouseDown={(e) => e.stopPropagation()} onClick={() => exportVisual(visual, page)}>⇩</button>
            <button title="Duplicar" onMouseDown={(e) => e.stopPropagation()} onClick={() => duplicate(visual)}>⧉</button>
            <button title="Excluir (Delete)" onMouseDown={(e) => e.stopPropagation()} onClick={() => remove(visual.id)}>✕</button>
          </div>
        </>
      )}
    </div>
  );
}

async function exportVisual(v: Visual, page: Page) {
  const s = useStore.getState();
  const plan = planFor(s.model, s.report, page, v, s.crossFilter);
  if (!plan) return s.notify("Esta visual não tem dados para exportar.");
  const name = `${(v.title ?? v.type).replace(/[\\/:*?"<>|]/g, "_")}.csv`;
  const target = await pickExportPath(name, "csv");
  if (!target) return;
  try {
    const r = await api.exportCsv(plan.query, target.path);
    if (target.download) downloadServerFile(target.path);
    s.notify(`${r.rows.toLocaleString("pt-BR")} linhas exportadas.`);
  } catch (e) {
    s.notify(errorText(e), "error");
  }
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function remove(id: string) {
  const s = useStore.getState();
  s.updatePage((p) => ({ ...p, visuals: p.visuals.filter((v) => v.id !== id) }));
  s.select(null);
  if (s.crossFilter?.visualId === id) s.setCrossFilter(null);
}

function duplicate(v: Visual) {
  const s = useStore.getState();
  const copy = { ...structuredClone(v), id: newId(), x: v.x + 24, y: v.y + 24 };
  s.updatePage((p) => ({ ...p, visuals: [...p.visuals, copy] }));
  s.select(copy.id);
}

function PageTabs() {
  const report = useStore((s) => s.report);
  const pageIndex = useStore((s) => s.pageIndex);
  const setPage = useStore((s) => s.setPage);
  const setReport = useStore((s) => s.setReport);
  const [editing, setEditing] = useState<number | null>(null);

  const addPage = () => {
    const n = report.pages.length + 1;
    const p: Page = { id: newId("p"), name: `Página ${n}`, width: 1280, height: 720, visuals: [] };
    setReport({ ...report, pages: [...report.pages, p] });
    setPage(report.pages.length);
  };
  const delPage = (i: number) => {
    if (report.pages.length === 1) return;
    if (!confirm(`Excluir a página "${report.pages[i].name}"?`)) return;
    setReport({ ...report, pages: report.pages.filter((_, j) => j !== i) });
    setPage(Math.max(0, i - 1));
  };
  return (
    <div className="page-tabs">
      {report.pages.map((p, i) =>
        editing === i ? (
          <input
            key={p.id}
            autoFocus
            className="page-tab editing"
            defaultValue={p.name}
            onBlur={(e) => {
              setReport({ ...report, pages: report.pages.map((x, j) => (j === i ? { ...x, name: e.target.value || x.name } : x)) });
              setEditing(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button
            key={p.id}
            className={`page-tab ${i === pageIndex ? "active" : ""}`}
            onClick={() => setPage(i)}
            onDoubleClick={() => setEditing(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              delPage(i);
            }}
            title="Duplo clique: renomear · Botão direito: excluir"
          >
            {p.name}
          </button>
        ),
      )}
      <button className="page-tab add" onClick={addPage} title="Nova página">+</button>
    </div>
  );
}
