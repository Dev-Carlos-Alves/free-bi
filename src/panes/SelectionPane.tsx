// Painel Seleção (Exibição › Seleção): camadas da página, visibilidade e ordem.

import { itemLabel } from "../queryBuilder";
import { moveLayer, toggleHidden } from "../reportOps";
import { useStore } from "../store";
import type { Visual } from "../types";
import { VISUALS } from "./wells";

const EXTRA: Record<string, string> = { shape: "Forma", image: "Imagem", button: "Botão", unsupported: "Não suportada" };

export function visualName(v: Visual): string {
  if (v.title) return v.title;
  if (v.type === "text") {
    const first = v.text?.[0]?.map((r) => r.value).join("").trim();
    if (first) return first;
  }
  if (v.type === "button" && v.options?.label) return `Botão: ${v.options.label}`;
  const kind = VISUALS.find((x) => x.type === v.type)?.label ?? EXTRA[v.type] ?? v.type;
  // Sem título, o primeiro campo diferencia visuais do mesmo tipo (ex.: vários cartões).
  const first = v.fields.values?.[0] ?? v.fields.category?.[0] ?? v.fields.columns?.[0] ?? v.fields.rows?.[0];
  return first ? `${kind}: ${itemLabel(first)}` : kind;
}

export function SelectionPane() {
  const page = useStore((s) => s.report.pages[s.pageIndex] ?? s.report.pages[0]);
  const selected = useStore((s) => s.selectedVisual);
  const select = useStore((s) => s.select);
  // A última visual da lista é a que fica por cima: o painel mostra de cima para baixo.
  const layers = [...page.visuals].reverse();
  const allHidden = page.visuals.length > 0 && page.visuals.every((v) => v.hidden);
  const setAll = (hidden: boolean) => useStore.getState().updatePage((p) => ({ ...p, visuals: p.visuals.map((v) => ({ ...v, hidden })) }));
  return (
    <div className="pane selection-pane">
      <div className="pane-title">
        Seleção
        <button className="mini" title="Fechar" onClick={() => useStore.getState().setPrefs((p) => ({ ...p, panes: { ...p.panes, selection: false } }))}>✕</button>
      </div>
      <div className="row pad-x">
        <button className="mini" onClick={() => setAll(false)} disabled={!page.visuals.some((v) => v.hidden)}>Mostrar tudo</button>
        <button className="mini" onClick={() => setAll(true)} disabled={allHidden}>Ocultar tudo</button>
      </div>
      <div className="pane-scroll">
        {layers.length === 0 && <div className="muted small pad">Esta página não tem visuais.</div>}
        {layers.map((v, i) => (
          <div key={v.id} className={`layer ${selected === v.id ? "active" : ""} ${v.hidden ? "hidden" : ""}`} onClick={() => select(v.id)}>
            <span className="fname" title={visualName(v)}>{visualName(v)}</span>
            <button className="mini" title="Trazer para frente" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveLayer(v.id, "forward"); }}>▲</button>
            <button className="mini" title="Enviar para trás" disabled={i === layers.length - 1} onClick={(e) => { e.stopPropagation(); moveLayer(v.id, "backward"); }}>▼</button>
            <button className="mini" title={v.hidden ? "Mostrar" : "Ocultar"} onClick={(e) => { e.stopPropagation(); toggleHidden(v.id); }}>{v.hidden ? "◌" : "👁"}</button>
          </div>
        ))}
      </div>
      <div className="muted small pad">A visual no topo da lista fica na frente. Visuais ocultas continuam filtrando a página.</div>
    </div>
  );
}
