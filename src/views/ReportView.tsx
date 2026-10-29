import { useEffect, useRef, useState } from "react";
import { errorText, newId, useStore } from "../store";
import { api, downloadServerFile, pickExportPath } from "../api";
import { formatCategory } from "../format";
import { itemLabel, planFor, sameField } from "../queryBuilder";
import type { FieldItem, Page, ReportFilter, Visual, VisualStyle } from "../types";
import { VisualHost } from "../visuals/VisualHost";
import { addFieldToVisual, DRAG_MIME } from "../panes/wells";
import { getData, importPbix, openProject } from "../actions";
import { addPage, applyPainter, duplicateVisual, moveLayer, removeVisual, runButton } from "../reportOps";
import { visualName } from "../panes/SelectionPane";

const GRID = 8;
const CHARTS = new Set(["column", "stacked_column", "bar", "stacked_bar", "line", "area", "combo", "pie", "donut", "funnel", "treemap", "scatter"]);
/** Elementos decorativos: sem fundo de cartão nem cabeçalho de visual. */
const DECOR = new Set(["text", "shape", "image", "button"]);

function useSnap() {
  const snapOn = useStore((s) => s.prefs.snap);
  return (n: number) => (snapOn ? Math.round(n / GRID) * GRID : Math.round(n));
}

export function ReportView() {
  const report = useStore((s) => s.report);
  const pageIndex = useStore((s) => s.pageIndex);
  const prefs = useStore((s) => s.prefs);
  const painter = useStore((s) => s.painter);
  const focus = useStore((s) => s.focusVisual);
  const page = report.pages[pageIndex] ?? report.pages[0];
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const snap = useSnap();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const byW = (el.clientWidth - 32) / page.width;
      const byH = (el.clientHeight - 32) / page.height;
      const s = prefs.fit === "actual" ? 1 : prefs.fit === "width" ? byW : Math.min(byW, byH);
      setScale(Math.max(0.2, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.width, page.height, prefs.fit]);

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
  const focused = focus ? page.visuals.find((v) => v.id === focus) : null;

  return (
    <div className="report-view">
      <div
        className={`canvas-wrap ${painter ? "painting" : ""}`}
        ref={wrap}
        style={{ background: report.wallpaper ?? undefined }}
        onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().select(null)}
      >
        <div className="canvas-sizer" style={{ width: page.width * scale, height: page.height * scale }}>
          <div
            className="canvas"
            style={{
              width: page.width,
              height: page.height,
              transform: `scale(${scale})`,
              background: page.background ?? theme.page_background ?? "#FFFFFF",
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
            {prefs.gridlines && <div className="gridlines" />}
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
            {page.visuals.map((v) => (v.hidden ? null : <VisualFrame key={v.id} visual={v} page={page} scale={scale} />))}
          </div>
        </div>
        {focused && <FocusMode visual={focused} page={page} />}
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

/** Converte "#RRGGBB" + transparência (0–100) em rgba. */
function withAlpha(color: string, transparency = 0) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m || !transparency) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${1 - transparency / 100})`;
}

function frameStyle(visual: Visual, st: VisualStyle | undefined, themeBg: string | undefined): React.CSSProperties {
  const decor = DECOR.has(visual.type);
  const bg = st?.background ?? (decor ? null : themeBg ?? "#FFFFFF");
  return {
    background: bg ? withAlpha(bg, st?.transparency) : "transparent",
    border: st?.border_width ? `${st.border_width}px solid ${st.border_color ?? "#9CA3AF"}` : undefined,
    borderRadius: st?.radius ?? undefined,
    boxShadow: st?.shadow ? "0 4px 14px rgba(0,0,0,.18)" : decor || st?.shadow === false ? "none" : undefined,
  };
}

function VisualFrame({ visual, page, scale }: { visual: Visual; page: Page; scale: number }) {
  const selected = useStore((s) => s.selectedVisual === visual.id);
  const theme = useStore((s) => s.report.theme);
  const locked = useStore((s) => s.prefs.lock);
  const snap = useSnap();
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const box = drag ?? visual;

  const startDrag = (e: React.MouseEvent, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    const s = useStore.getState();
    if (s.painter) {
      e.preventDefault();
      e.stopPropagation();
      applyPainter(visual.id);
      s.select(visual.id);
      return;
    }
    // Como no Power BI Desktop: Ctrl+clique aciona o botão durante a edição.
    if (visual.type === "button" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runButton(visual.options?.action);
      return;
    }
    const target = e.target as HTMLElement;
    if (mode === "move" && target.closest("input,button,select,textarea,.slicer-list,.tablewrap,a,.vheader")) {
      s.select(visual.id);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    s.select(visual.id);
    if (locked) return;
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
          : { ...start, w: clamp(snap(start.w + dx), 16, page.width - start.x), h: clamp(snap(start.h + dy), 8, page.height - start.y) };
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

  const st = visual.style;
  const decor = DECOR.has(visual.type);
  return (
    <div
      className={`visual ${selected ? "selected" : ""} ${locked ? "locked" : ""} type-${visual.type}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, ...frameStyle(visual, st, theme?.visual_background) }}
      onMouseDown={(e) => startDrag(e, "move")}
      title={visual.type === "button" ? "Ctrl+clique para usar o botão" : undefined}
    >
      {visual.title && !decor && (
        <div
          className="visual-title"
          style={{ color: st?.title_color ?? theme?.foreground ?? undefined, fontSize: st?.title_size ?? undefined, textAlign: st?.title_align ?? undefined }}
        >
          {visual.title}
        </div>
      )}
      <div className={`visual-body ${decor ? "flush" : ""}`}>
        <VisualHost visual={visual} page={page} />
      </div>
      {!decor && <VisualHeader visual={visual} page={page} />}
      {decor && selected && (
        <div className="vheader">
          <VisualMenu visual={visual} page={page} />
        </div>
      )}
      {selected && !locked && <div className="resize" onMouseDown={(e) => startDrag(e, "resize")} />}
    </div>
  );
}

