import { useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "../api";
import { formatValue } from "../format";
import { errorText, useStore } from "../store";
import type { CalcColumn, ImportSummary, Measure } from "../types";

export type DialogSpec =
  | { kind: "measure"; table: string; measure?: Measure }
  | { kind: "calc-column"; table: string; column?: CalcColumn }
  | { kind: "table-menu"; table: string }
  | { kind: "sheets"; path: string; sheets: string[]; onDone: (sel: string[]) => void }
  | { kind: "relationship" }
  | { kind: "import-summary"; summary: ImportSummary; file: string }
  | { kind: "rename-table"; table: string }
  | { kind: "about" };

const useDialogs = create<{ stack: DialogSpec[] }>(() => ({ stack: [] }));

export function openDialog(d: DialogSpec) {
  useDialogs.setState((s) => ({ stack: [...s.stack, d] }));
}

function close() {
  useDialogs.setState((s) => ({ stack: s.stack.slice(0, -1) }));
}

export function Dialogs() {
  const stack = useDialogs((s) => s.stack);
  const d = stack[stack.length - 1];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!d) return null;
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        {d.kind === "measure" && <MeasureDialog d={d} />}
        {d.kind === "calc-column" && <CalcColumnDialog d={d} />}
        {d.kind === "table-menu" && <TableMenu table={d.table} />}
        {d.kind === "sheets" && <SheetsDialog d={d} />}
        {d.kind === "relationship" && <RelationshipDialog />}
        {d.kind === "import-summary" && <ImportSummaryDialog d={d} />}
        {d.kind === "rename-table" && <RenameTable table={d.table} />}
        {d.kind === "about" && <About />}
      </div>
    </div>
  );
}

const FUNCS =
  "SUM, AVERAGE, MIN, MAX, MEDIAN, COUNT, COUNTA, COUNTROWS, DISTINCTCOUNT, COUNTBLANK, SUMX, AVERAGEX, MINX, MAXX, MEDIANX, COUNTX, " +
  "CALCULATE, FILTER, ALL, REMOVEFILTERS, KEEPFILTERS, DIVIDE, IF, SWITCH, AND, OR, NOT, ISBLANK, BLANK, COALESCE, SELECTEDVALUE, HASONEVALUE, " +
  "YEAR, MONTH, DAY, QUARTER, WEEKDAY, UPPER, LOWER, TRIM, LEN, LEFT, RIGHT, MID, CONTAINSSTRING, CONCATENATE, VALUE, ABS, ROUND, INT, SQRT, POWER, MOD, RELATED, VAR/RETURN, IN { }";

function MeasureDialog({ d }: { d: Extract<DialogSpec, { kind: "measure" }> }) {
  const s = useStore();
  const [name, setName] = useState(d.measure?.name ?? "Nova medida");
  const [table, setTable] = useState(d.measure?.table ?? d.table);
  const [expr, setExpr] = useState(d.measure?.expression ?? "");
  const [format, setFormat] = useState(d.measure?.format ?? "");
  const [preview, setPreview] = useState<{ ok?: string; error?: string }>({});

  useEffect(() => {
    if (!expr.trim()) return setPreview({});
    const t = setTimeout(() => {
      api
        .evalMeasure(table, expr)
        .then((v) => setPreview({ ok: formatValue(v, { format: format || null }) }))
        .catch((e) => setPreview({ error: errorText(e) }));
    }, 350);
    return () => clearTimeout(t);
  }, [expr, table, format]);

  const save = async () => {
    try {
      await api.setMeasure({ name: name.trim(), table, expression: expr, format: format || null, folder: d.measure?.folder ?? null }, d.measure?.name);
      // Se renomeou, atualiza as visuais que usam a medida.
      if (d.measure && d.measure.name !== name.trim()) {
        const r = s.report;
        s.setReport({
          ...r,
          pages: r.pages.map((p) => ({
            ...p,
            visuals: p.visuals.map((v) => ({
              ...v,
              fields: Object.fromEntries(Object.entries(v.fields).map(([k, list]) => [k, list?.map((f) => (f.kind === "measure" && f.name === d.measure!.name ? { ...f, name: name.trim() } : f))])),
            })),
          })),
        });
      }
      await s.reloadModel();
      close();
    } catch (e) {
      setPreview({ error: errorText(e) });
    }
  };
  const del = async () => {
    if (!d.measure || !confirm(`Excluir a medida [${d.measure.name}]?`)) return;
    await api.deleteMeasure(d.measure.name);
    await s.reloadModel();
    close();
  };
  return (
    <>
      <h3>{d.measure ? "Editar medida" : "Nova medida"}</h3>
      <div className="grid2">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Tabela inicial
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            {s.model.tables.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Expressão DAX
        <textarea
          className="code"
          rows={7}
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder={`Ex.: SUM(${table}[Valor])  ou  DIVIDE([Lucro], [Receita])`}
          spellCheck={false}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && save()}
        />
      </label>
      <label>
        Formato (opcional)
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">Automático</option>
          <option value="#,0">Número inteiro (1.234)</option>
          <option value="#,0.00">Decimal (1.234,56)</option>
          <option value="0.0%">Porcentagem (12,3%)</option>
          <option value="0.00%">Porcentagem (12,34%)</option>
          <option value={'"R$ "#,0.00'}>Moeda R$</option>
          <option value={'"US$ "#,0.00'}>Moeda US$</option>
          {format && !["#,0", "#,0.00", "0.0%", "0.00%", '"R$ "#,0.00', '"US$ "#,0.00'].includes(format) && <option value={format}>{format}</option>}
        </select>
      </label>
      <div className={`preview ${preview.error ? "err" : ""}`}>
        {preview.error ? `⚠ ${preview.error}` : preview.ok !== undefined ? `Valor total: ${preview.ok}` : "Digite a expressão para ver o resultado."}
      </div>
      <details className="muted small">
        <summary>Funções suportadas</summary>
        {FUNCS}
        <p>Limitação: ALL/REMOVEFILTERS ignoram o agrupamento da visual, mas mantêm os filtros de página e segmentação (como ALLSELECTED).</p>
      </details>
      <div className="actions">
        {d.measure && <button className="danger" onClick={del}>Excluir</button>}
        <span className="grow" />
        <button onClick={close}>Cancelar</button>
        <button className="primary" onClick={save} disabled={!name.trim() || !expr.trim()}>Salvar</button>
      </div>
    </>
  );
}

