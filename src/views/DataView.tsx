import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { openDialog } from "../components/dialogs";
import { formatValue } from "../format";
import { errorText, useStore } from "../store";
import type { Cmp, DType, QueryResult, Step } from "../types";

const PAGE = 200;
const TYPES: { t: DType; label: string }[] = [
  { t: "text", label: "Texto" },
  { t: "integer", label: "Número inteiro" },
  { t: "decimal", label: "Número decimal" },
  { t: "date", label: "Data" },
  { t: "datetime", label: "Data/hora" },
  { t: "boolean", label: "Verdadeiro/Falso" },
];

function describe(s: Step): string {
  switch (s.op) {
    case "remove_columns": return `Colunas removidas: ${s.columns.join(", ")}`;
    case "keep_columns": return `Mantidas: ${s.columns.join(", ")}`;
    case "rename_column": return `Renomeada ${s.from} → ${s.to}`;
    case "change_type": return `Tipo alterado: ${s.column} → ${TYPES.find((t) => t.t === s.dtype)?.label}`;
    case "filter_rows": return `Linhas filtradas: ${s.column} ${s.cmp} ${JSON.stringify(s.value)}`;
    case "replace_value": return `Substituído em ${s.column}: "${s.find}" → "${s.replace}"`;
    case "fill_null": return `Vazios preenchidos em ${s.column}`;
    case "remove_null_rows": return `Removidas linhas vazias em ${s.column}`;
    case "remove_duplicates": return `Duplicatas removidas${s.columns.length ? ` (${s.columns.join(", ")})` : ""}`;
    case "trim": return `Espaços aparados: ${s.column}`;
    case "uppercase": return `MAIÚSCULAS: ${s.column}`;
    case "lowercase": return `minúsculas: ${s.column}`;
    case "split_column": return `Dividida ${s.column} por "${s.delimiter}"`;
    case "sort": return `Classificada por ${s.column}${s.descending ? " (desc)" : ""}`;
    case "keep_top_rows": return `Mantidas as primeiras ${s.n} linhas`;
  }
}

