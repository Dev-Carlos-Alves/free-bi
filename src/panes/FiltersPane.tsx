import { useEffect, useState } from "react";
import { api } from "../api";
import { formatCategory } from "../format";
import { columnDtype, fieldRef, itemLabel } from "../queryBuilder";
import { useStore } from "../store";
import type { Cmp, FieldItem, ReportFilter } from "../types";
import { DRAG_MIME } from "./wells";

type Scope = "visual" | "page" | "report";

export function FiltersPane() {
  const s = useStore();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("freebi.filtersCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem("freebi.filtersCollapsed", collapsed ? "0" : "1");
    } catch {
      /* sem armazenamento local */
    }
  };
  const page = s.report.pages[s.pageIndex];
  const v = page?.visuals.find((x) => x.id === s.selectedVisual) ?? null;

  const get = (scope: Scope): ReportFilter[] =>
    scope === "visual" ? v?.filters ?? [] : scope === "page" ? page?.filters ?? [] : s.report.filters ?? [];
  const put = (scope: Scope, list: ReportFilter[]) => {
    if (scope === "visual" && v) s.updateVisual(v.id, (x) => ({ ...x, filters: list }));
    else if (scope === "page") s.updatePage((p) => ({ ...p, filters: list }));
    else s.setReport({ ...s.report, filters: list });
  };

  const section = (scope: Scope, title: string) => (
    <div
      className="fsection"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        const f = JSON.parse(raw) as FieldItem;
        if (f.kind === "measure") {
          s.notify("Filtros por medida ainda não são suportados; use uma coluna.", "error");
          return;
        }
        put(scope, [...get(scope), { field: { kind: "column", table: f.table, name: f.name, date_part: f.date_part } }]);
      }}
    >
      <div className="well-label">{title}</div>
      {get(scope).map((f, i) => (
        <FilterCard
          key={`${f.field.table}|${f.field.name}|${i}`}
          f={f}
          onChange={(nf) => put(scope, get(scope).map((x, j) => (j === i ? nf : x)))}
          onRemove={() => put(scope, get(scope).filter((_, j) => j !== i))}
        />
      ))}
      <div className="well-empty">Arraste campos aqui</div>
    </div>
  );

  const count = (v?.filters?.length ?? 0) + (page?.filters?.length ?? 0) + (s.report.filters?.length ?? 0);
  if (collapsed)
    return (
      <div className="pane filters-pane collapsed">
        <div className="pane-title" onClick={toggle} title="Mostrar filtros">⏴ Filtros{count ? ` (${count})` : ""}</div>
      </div>
    );
  return (
    <div className="pane filters-pane">
      <div className="pane-title">
        Filtros <button className="mini" onClick={toggle} title="Recolher">⏵</button>
      </div>
      <div className="pane-scroll">
        {v && section("visual", "Filtros nesta visual")}
        {section("page", "Filtros nesta página")}
        {section("report", "Filtros em todas as páginas")}
      </div>
    </div>
  );
}

const CMPS: { cmp: Cmp; label: string }[] = [
  { cmp: "eq", label: "é igual a" },
  { cmp: "ne", label: "não é igual a" },
  { cmp: "gt", label: "é maior que" },
  { cmp: "ge", label: "é maior ou igual a" },
  { cmp: "lt", label: "é menor que" },
  { cmp: "le", label: "é menor ou igual a" },
  { cmp: "contains", label: "contém" },
  { cmp: "not_contains", label: "não contém" },
  { cmp: "starts_with", label: "começa com" },
  { cmp: "is_null", label: "está em branco" },
  { cmp: "not_null", label: "não está em branco" },
];

function FilterCard({ f, onChange, onRemove }: { f: ReportFilter; onChange: (f: ReportFilter) => void; onRemove: () => void }) {
  const model = useStore((s) => s.model);
  const version = useStore((s) => s.dataVersion);
  const [open, setOpen] = useState(true);
  const [values, setValues] = useState<unknown[]>([]);
  const [search, setSearch] = useState("");
  const advanced = !!f.cmp;
  const dtype = f.field.date_part ? "integer" : columnDtype(model, f.field);

  useEffect(() => {
    api
      .query({ group_by: [fieldRef(f.field)], values: [], filters: [], limit: 2000 })
      .then((r) => setValues(r.rows.map((x) => x[0])))
      .catch(() => setValues([]));
  }, [f.field.table, f.field.name, f.field.date_part, version]);

  const sel = f.values ?? [];
  const summary = advanced ? `${CMPS.find((c) => c.cmp === f.cmp)?.label} ${f.value ?? ""}` : sel.length ? `${f.exclude ? "não é " : "é "}${sel.length} valor(es)` : "é (Tudo)";
  return (
    <div className="fcard">
      <div className="fcard-head" onClick={() => setOpen(!open)}>
        <b>{itemLabel(f.field)}</b>
        <span className="muted small">{summary}</span>
        <button className="mini" onClick={(e) => { e.stopPropagation(); onRemove(); }}>✕</button>
      </div>
      {open && (
        <div className="fcard-body">
          <select
            value={advanced ? "adv" : f.exclude ? "exclude" : "basic"}
            onChange={(e) => {
              const m = e.target.value;
              if (m === "adv") onChange({ field: f.field, cmp: "eq", value: "" });
              else onChange({ field: f.field, values: [], exclude: m === "exclude" });
            }}
          >
            <option value="basic">Filtragem básica</option>
            <option value="exclude">Excluir selecionados</option>
            <option value="adv">Filtragem avançada</option>
          </select>
          {advanced ? (
            <div className="col">
              <select value={f.cmp} onChange={(e) => onChange({ ...f, cmp: e.target.value as Cmp })}>
                {CMPS.map((c) => (
                  <option key={c.cmp} value={c.cmp}>{c.label}</option>
                ))}
              </select>
              {f.cmp !== "is_null" && f.cmp !== "not_null" && (
                <input
                  defaultValue={String(f.value ?? "")}
                  onBlur={(e) => {
                    const raw = e.target.value;
                    const num = Number(raw.replace(",", "."));
                    const numeric = dtype === "integer" || dtype === "decimal";
                    onChange({ ...f, value: numeric && raw !== "" && !Number.isNaN(num) ? num : raw });
                  }}
                  placeholder="valor"
                />
              )}
            </div>
          ) : (
            <div className="fvalues">
              {values.length > 8 && <input placeholder="Pesquisar" value={search} onChange={(e) => setSearch(e.target.value)} />}
              {values
                .filter((x) => !search || formatCategory(x, f.field.date_part, dtype).toLowerCase().includes(search.toLowerCase()))
                .slice(0, 300)
                .map((x, i) => (
                  <label key={i} className="slicer-item">
                    <input
                      type="checkbox"
                      checked={sel.includes(x)}
                      onChange={() => onChange({ ...f, values: sel.includes(x) ? sel.filter((y) => y !== x) : [...sel, x] })}
                    />
                    {formatCategory(x, f.field.date_part, dtype)}
                  </label>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
