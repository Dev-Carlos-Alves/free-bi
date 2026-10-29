import { useMemo, useState } from "react";
import { formatCategory, formatValue } from "../format";
import { columnDtype, itemLabel, measureFormat, sameField } from "../queryBuilder";
import type { Plan } from "../queryBuilder";
import type { FieldItem, Model, QueryResult, Visual } from "../types";

export function CardVisual({ plan, result, model, fg }: { plan: Plan; result: QueryResult; model: Model; fg: string }) {
  const row = result.rows[0] ?? [];
  if (plan.vals.length > 1) {
    return (
      <div className="multicard">
        {plan.vals.map((f, i) => (
          <div key={i} className="multicard-item">
            <div className="card-value small" style={{ color: fg }}>{formatValue(row[i], { format: measureFormat(model, f), compact: true })}</div>
            <div className="card-label">{itemLabel(f)}</div>
          </div>
        ))}
      </div>
    );
  }
  const f = plan.vals[0];
  return (
    <div className="card">
      <div className="card-value" style={{ color: fg }}>{formatValue(row[0], { format: measureFormat(model, f), compact: true })}</div>
      <div className="card-label">{itemLabel(f)}</div>
    </div>
  );
}

export function GaugeVisual({ plan, result, model, color }: { plan: Plan; result: QueryResult; model: Model; color: string }) {
  const row = result.rows[0] ?? [];
  const value = Number(row[0] ?? 0);
  const max = plan.vals[1] ? Number(row[1] ?? 1) : value <= 1 && value >= 0 ? 1 : Math.pow(10, Math.ceil(Math.log10(Math.abs(value) || 1)));
  const frac = Math.max(0, Math.min(1, max ? value / max : 0));
  const a = Math.PI * (1 - frac);
  const fmt = measureFormat(model, plan.vals[0]);
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 120" width="100%" height="100%">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(127,127,127,.2)" strokeWidth="18" />
        <path d={`M 20 100 A 80 80 0 0 1 ${100 + 80 * Math.cos(a)} ${100 - 80 * Math.sin(a)}`} fill="none" stroke={color} strokeWidth="18" />
        <text x="100" y="95" textAnchor="middle" fontSize="22" fontWeight="600" fill="currentColor">{formatValue(value, { format: fmt, compact: true })}</text>
        <text x="20" y="116" textAnchor="middle" fontSize="9" fill="currentColor" opacity=".6">0</text>
        <text x="180" y="116" textAnchor="middle" fontSize="9" fill="currentColor" opacity=".6">{formatValue(max, { format: fmt, compact: true })}</text>
      </svg>
    </div>
  );
}

interface TableProps {
  visual: Visual;
  plan: Plan;
  result: QueryResult;
  model: Model;
  accent: string;
  onSort: (field: FieldItem) => void;
  onSelect: (value: unknown | null) => void;
  selected: unknown[] | null;
}

export function TableVisual({ visual, plan, result, model, accent, onSort, onSelect, selected }: TableProps) {
  // Exibe as colunas na ordem em que o usuário colocou os campos.
  const order = useMemo(() => {
    const all = [...(visual.fields.rows ?? []), ...(visual.fields.columns ?? [])];
    return all.map((f) => {
      const k = plan.keys.findIndex((x) => x === f);
      return k >= 0 ? { f, idx: k, isKey: true } : { f, idx: plan.keys.length + plan.vals.findIndex((x) => x === f), isKey: false };
    });
  }, [visual.fields, plan]);
  const sortField = visual.sort?.field;
  return (
    <div className="tablewrap">
      <table className="vtable">
        <thead>
          <tr>
            {order.map(({ f, isKey }, i) => (
              <th key={i} className={isKey ? "" : "num"} onClick={() => onSort(f)} style={{ borderBottomColor: accent }}>
                {itemLabel(f)}
                {sortField && sameField(sortField, f) ? (visual.sort!.desc ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => {
            const sel = selected && plan.keys.length ? selected.includes(row[0]) : false;
            return (
              <tr key={r} className={sel ? "sel" : ""} onClick={() => plan.keys.length && onSelect(row[0])}>
                {order.map(({ f, idx, isKey }, i) => (
                  <td key={i} className={isKey ? "" : "num"}>
                    {isKey
                      ? formatCategory(row[idx], f.date_part, f.date_part ? "integer" : columnDtype(model, f))
                      : formatValue(row[idx], { format: measureFormat(model, f) })}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {result.total && (
          <tfoot>
            <tr>
              {order.map(({ f, idx, isKey }, i) => (
                <td key={i} className={isKey ? "" : "num"}>
                  {i === 0 && isKey ? "Total" : isKey ? "" : formatValue(result.total![idx], { format: measureFormat(model, f) })}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {result.row_count > result.rows.length && (
        <div className="muted small pad">Mostrando {result.rows.length.toLocaleString("pt-BR")} de {result.row_count.toLocaleString("pt-BR")} linhas</div>
      )}
    </div>
  );
}

interface SlicerProps {
  visual: Visual;
  plan: Plan;
  result: QueryResult;
  model: Model;
  onChange: (selected: unknown[]) => void;
}

export function SlicerVisual({ visual, plan, result, model, onChange }: SlicerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const f = plan.keys[0];
  const dtype = f.date_part ? "integer" : columnDtype(model, f);
  const selected = (visual.options?.selected as unknown[] | undefined) ?? [];
  const values = result.rows.map((r) => r[0]);
  const shown = values.filter((v) => !search || formatCategory(v, f.date_part, dtype).toLowerCase().includes(search.toLowerCase()));
  const toggle = (v: unknown, multi: boolean) => {
    const has = selected.includes(v);
    if (multi) onChange(has ? selected.filter((x) => x !== v) : [...selected, v]);
    else onChange(has && selected.length === 1 ? [] : [v]);
  };
  const dropdown = (visual.options?.slicer_mode ?? "list") === "dropdown";
  const summary = selected.length === 0 ? "Tudo" : selected.length === 1 ? formatCategory(selected[0], f.date_part, dtype) : "Várias seleções";
  const list = (
    <div className="slicer-list">
      {values.length > 8 && <input className="slicer-search" placeholder="Pesquisar" value={search} onChange={(e) => setSearch(e.target.value)} />}
      <label className="slicer-item">
        <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} /> Selecionar tudo
      </label>
      {shown.map((v, i) => (
        <label key={i} className="slicer-item" onClick={(e) => { e.preventDefault(); toggle(v, e.ctrlKey || e.metaKey || !dropdown); }}>
          <input type="checkbox" readOnly checked={selected.includes(v)} /> {formatCategory(v, f.date_part, dtype)}
        </label>
      ))}
    </div>
  );
  if (!dropdown) return list;
  return (
    <div className="slicer-dd">
      <button className="slicer-btn" onClick={() => setOpen(!open)}>
        <span>{summary}</span>
        <span>▾</span>
      </button>
      {open && (
        <div className="slicer-pop" onMouseLeave={() => setOpen(false)}>
          {list}
        </div>
      )}
    </div>
  );
}

export function TextVisual({ visual, fg }: { visual: Visual; fg: string }) {
  const paras = visual.text ?? [];
  if (paras.length === 0) return <div className="muted pad">Caixa de texto vazia — edite no painel à direita.</div>;
  return (
    <div className="textbox" style={{ color: fg }}>
      {paras.map((p, i) => (
        <p key={i}>
          {p.map((r, j) => (
            <span key={j} style={{ fontWeight: r.bold ? 700 : 400, fontSize: r.size ? `${r.size * 1.333}px` : undefined, color: r.color ?? undefined }}>
              {r.value}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