export function DataView() {
  const model = useStore((s) => s.model);
  const version = useStore((s) => s.dataVersion);
  const notify = useStore((s) => s.notify);
  const reload = useStore((s) => s.reloadModel);
  const [table, setTable] = useState<string | null>(null);
  const [data, setData] = useState<QueryResult | null>(null);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const [selCol, setSelCol] = useState<string | null>(null);
  const [stats, setStats] = useState<{ count: number; nulls: number; distinct: number; min: number | null; max: number | null } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const t = model.tables.find((x) => x.name === table) ?? model.tables[0];
  useEffect(() => {
    if (!t) return;
    setData(null);
    api.tablePage(t.name, 0, PAGE, sort?.col, sort?.desc).then(setData).catch((e) => notify(errorText(e), "error"));
  }, [t?.name, version, sort?.col, sort?.desc]);
  useEffect(() => {
    if (!t || !selCol) return setStats(null);
    api.columnStats(t.name, selCol).then(setStats).catch(() => setStats(null));
  }, [t?.name, selCol, version]);

  if (!t) return <div className="empty-view"><h2>Sem dados</h2><p>Use <b>Obter dados</b> para carregar CSV, Excel, Parquet ou JSON, ou <b>Importar .pbix</b>.</p></div>;

  const loadMore = () => {
    if (!data || data.rows.length >= data.row_count) return;
    api.tablePage(t.name, data.rows.length, PAGE, sort?.col, sort?.desc).then((more) => setData({ ...data, rows: [...data.rows, ...more.rows] }));
  };
  const step = async (s: Step) => {
    try {
      await api.addStep(t.name, s);
      await reload();
    } catch (e) {
      notify(errorText(e), "error");
    }
  };
  const removeStep = async (i: number) => {
    await api.setSteps(t.name, t.steps.filter((_, j) => j !== i));
    await reload();
  };
  const col = selCol && t.columns.some((c) => c.name === selCol) ? selCol : null;
  const ask = (q: string, def = "") => window.prompt(q, def);
  const tools: { label: string; run: () => void; needCol?: boolean }[] = [
    { label: "Remover coluna", needCol: true, run: () => step({ op: "remove_columns", columns: [col!] }) },
    { label: "Renomear", needCol: true, run: () => { const to = ask("Novo nome da coluna", col!); if (to && to !== col) step({ op: "rename_column", from: col!, to }); } },
    { label: "Filtrar linhas", needCol: true, run: () => {
      const cmp = ask("Condição: = <> > >= < <= contém começa vazio nãovazio", "=");
      if (!cmp) return;
      const map: Record<string, Cmp> = { "=": "eq", "<>": "ne", ">": "gt", ">=": "ge", "<": "lt", "<=": "le", contém: "contains", contem: "contains", começa: "starts_with", vazio: "is_null", nãovazio: "not_null", naovazio: "not_null" };
      const c = map[cmp.trim()];
      if (!c) return notify("Condição inválida", "error");
      let value: unknown = null;
      if (c !== "is_null" && c !== "not_null") {
        const raw = ask("Valor");
        if (raw === null) return;
        const n = Number(raw.replace(",", "."));
        value = raw !== "" && !Number.isNaN(n) && t.columns.find((x) => x.name === col)?.dtype !== "text" ? n : raw;
      }
      step({ op: "filter_rows", column: col!, cmp: c, value });
    } },
    { label: "Substituir valores", needCol: true, run: () => { const f = ask("Localizar"); if (f === null) return; const r = ask("Substituir por", ""); if (r !== null) step({ op: "replace_value", column: col!, find: f, replace: r }); } },
    { label: "Preencher vazios", needCol: true, run: () => { const v = ask("Valor para células vazias", "0"); if (v === null) return; const n = Number(v.replace(",", ".")); step({ op: "fill_null", column: col!, value: v !== "" && !Number.isNaN(n) ? n : v }); } },
    { label: "Remover vazios", needCol: true, run: () => step({ op: "remove_null_rows", column: col! }) },
    { label: "Aparar", needCol: true, run: () => step({ op: "trim", column: col! }) },
    { label: "MAIÚSCULAS", needCol: true, run: () => step({ op: "uppercase", column: col! }) },
    { label: "minúsculas", needCol: true, run: () => step({ op: "lowercase", column: col! }) },
    { label: "Dividir coluna", needCol: true, run: () => { const d = ask("Delimitador", ","); if (d) step({ op: "split_column", column: col!, delimiter: d }); } },
    { label: "Remover duplicatas", run: () => step({ op: "remove_duplicates", columns: col ? [col] : [] }) },
    { label: "Manter primeiras linhas", run: () => { const n = Number(ask("Quantas linhas?", "1000")); if (n > 0) step({ op: "keep_top_rows", n }); } },
    { label: "ƒ Nova coluna", run: () => openDialog({ kind: "calc-column", table: t.name }) },
    { label: "ƒx Nova medida", run: () => openDialog({ kind: "measure", table: t.name }) },
  ];

  return (
    <div className="data-view">
      <div className="data-main">
        <div className="toolbar">
          {tools.map((x) => (
            <button key={x.label} disabled={x.needCol && !col} onClick={x.run} title={x.needCol && !col ? "Selecione uma coluna (clique no cabeçalho)" : ""}>
              {x.label}
            </button>
          ))}
          {col && (
            <select
              value={t.columns.find((c) => c.name === col)?.dtype}
              onChange={(e) => step({ op: "change_type", column: col, dtype: e.target.value as DType })}
              title="Tipo de dados"
            >
              {TYPES.map((x) => (
                <option key={x.t} value={x.t}>{x.label}</option>
              ))}
            </select>
          )}
          {col && (
            <label className="row small" title="Ordem usada nas visuais (ex.: nome do mês ordenado pelo número do mês)">
              Classificar por coluna
              <select
                value={t.sort_by?.[col] ?? ""}
                onChange={async (e) => {
                  await api.setSortBy(t.name, col, e.target.value || null);
                  await reload();
                }}
              >
                <option value="">(ela mesma)</option>
                {t.columns.filter((c) => c.name !== col).map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {t.errors.length > 0 && <div className="visual-error">{t.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}</div>}
        <div className="grid-scroll" ref={scroller} onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) loadMore();
        }}>
          {!data ? (
            <div className="muted pad">Carregando…</div>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th className="rownum">#</th>
                  {data.columns.map((c) => (
                    <th
                      key={c.name}
                      className={`${c.name === col ? "sel" : ""} ${c.dtype === "integer" || c.dtype === "decimal" ? "num" : ""}`}
                      onClick={() => setSelCol(c.name === col ? null : c.name)}
                      onDoubleClick={() => setSort(sort?.col === c.name ? { col: c.name, desc: !sort.desc } : { col: c.name, desc: false })}
                      title="Clique: selecionar · Duplo clique: ordenar"
                    >
                      <span className="dtype">{{ text: "Aa", integer: "123", decimal: "1.2", date: "📅", datetime: "🕑", boolean: "◐" }[c.dtype]}</span> {c.name}
                      {sort?.col === c.name ? (sort.desc ? " ▼" : " ▲") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="rownum">{i + 1}</td>
                    {r.map((v, j) => (
                      <td key={j} className={`${data.columns[j].name === col ? "sel" : ""} ${typeof v === "number" ? "num" : ""} ${v === null ? "null" : ""}`}>
                        {v === null ? "null" : typeof v === "number" ? (data.columns[j].dtype === "integer" ? String(v) : formatValue(v)) : formatValue(v, { dtype: data.columns[j].dtype })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="statusbar">
          Tabela: <b>{t.name}</b> · {t.rows.toLocaleString("pt-BR")} linhas · {t.columns.length} colunas
          {stats && col && (
            <span>
              {" "}· <b>{col}</b>: {stats.distinct.toLocaleString("pt-BR")} distintos, {stats.nulls.toLocaleString("pt-BR")} vazios
              {stats.min !== null && `, mín ${formatValue(stats.min)}, máx ${formatValue(stats.max)}`}
            </span>
          )}
        </div>
      </div>
      <div className="data-side">
        <div className="pane-title">Tabelas</div>
        {model.tables.map((x) => (
          <div key={x.name} className={`side-item ${x.name === t.name ? "active" : ""}`} onClick={() => { setTable(x.name); setSelCol(null); setSort(null); }}>
            ▦ {x.name} <span className="muted small">{x.rows.toLocaleString("pt-BR")}</span>
          </div>
        ))}
        <div className="pane-title">Etapas aplicadas</div>
        <div className="side-item muted">Fonte: {t.source.path?.split(/[\\/]/).pop() ?? (t.source.kind === "embedded" ? "dados embutidos (.pbix)" : t.source.kind)}{t.source.sheet ? ` › ${t.source.sheet}` : ""}</div>
        {t.steps.map((s, i) => (
          <div key={i} className="side-item step">
            <span>{describe(s)}</span>
            <button className="mini" title="Remover etapa" onClick={() => removeStep(i)}>✕</button>
          </div>
        ))}
        {t.calc_columns.length > 0 && <div className="pane-title">Colunas calculadas</div>}
        {t.calc_columns.map((c) => (
          <div key={c.name} className="side-item step" onClick={() => openDialog({ kind: "calc-column", table: t.name, column: c })}>
            <span>ƒ {c.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