function CalcColumnDialog({ d }: { d: Extract<DialogSpec, { kind: "calc-column" }> }) {
  const s = useStore();
  const [name, setName] = useState(d.column?.name ?? "Nova coluna");
  const [expr, setExpr] = useState(d.column?.expression ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      if (d.column && d.column.name !== name) await api.removeCalcColumn(d.table, d.column.name);
      await api.addCalcColumn(d.table, name.trim(), expr);
      await s.reloadModel();
      close();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <>
      <h3>{d.column ? "Editar coluna calculada" : "Nova coluna calculada"} — {d.table}</h3>
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label>
        Expressão DAX (calculada linha a linha)
        <textarea className="code" rows={5} value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false}
          placeholder={`Ex.: ${d.table}[Quantidade] * ${d.table}[Preço]   ou   IF([Valor] > 100, "Alto", "Baixo")`} />
      </label>
      {err && <div className="preview err">⚠ {err}</div>}
      <div className="actions">
        {d.column && (
          <button className="danger" onClick={async () => { await api.removeCalcColumn(d.table, d.column!.name); await s.reloadModel(); close(); }}>
            Excluir
          </button>
        )}
        <span className="grow" />
        <button onClick={close}>Cancelar</button>
        <button className="primary" onClick={save}>Salvar</button>
      </div>
    </>
  );
}