// ------------------------------------------------------------ cabeçalho da visual

function filterText(rf: ReportFilter, dtype?: string): string {
  const name = itemLabel(rf.field);
  if (rf.values?.length) {
    const vals = rf.values.slice(0, 3).map((v) => formatCategory(v, rf.field.date_part, dtype)).join(", ");
    const more = rf.values.length > 3 ? ` e mais ${rf.values.length - 3}` : "";
    return `${name} ${rf.exclude ? "não é" : "é"} ${vals}${more}`;
  }
  const cmp: Record<string, string> = { eq: "=", ne: "≠", gt: ">", ge: "≥", lt: "<", le: "≤", contains: "contém", not_contains: "não contém", starts_with: "começa com", ends_with: "termina com", is_null: "está em branco", not_null: "não está em branco" };
  return `${name} ${cmp[rf.cmp ?? ""] ?? rf.cmp ?? ""} ${rf.value ?? ""}`.trim();
}

/** Filtros e segmentações que afetam a visual (ícone de funil do cabeçalho). */
function appliedFilters(report: { filters?: ReportFilter[] }, page: Page, v: Visual) {
  const out: { scope: string; text: string }[] = [];
  const add = (scope: string, list?: ReportFilter[]) =>
    list?.forEach((f) => (f.values?.length || f.cmp) && out.push({ scope, text: filterText(f) }));
  add("Visual", v.filters);
  add("Página", page.filters);
  add("Todas as páginas", report.filters);
  for (const s of page.visuals) {
    if (s.type !== "slicer" || s.id === v.id) continue;
    const field = s.fields.category?.[0];
    const sel = s.options?.selected as unknown[] | undefined;
    if (field && sel?.length) out.push({ scope: "Segmentação", text: filterText({ field, values: sel }) });
  }
  return out;
}

