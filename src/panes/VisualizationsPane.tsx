import { useState } from "react";
import { itemLabel, sameField } from "../queryBuilder";
import { newId, useStore } from "../store";
import type { Agg, FieldItem, TextRun, Visual, VisualType, Well } from "../types";
import { addFieldToVisual, convertVisual, DRAG_MIME, VISUALS, wellsFor } from "./wells";

const AGGS: { agg: Agg; label: string }[] = [
  { agg: "sum", label: "Soma" },
  { agg: "avg", label: "Média" },
  { agg: "min", label: "Mínimo" },
  { agg: "max", label: "Máximo" },
  { agg: "count", label: "Contagem" },
  { agg: "distinct_count", label: "Contagem distinta" },
  { agg: "none", label: "Não resumir" },
];

export function VisualizationsPane() {
  const s = useStore();
  const page = s.report.pages[s.pageIndex];
  const v = page?.visuals.find((x) => x.id === s.selectedVisual) ?? null;
  const [tab, setTab] = useState<"fields" | "format">("fields");

  const pick = (type: VisualType) => {
    if (v) {
      s.updateVisual(v.id, (x) => convertVisual(x, type));
      return;
    }
    const n = page.visuals.length;
    const nv: Visual = {
      id: newId(),
      type,
      x: 24 + (n % 4) * 32,
      y: 24 + (n % 4) * 32,
      w: type === "card" ? 240 : type === "slicer" ? 220 : type === "text" ? 480 : 420,
      h: type === "card" ? 120 : type === "text" ? 72 : 280,
      title: null,
      fields: {},
      options: { labels: false, slicer_mode: "list" },
      text: type === "text" ? [[{ value: "Novo título", bold: true, size: 18 }]] : undefined,
    };
    s.updatePage((p) => ({ ...p, visuals: [...p.visuals, nv] }));
    s.select(nv.id);
  };

  return (
    <div className="pane viz-pane">
      <div className="pane-title">Visualizações</div>
      <div className="viz-grid">
        {VISUALS.map((x) => (
          <button key={x.type} className={`viz-btn ${v?.type === x.type ? "active" : ""}`} title={v ? `Trocar para ${x.label}` : `Nova ${x.label}`} onClick={() => pick(x.type)}>
            {x.icon}
          </button>
        ))}
      </div>
      {!v && <div className="muted pad small">Clique num ícone para criar uma visual, ou selecione uma visual na página para editá-la.</div>}
      {v && (
        <>
          <div className="tabs">
            <button className={tab === "fields" ? "active" : ""} onClick={() => setTab("fields")}>Campos</button>
            <button className={tab === "format" ? "active" : ""} onClick={() => setTab("format")}>Formatar</button>
          </div>
          <div className="pane-scroll">{tab === "fields" ? <Wells v={v} /> : <FormatPanel v={v} />}</div>
        </>
      )}
    </div>
  );
}

