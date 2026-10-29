import { useMemo, useState } from "react";
import { api } from "../api";
import { openDialog } from "../components/dialogs";
import { errorText, useStore } from "../store";

const CARD_W = 220;
const HEAD = 30;
const ROW = 20;
const MAX_ROWS = 12;

export function ModelView() {
  const model = useStore((s) => s.model);
  const report = useStore((s) => s.report);
  const setReport = useStore((s) => s.setReport);
  const reload = useStore((s) => s.reloadModel);
  const notify = useStore((s) => s.notify);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ table: string; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const saved = report.model_layout ?? {};
    const out: Record<string, { x: number; y: number }> = {};
    // Layout padrão: tabelas de fatos (lado "muitos") no centro, dimensões em volta.
    const facts = new Set(model.relationships.map((r) => r.from_table));
    const dims = model.tables.filter((t) => !facts.has(t.name));
    const fts = model.tables.filter((t) => facts.has(t.name));
    fts.forEach((t, i) => (out[t.name] = saved[t.name] ?? { x: 420, y: 60 + i * 340 }));
    dims.forEach((t, i) => {
      const left = i % 2 === 0;
      out[t.name] = saved[t.name] ?? { x: left ? 60 : 780, y: 40 + Math.floor(i / 2) * 230 };
    });
    if (drag) out[drag.table] = { x: drag.x, y: drag.y };
    return out;
  }, [model, report, drag]);

  const height = (t: string) => HEAD + Math.min(MAX_ROWS, model.tables.find((x) => x.name === t)?.columns.length ?? 0) * ROW + 8;
  const colY = (t: string, c: string) => {
    const idx = model.tables.find((x) => x.name === t)?.columns.findIndex((x) => x.name === c) ?? 0;
    return layout[t].y + HEAD + Math.min(idx, MAX_ROWS - 1) * ROW + ROW / 2;
  };

  const startDrag = (e: React.MouseEvent, table: string) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = layout[table];
    let last = start;
    const move = (ev: MouseEvent) => {
      last = { x: Math.max(0, start.x + ev.clientX - sx), y: Math.max(0, start.y + ev.clientY - sy) };
      setDrag({ table, ...last });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag(null);
      const r = useStore.getState().report;
      setReport({ ...r, model_layout: { ...(r.model_layout ?? {}), ...layoutSnapshot(), [table]: last } }, { history: false });
    };
    const layoutSnapshot = () => Object.fromEntries(Object.entries(layout).map(([k, v]) => [k, { ...v }]));
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const rel = model.relationships.find((r) => r.id === sel);
  const w = Math.max(1200, ...Object.values(layout).map((p) => p.x + CARD_W + 60));
  const h = Math.max(700, ...Object.entries(layout).map(([t, p]) => p.y + height(t) + 60));

  return (
    <div className="model-view">
      <div className="toolbar">
        <button onClick={() => openDialog({ kind: "relationship" })} disabled={model.tables.length < 2}>+ Nova relação</button>
        <button
          disabled={model.tables.length < 2}
          onClick={async () => {
            try {
              const found = await api.detectRelationships();
              await reload();
              notify(found.length ? `${found.length} relação(ões) criada(s) automaticamente.` : "Nenhuma relação nova encontrada (as colunas precisam ter o mesmo nome).");
            } catch (e) {
              notify(errorText(e), "error");
            }
          }}
        >
          Detectar relações
        </button>
        <span className="muted small">Arraste as tabelas para organizar. Clique numa linha para ver a relação.</span>
      </div>
      <div className="model-scroll" onMouseDown={(e) => e.target === e.currentTarget && setSel(null)}>
        <svg className="model-lines" width={w} height={h} onMouseDown={(e) => e.target === e.currentTarget && setSel(null)}>
          {model.relationships.map((r) => {
            const a = layout[r.from_table];
            const b = layout[r.to_table];
            if (!a || !b) return null;
            const ay = colY(r.from_table, r.from_column);
            const by = colY(r.to_table, r.to_column);
            const aRight = a.x + CARD_W < b.x;
            const bRight = b.x + CARD_W < a.x;
            const ax = aRight ? a.x + CARD_W : bRight ? a.x : a.x + CARD_W;
            const bx = aRight ? b.x : bRight ? b.x + CARD_W : b.x + CARD_W;
            const dx = aRight || bRight ? (bx - ax) / 2 : 60;
            const d = `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - (aRight || bRight ? dx : -60)} ${by}, ${bx} ${by}`;
            return (
              <g key={r.id} className={`rel ${sel === r.id ? "sel" : ""} ${r.active ? "" : "inactive"}`} onMouseDown={() => setSel(r.id)}>
                <path d={d} className="hit" />
                <path d={d} className="line" />
                <text x={ax + (aRight ? 6 : -14)} y={ay - 4} className="card">*</text>
                <text x={bx + (aRight ? -12 : 6)} y={by - 4} className="card">1</text>
              </g>
            );
          })}
        </svg>
        {model.tables.map((t) => {
          const p = layout[t.name];
          return (
            <div key={t.name} className="mcard" style={{ left: p.x, top: p.y, width: CARD_W }}>
              <div className="mcard-head" onMouseDown={(e) => startDrag(e, t.name)} onDoubleClick={() => openDialog({ kind: "table-menu", table: t.name })}>
                ▦ {t.name}
              </div>
              <div className="mcard-body" style={{ maxHeight: MAX_ROWS * ROW }}>
                {t.columns.map((c) => {
                  const key = model.relationships.some((r) => (r.from_table === t.name && r.from_column === c.name) || (r.to_table === t.name && r.to_column === c.name));
                  return (
                    <div key={c.name} className={`mcol ${key ? "key" : ""}`} style={{ height: ROW }}>
                      {key ? "🔑 " : ""}{c.name}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {rel && (
        <div className="rel-panel">
          <b>Relação</b>
          <div>{rel.from_table}[{rel.from_column}] <span className="muted">(muitos)</span></div>
          <div>→ {rel.to_table}[{rel.to_column}] <span className="muted">(um)</span></div>
          <div className="muted small">Direção do filtro: {rel.to_table} filtra {rel.from_table}</div>
          <label className="frow check">
            <input type="checkbox" checked={rel.active} onChange={async (e) => { await api.setRelationshipActive(rel.id, e.target.checked); await reload(); }} /> Ativa
          </label>
          <button className="danger" onClick={async () => { await api.deleteRelationship(rel.id); setSel(null); await reload(); }}>Excluir relação</button>
        </div>
      )}
    </div>
  );
}