function VisualHeader({ visual, page }: { visual: Visual; page: Page }) {
  const report = useStore((s) => s.report);
  const cross = useStore((s) => s.crossFilter);
  const [open, setOpen] = useState(false);
  const filters = appliedFilters(report, page, visual);
  if (cross && cross.visualId !== visual.id && visual.type !== "slicer")
    filters.push({ scope: "Realce cruzado", text: filterText({ field: cross.field, values: cross.values }) });
  return (
    <div className="vheader" onMouseDown={(e) => e.stopPropagation()}>
      {filters.length > 0 && (
        <div className="vh-wrap" onMouseLeave={() => setOpen(false)}>
          <button className="vh-btn" title="Filtros e segmentações que afetam esta visual" onMouseEnter={() => setOpen(true)} onClick={() => setOpen(!open)}>
            ⚲<sup>{filters.length}</sup>
          </button>
          {open && (
            <div className="vh-pop">
              <b>Filtros aplicados</b>
              {filters.map((f, i) => (
                <div key={i} className="vh-filter">
                  <span className="muted small">{f.scope}</span>
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="vh-btn" title="Modo de foco" onClick={() => useStore.setState({ focusVisual: visual.id, selectedVisual: visual.id })}>⤢</button>
      <VisualMenu visual={visual} page={page} />
    </div>
  );
}

function VisualMenu({ visual, page }: { visual: Visual; page: Page }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  const s = useStore.getState();
  const fields = (Object.values(visual.fields).flat().filter(Boolean) as FieldItem[]).filter((f, i, a) => a.findIndex((x) => sameField(x, f)) === i);
  const decor = DECOR.has(visual.type);
  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  const sortBy = (f: FieldItem, desc: boolean) => s.updateVisual(visual.id, (v) => ({ ...v, sort: { field: f, desc } }));
  return (
    <div className="vh-wrap" ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      <button className="vh-btn" title="Mais opções" onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="vh-pop menu-pop">
          {!decor && <button onClick={act(() => void exportVisual(visual, page))}>⇩ Exportar dados (CSV)</button>}
          {CHARTS.has(visual.type) && (
            <button onClick={act(() => s.updateVisual(visual.id, (v) => ({ ...v, options: { ...v.options, as_table: !v.options?.as_table } })))}>
              ▦ {visual.options?.as_table ? "Mostrar como gráfico" : "Mostrar como tabela"}
            </button>
          )}
          {!decor && visual.type !== "card" && visual.type !== "slicer" && fields.length > 0 && (
            <>
              <div className="rmenu-sep">Classificar por</div>
              {fields.map((f, i) => {
                const cur = visual.sort && sameField(visual.sort.field, f) ? visual.sort : null;
                return (
                  <div key={i} className="sort-row">
                    <span className={cur ? "on" : ""}>{itemLabel(f)}</span>
                    <button className={cur?.desc ? "on" : ""} title="Decrescente" onClick={act(() => sortBy(f, true))}>↓</button>
                    <button className={cur && !cur.desc ? "on" : ""} title="Crescente" onClick={act(() => sortBy(f, false))}>↑</button>
                  </div>
                );
              })}
            </>
          )}
          <div className="rmenu-sep">Organizar</div>
          <button onClick={act(() => moveLayer(visual.id, "front"))}>⬆ Trazer para frente</button>
          <button onClick={act(() => moveLayer(visual.id, "back"))}>⬇ Enviar para trás</button>
          <button onClick={act(() => s.updateVisual(visual.id, (v) => ({ ...v, hidden: true })))}>◌ Ocultar ({visualName(visual)})</button>
          <div className="rmenu-sep" />
          <button onClick={act(() => duplicateVisual(visual))}>⧉ Duplicar</button>
          <button className="danger" onClick={act(() => removeVisual(visual.id))}>✕ Excluir</button>
        </div>
      )}
    </div>
  );
}

function FocusMode({ visual, page }: { visual: Visual; page: Page }) {
  const theme = useStore((s) => s.report.theme);
  return (
    <div className="focus-mode" style={{ background: page.background ?? theme?.page_background ?? "#fff" }}>
      <div className="focus-bar">
        <button onClick={() => useStore.setState({ focusVisual: null })}>← Voltar ao relatório</button>
        <b style={{ color: theme?.foreground ?? undefined }}>{visualName(visual)}</b>
        <span className="muted small">Esc também volta</span>
      </div>
      <div className="focus-body" style={{ background: theme?.visual_background ?? "#fff" }}>
        <VisualHost visual={visual} page={page} />
      </div>
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

function PageTabs() {
  const report = useStore((s) => s.report);
  const pageIndex = useStore((s) => s.pageIndex);
  const setPage = useStore((s) => s.setPage);
  const setReport = useStore((s) => s.setReport);
  const [editing, setEditing] = useState<number | null>(null);

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
      <button className="page-tab add" onClick={() => addPage()} title="Nova página">+</button>
    </div>
  );
}
