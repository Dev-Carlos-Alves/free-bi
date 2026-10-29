import { useState } from "react";
import { useStore } from "../store";
import type { DatePart, FieldItem } from "../types";
import { addFieldToVisual, DRAG_MIME } from "./wells";
import { openDialog } from "../components/dialogs";

const icon: Record<string, string> = { integer: "Σ", decimal: "Σ", date: "📅", datetime: "📅", boolean: "◐", text: "Aa" };
const PARTS: { part: DatePart; label: string }[] = [
  { part: "year", label: "Ano" },
  { part: "quarter", label: "Trimestre" },
  { part: "month", label: "Mês" },
  { part: "day", label: "Dia" },
];

function usedFields(): Set<string> {
  const s = useStore.getState();
  const v = s.report.pages[s.pageIndex]?.visuals.find((x) => x.id === s.selectedVisual);
  const out = new Set<string>();
  if (!v) return out;
  for (const list of Object.values(v.fields)) for (const f of list ?? []) out.add(`${f.table}|${f.name}`);
  return out;
}

export function FieldsPane() {
  const model = useStore((s) => s.model);
  useStore((s) => s.report);
  useStore((s) => s.selectedVisual);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});
  const used = usedFields();

  const click = (f: FieldItem) => {
    const s = useStore.getState();
    const id = s.selectedVisual;
    if (!id) {
      s.notify("Selecione uma visual no relatório (ou arraste o campo para a página).");
      return;
    }
    s.updateVisual(id, (v) => addFieldToVisual(s.model, v, f));
  };

  const item = (f: FieldItem, label: string, ic: string, extra?: React.ReactNode, menu?: () => void) => (
    <div
      key={`${f.kind}|${f.name}|${f.date_part ?? ""}`}
      className={`field ${used.has(`${f.table}|${f.name}`) ? "used" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(f));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => click(f)}
      onContextMenu={(e) => {
        if (menu) {
          e.preventDefault();
          menu();
        }
      }}
      title={f.kind === "measure" ? "Medida — clique para adicionar à visual selecionada" : "Coluna — clique ou arraste"}
    >
      <span className={`ficon ${f.kind}`}>{ic}</span>
      <span className="fname">{label}</span>
      {extra}
    </div>
  );

  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="pane fields-pane">
      <div className="pane-title">Dados</div>
      <input className="search" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pane-scroll">
        {model.tables.length === 0 && <div className="muted pad">Nenhuma tabela. Use <b>Obter dados</b> ou <b>Importar .pbix</b>.</div>}
        {model.tables.map((t) => {
          const measures = model.measures.filter((m) => m.table === t.name && match(m.name));
          const cols = t.columns.filter((c) => match(c.name));
          if (q && !match(t.name) && measures.length === 0 && cols.length === 0) return null;
          const isOpen = open[t.name] ?? !!q;
          return (
            <div key={t.name} className="ftable">
              <div
                className="ftable-head"
                onClick={() => setOpen({ ...open, [t.name]: !isOpen })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openDialog({ kind: "table-menu", table: t.name });
                }}
                title="Botão direito: nova medida, nova coluna, renomear…"
              >
                <span className="caret">{isOpen ? "▾" : "▸"}</span>
                <span className="ticon">▦</span>
                <span className="fname">{t.name}</span>
                <button className="mini" title="Nova medida nesta tabela" onClick={(e) => { e.stopPropagation(); openDialog({ kind: "measure", table: t.name }); }}>
                  ƒx
                </button>
              </div>
              {isOpen && (
                <div className="ftable-body">
                  {measures.map((m) =>
                    item({ kind: "measure", table: t.name, name: m.name }, m.name, "▣", undefined, () => openDialog({ kind: "measure", table: t.name, measure: m })),
                  )}
                  {cols.map((c) => {
                    const f: FieldItem = { kind: "column", table: t.name, name: c.name };
                    const isDate = c.dtype === "date" || c.dtype === "datetime";
                    const dk = `${t.name}|${c.name}`;
                    return (
                      <div key={c.name}>
                        {item(
                          f,
                          c.name,
                          c.calculated ? "ƒ" : icon[c.dtype] ?? "Aa",
                          isDate ? (
                            <button className="mini" title="Hierarquia de datas" onClick={(e) => { e.stopPropagation(); setOpenDates({ ...openDates, [dk]: !openDates[dk] }); }}>
                              {openDates[dk] ? "−" : "+"}
                            </button>
                          ) : undefined,
                          () => {
                            const calc = t.calc_columns.find((x) => x.name === c.name);
                            if (calc) openDialog({ kind: "calc-column", table: t.name, column: calc });
                          },
                        )}
                        {isDate && openDates[dk] && (
                          <div className="date-parts">
                            {PARTS.map((p) => item({ ...f, date_part: p.part }, p.label, "·"))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