function TableMenu({ table }: { table: string }) {
  const s = useStore();
  const t = s.model.tables.find((x) => x.name === table);
  const go = (d: DialogSpec) => {
    close();
    openDialog(d);
  };
  return (
    <>
      <h3>{table}</h3>
      <p className="muted small">{t?.rows.toLocaleString("pt-BR")} linhas · {t?.columns.length} colunas · origem: {t?.source.path ?? (t?.source.kind === "embedded" ? "dados embutidos" : t?.source.kind)}</p>
      <div className="menu-list">
        <button onClick={() => go({ kind: "measure", table })}>ƒx Nova medida</button>
        <button onClick={() => go({ kind: "calc-column", table })}>ƒ Nova coluna calculada</button>
        <button onClick={() => go({ kind: "rename-table", table })}>✎ Renomear tabela</button>
        <button onClick={() => { close(); s.setView("data"); }}>▦ Ver dados</button>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Excluir a tabela ${table}? As visuais que a usam vão mostrar erro.`)) return;
            await api.deleteTable(table);
            await s.reloadModel();
            close();
          }}
        >
          🗑 Excluir tabela
        </button>
      </div>
      {t?.origin_query && (
        <details>
          <summary className="small">Consulta Power Query original (M)</summary>
          <pre className="code small">{t.origin_query}</pre>
        </details>
      )}
      {t && t.imported_calc_columns.length > 0 && (
        <details>
          <summary className="small">Colunas calculadas vindas do Power BI ({t.imported_calc_columns.length})</summary>
          {t.imported_calc_columns.map((c) => (
            <pre key={c.name} className="code small">{c.name} = {c.expression}</pre>
          ))}
        </details>
      )}
      <div className="actions">
        <span className="grow" />
        <button onClick={close}>Fechar</button>
      </div>
    </>
  );
}

function RenameTable({ table }: { table: string }) {
  const s = useStore();
  const [name, setName] = useState(table);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.renameTable(table, name.trim());
      const r = s.report;
      s.setReport({
        ...r,
        pages: r.pages.map((p) => ({
          ...p,
          visuals: p.visuals.map((v) => ({
            ...v,
            fields: Object.fromEntries(Object.entries(v.fields).map(([k, l]) => [k, l?.map((f) => (f.table === table ? { ...f, table: name.trim() } : f))])),
          })),
        })),
      });
      await s.reloadModel();
      close();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <>
      <h3>Renomear tabela</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && save()} />
      {err && <div className="preview err">⚠ {err}</div>}
      <div className="actions">
        <span className="grow" />
        <button onClick={close}>Cancelar</button>
        <button className="primary" onClick={save}>Renomear</button>
      </div>
    </>
  );
}

function SheetsDialog({ d }: { d: Extract<DialogSpec, { kind: "sheets" }> }) {
  const [sel, setSel] = useState<string[]>(d.sheets);
  return (
    <>
      <h3>Navegador — escolha as planilhas</h3>
      <p className="muted small">{d.path}</p>
      <div className="menu-list">
        {d.sheets.map((sh) => (
          <label key={sh} className="slicer-item">
            <input type="checkbox" checked={sel.includes(sh)} onChange={() => setSel(sel.includes(sh) ? sel.filter((x) => x !== sh) : [...sel, sh])} />
            ▦ {sh}
          </label>
        ))}
      </div>
      <div className="actions">
        <span className="grow" />
        <button onClick={close}>Cancelar</button>
        <button className="primary" disabled={sel.length === 0} onClick={() => { close(); d.onDone(sel); }}>Carregar</button>
      </div>
    </>
  );
}

function RelationshipDialog() {
  const s = useStore();
  const tables = s.model.tables;
  const [ft, setFt] = useState(tables[0]?.name ?? "");
  const [fc, setFc] = useState("");
  const [tt, setTt] = useState(tables[1]?.name ?? "");
  const [tc, setTc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const colsOf = (t: string) => tables.find((x) => x.name === t)?.columns ?? [];
  useEffect(() => setFc(colsOf(ft)[0]?.name ?? ""), [ft]);
  useEffect(() => {
    const same = colsOf(tt).find((c) => c.name.toLowerCase() === fc.toLowerCase());
    setTc(same?.name ?? colsOf(tt)[0]?.name ?? "");
  }, [tt, fc]);
  const save = async () => {
    try {
      await api.addRelationship({ from_table: ft, from_column: fc, to_table: tt, to_column: tc, active: true });
      await s.reloadModel();
      close();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const sel = (v: string, set: (x: string) => void, opts: string[]) => (
    <select value={v} onChange={(e) => set(e.target.value)}>
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
  return (
    <>
      <h3>Nova relação</h3>
      <p className="muted small">Ligue a coluna da tabela de fatos (muitos) à chave da tabela de dimensão (um). Se estiver invertido, o Free BI corrige sozinho.</p>
      <div className="grid2">
        <label>Tabela (lado muitos){sel(ft, setFt, tables.map((t) => t.name))}</label>
        <label>Coluna{sel(fc, setFc, colsOf(ft).map((c) => c.name))}</label>
        <label>Tabela (lado um){sel(tt, setTt, tables.map((t) => t.name))}</label>
        <label>Coluna{sel(tc, setTc, colsOf(tt).map((c) => c.name))}</label>
      </div>
      {err && <div className="preview err">⚠ {err}</div>}
      <div className="actions">
        <span className="grow" />
        <button onClick={close}>Cancelar</button>
        <button className="primary" onClick={save} disabled={!ft || !tt || ft === tt}>Criar</button>
      </div>
    </>
  );
}

function ImportSummaryDialog({ d }: { d: Extract<DialogSpec, { kind: "import-summary" }> }) {
  const x = d.summary;
  return (
    <>
      <h3>Importação concluída</h3>
      <p className="muted small">{d.file}</p>
      <ul className="summary">
        <li><b>{x.tables}</b> tabelas · <b>{x.rows.toLocaleString("pt-BR")}</b> linhas</li>
        <li><b>{x.measures}</b> medidas DAX · <b>{x.relationships}</b> relações</li>
        <li><b>{x.pages}</b> páginas · <b>{x.visuals}</b> visuais</li>
      </ul>
      {x.warnings.length > 0 ? (
        <>
          <p><b>Avisos ({x.warnings.length})</b></p>
          <ul className="warnings">{x.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </>
      ) : (
        <p>✔ Tudo foi importado sem avisos.</p>
      )}
      <p className="muted small">Dica: salve como <b>.freebi</b> para abrir mais rápido nas próximas vezes (Linux ou Windows).</p>
      <div className="actions">
        <span className="grow" />
        <button className="primary" onClick={close}>OK</button>
      </div>
    </>
  );
}

function About() {
  return (
    <>
      <h3>Free BI 0.1</h3>
      <p>Ferramenta de BI livre e multiplataforma, com motor em Rust (Polars).</p>
      <p className="muted small">Lê arquivos .pbix (modelo importado + layout) usando o descompressor XPress9 publicado pela Microsoft sob licença MIT e a especificação [MS-XLDM]. Não é afiliado à Microsoft.</p>
      <div className="actions">
        <span className="grow" />
        <button className="primary" onClick={close}>Fechar</button>
      </div>
    </>
  );
}