function Wells({ v }: { v: Visual }) {
  const s = useStore();
  const wells = wellsFor(v.type);
  const [over, setOver] = useState<Well | null>(null);
  if (wells.length === 0) return <div className="muted pad small">Esta visual não usa campos. Veja a aba Formatar.</div>;

  const setWell = (key: Well, list: FieldItem[]) => s.updateVisual(v.id, (x) => ({ ...x, fields: { ...x.fields, [key]: list } }));
  return (
    <div className="wells">
      {wells.map((w) => {
        const list = v.fields[w.key] ?? [];
        return (
          <div
            key={w.key}
            className={`well ${over === w.key ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(w.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              const raw = e.dataTransfer.getData(DRAG_MIME);
              if (!raw) return;
              e.preventDefault();
              const f = JSON.parse(raw) as FieldItem & { fromWell?: Well; fromIndex?: number };
              s.updateVisual(v.id, (x) => {
                let base = x;
                if (f.fromWell !== undefined && f.fromIndex !== undefined) {
                  const src = [...(x.fields[f.fromWell] ?? [])];
                  src.splice(f.fromIndex, 1);
                  base = { ...x, fields: { ...x.fields, [f.fromWell]: src } };
                }
                const clean: FieldItem = { kind: f.kind, table: f.table, name: f.name, agg: f.agg, date_part: f.date_part, label: f.label };
                return addFieldToVisual(s.model, base, clean, w.key);
              });
            }}
          >
            <div className="well-label">{w.label}</div>
            {list.length === 0 && <div className="well-empty">Adicione campos aqui</div>}
            {list.map((f, i) => (
              <WellItem
                key={i}
                f={f}
                grouping={!!w.grouping && !(v.type === "table" && f.kind === "column" && f.agg && f.agg !== "none")}
                tableWell={v.type === "table"}
                onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ ...f, fromWell: w.key, fromIndex: i }))}
                onChange={(nf) => setWell(w.key, list.map((x, j) => (j === i ? nf : x)))}
                onRemove={() => setWell(w.key, list.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        );
      })}
      <SortControl v={v} />
    </div>
  );
}

function WellItem({ f, grouping, tableWell, onChange, onRemove, onDragStart }: {
  f: FieldItem;
  grouping: boolean;
  tableWell: boolean;
  onChange: (f: FieldItem) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="well-item" draggable onDragStart={onDragStart}>
      <span className="fname" title={`${f.table}[${f.name}]`}>{itemLabel(f)}</span>
      <button className="mini" onClick={() => setMenu(!menu)} title="Opções">▾</button>
      <button className="mini" onClick={onRemove} title="Remover">✕</button>
      {menu && (
        <div className="menu" onMouseLeave={() => setMenu(false)}>
          <label className="menu-row">
            Renomear para esta visual
            <input defaultValue={f.label ?? ""} placeholder={f.name} onBlur={(e) => onChange({ ...f, label: e.target.value || null })} />
          </label>
          {f.kind === "column" && (!grouping || tableWell) &&
            AGGS.map((a) => (
              <button key={a.agg} className={`menu-item ${(f.agg ?? "none") === a.agg ? "active" : ""}`} onClick={() => { onChange({ ...f, agg: a.agg }); setMenu(false); }}>
                {a.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ v }: { v: Visual }) {
  const s = useStore();
  const all = Object.values(v.fields).flat().filter(Boolean) as FieldItem[];
  if (all.length === 0 || v.type === "card" || v.type === "slicer") return null;
  const idx = v.sort ? all.findIndex((f) => sameField(f, v.sort!.field)) : -1;
  return (
    <div className="well">
      <div className="well-label">Classificar por</div>
      <div className="row">
        <select
          value={idx}
          onChange={(e) => {
            const i = Number(e.target.value);
            s.updateVisual(v.id, (x) => ({ ...x, sort: i < 0 ? null : { field: all[i], desc: x.sort?.desc ?? true } }));
          }}
        >
          <option value={-1}>Automático</option>
          {all.map((f, i) => (
            <option key={i} value={i}>{itemLabel(f)}</option>
          ))}
        </select>
        {v.sort && (
          <button className="mini" onClick={() => s.updateVisual(v.id, (x) => ({ ...x, sort: { ...x.sort!, desc: !x.sort!.desc } }))}>
            {v.sort.desc ? "↓ Decrescente" : "↑ Crescente"}
          </button>
        )}
      </div>
    </div>
  );
}

function FormatPanel({ v }: { v: Visual }) {
  const s = useStore();
  const upd = (fn: (x: Visual) => Visual) => s.updateVisual(v.id, fn);
  return (
    <div className="format">
      {v.type !== "text" && (
        <label className="frow">
          Título
          <input value={v.title ?? ""} placeholder="(sem título)" onChange={(e) => upd((x) => ({ ...x, title: e.target.value || null }))} />
        </label>
      )}
      {!["text", "card", "table", "matrix", "slicer", "gauge", "shape"].includes(v.type) && (
        <label className="frow check">
          <input type="checkbox" checked={!!v.options?.labels} onChange={(e) => upd((x) => ({ ...x, options: { ...x.options, labels: e.target.checked } }))} />
          Rótulos de dados
        </label>
      )}
      {v.type === "slicer" && (
        <label className="frow">
          Estilo
          <select value={v.options?.slicer_mode ?? "list"} onChange={(e) => upd((x) => ({ ...x, options: { ...x.options, slicer_mode: e.target.value } }))}>
            <option value="list">Lista vertical</option>
            <option value="dropdown">Lista suspensa</option>
          </select>
        </label>
      )}
      {v.type === "text" && <TextEditor v={v} />}
      <div className="frow grid4">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k}>
            {{ x: "X", y: "Y", w: "Largura", h: "Altura" }[k]}
            <input type="number" value={Math.round(v[k])} onChange={(e) => upd((x) => ({ ...x, [k]: Number(e.target.value) }))} />
          </label>
        ))}
      </div>
    </div>
  );
}

function TextEditor({ v }: { v: Visual }) {
  const s = useStore();
  const text = (v.text ?? []).map((p) => p.map((r) => r.value).join("")).join("\n");
  const first = v.text?.[0]?.[0];
  const style = (i: number): TextRun => {
    const r = v.text?.[i]?.[0];
    return { value: "", bold: r?.bold ?? i === 0, size: r?.size ?? (i === 0 ? 18 : 11), color: r?.color ?? null };
  };
  return (
    <>
      <label className="frow">
        Texto (uma linha por parágrafo)
        <textarea
          rows={4}
          defaultValue={text}
          onBlur={(e) => {
            const lines = e.target.value.split("\n");
            s.updateVisual(v.id, (x) => ({ ...x, text: lines.map((l, i) => [{ ...style(i), value: l }]) }));
          }}
        />
      </label>
      <div className="frow grid2">
        <label>
          Tamanho do 1º parágrafo
          <input type="number" value={first?.size ?? 18} onChange={(e) => s.updateVisual(v.id, (x) => ({ ...x, text: (x.text ?? [[{ value: "" }]]).map((p, i) => (i === 0 ? p.map((r) => ({ ...r, size: Number(e.target.value) })) : p)) }))} />
        </label>
        <label>
          Cor
          <input type="color" value={first?.color ?? "#1f2937"} onChange={(e) => s.updateVisual(v.id, (x) => ({ ...x, text: (x.text ?? []).map((p, i) => (i === 0 ? p.map((r) => ({ ...r, color: e.target.value })) : p)) }))} />
        </label>
      </div>
    </>
  );
}
