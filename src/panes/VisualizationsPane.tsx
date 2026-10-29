import { useState } from "react";
import { itemLabel, sameField } from "../queryBuilder";
import { newId, useStore } from "../store";
import type { Agg, ButtonAction, FieldItem, ShapeKind, TextRun, Visual, VisualStyle, VisualType, Well } from "../types";
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

const DECOR: VisualType[] = ["text", "shape", "image", "button"];

function FormatPanel({ v }: { v: Visual }) {
  const s = useStore();
  const upd = (fn: (x: Visual) => Visual) => s.updateVisual(v.id, fn);
  const st = v.style ?? {};
  const setStyle = (patch: VisualStyle) => upd((x) => ({ ...x, style: { ...x.style, ...patch } }));
  const opt = (patch: NonNullable<Visual["options"]>) => upd((x) => ({ ...x, options: { ...x.options, ...patch } }));
  const decor = DECOR.includes(v.type);
  return (
    <div className="format">
      {!decor && (
        <>
          <label className="frow">
            Título
            <input value={v.title ?? ""} placeholder="(sem título)" onChange={(e) => upd((x) => ({ ...x, title: e.target.value || null }))} />
          </label>
          {v.title && (
            <div className="frow grid2">
              <label>
                Cor do título
                <input type="color" value={st.title_color ?? s.report.theme?.foreground ?? "#1f2937"} onChange={(e) => setStyle({ title_color: e.target.value })} />
              </label>
              <label>
                Tamanho
                <input type="number" min={8} max={48} value={st.title_size ?? 14} onChange={(e) => setStyle({ title_size: Number(e.target.value) })} />
              </label>
              <label>
                Alinhamento
                <select value={st.title_align ?? "left"} onChange={(e) => setStyle({ title_align: e.target.value as VisualStyle["title_align"] })}>
                  <option value="left">Esquerda</option>
                  <option value="center">Centro</option>
                  <option value="right">Direita</option>
                </select>
              </label>
            </div>
          )}
        </>
      )}
      {v.type === "shape" && (
        <>
          <label className="frow">
            Forma
            <select value={v.options?.shape ?? "rect"} onChange={(e) => opt({ shape: e.target.value as ShapeKind })}>
              <option value="rect">Retângulo</option>
              <option value="rounded">Retângulo arredondado</option>
              <option value="ellipse">Elipse</option>
              <option value="line">Linha</option>
              <option value="arrow">Seta</option>
            </select>
          </label>
          <div className="frow grid2">
            {!["line", "arrow"].includes(v.options?.shape ?? "rect") && (
              <label>
                Preenchimento
                <input type="color" value={v.options?.fill ?? "#14b8a6"} onChange={(e) => opt({ fill: e.target.value })} />
              </label>
            )}
            <label>
              Cor da linha
              <input type="color" value={v.options?.line_color ?? "#0f766e"} onChange={(e) => opt({ line_color: e.target.value })} />
            </label>
            <label>
              Espessura
              <input type="number" min={0} max={30} value={v.options?.line_width ?? 0} onChange={(e) => opt({ line_width: Number(e.target.value) })} />
            </label>
          </div>
        </>
      )}
      {v.type === "image" && (
        <>
          <label className="frow">
            Ajuste
            <select value={v.options?.fit ?? "contain"} onChange={(e) => opt({ fit: e.target.value as "contain" | "cover" | "fill" })}>
              <option value="contain">Ajustar (sem cortar)</option>
              <option value="cover">Preencher (corta as bordas)</option>
              <option value="fill">Esticar</option>
            </select>
          </label>
          <label className="frow">
            Texto alternativo
            <input value={v.title ?? ""} placeholder="Descrição da imagem" onChange={(e) => upd((x) => ({ ...x, title: e.target.value || null }))} />
          </label>
        </>
      )}
      {v.type === "button" && <ButtonFormat v={v} opt={opt} />}
      <details className="fsect" open={decor}>
        <summary>Plano de fundo e borda</summary>
        <div className="frow grid2">
          <label>
            Plano de fundo
            <input type="color" value={st.background ?? (decor ? "#ffffff" : s.report.theme?.visual_background ?? "#ffffff")} onChange={(e) => setStyle({ background: e.target.value })} />
          </label>
          <label>
            Transparência (%)
            <input type="number" min={0} max={100} value={st.transparency ?? 0} onChange={(e) => setStyle({ transparency: Number(e.target.value) })} />
          </label>
          <label>
            Cor da borda
            <input type="color" value={st.border_color ?? "#9ca3af"} onChange={(e) => setStyle({ border_color: e.target.value, border_width: st.border_width || 1 })} />
          </label>
          <label>
            Espessura da borda
            <input type="number" min={0} max={20} value={st.border_width ?? 0} onChange={(e) => setStyle({ border_width: Number(e.target.value) })} />
          </label>
          <label>
            Cantos arredondados
            <input type="number" min={0} max={60} value={st.radius ?? 4} onChange={(e) => setStyle({ radius: Number(e.target.value) })} />
          </label>
          <label className="check-inline">
            <span>Sombra</span>
            <input type="checkbox" checked={!!st.shadow} onChange={(e) => setStyle({ shadow: e.target.checked })} />
          </label>
        </div>
        {(st.background || st.border_width || st.shadow !== undefined || st.radius !== undefined) && (
          <button className="mini" onClick={() => upd((x) => ({ ...x, style: { title_color: x.style?.title_color, title_size: x.style?.title_size, title_align: x.style?.title_align } }))}>
            ↺ Restaurar padrão
          </button>
        )}
      </details>
      {!["text", "card", "table", "matrix", "slicer", "gauge", "shape", "image", "button"].includes(v.type) && (
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

function ButtonFormat({ v, opt }: { v: Visual; opt: (patch: NonNullable<Visual["options"]>) => void }) {
  const pages = useStore((s) => s.report.pages);
  const action = v.options?.action ?? { kind: "none" };
  const value = action.kind === "page" ? `page:${action.page_id}` : action.kind;
  return (
    <>
      <label className="frow">
        Texto do botão
        <input value={v.options?.label ?? ""} onChange={(e) => opt({ label: e.target.value })} />
      </label>
      <label className="frow">
        Ação (Ctrl+clique durante a edição)
        <select
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            const next: ButtonAction = val === "back" ? { kind: "back" } : val.startsWith("page:") ? { kind: "page", page_id: val.slice(5) } : { kind: "none" };
            opt({ action: next });
          }}
        >
          <option value="none">Nenhuma</option>
          <option value="back">Voltar (página anterior)</option>
          {pages.map((p) => (
            <option key={p.id} value={`page:${p.id}`}>Ir para: {p.name}</option>
          ))}
        </select>
      </label>
      <div className="frow grid2">
        <label>
          Cor do botão
          <input type="color" value={v.options?.fill ?? "#0f766e"} onChange={(e) => opt({ fill: e.target.value })} />
        </label>
        <label>
          Cor do texto
          <input type="color" value={(v.options?.text_color as string) ?? "#ffffff"} onChange={(e) => opt({ text_color: e.target.value })} />
        </label>
      </div>
    </>
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
