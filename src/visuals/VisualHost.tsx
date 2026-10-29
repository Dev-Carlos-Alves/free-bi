import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { planFor, sameField } from "../queryBuilder";
import { useStore } from "../store";
import type { FieldItem, Page, QueryResult, Visual } from "../types";
import { ButtonVisual, ImageVisual, ShapeVisual } from "./Elements";
import { CardVisual, GaugeVisual, SlicerVisual, TableVisual, TextVisual } from "./Basic";
import { ChartVisual, DEFAULT_COLORS } from "./ChartVisual";

const cache = new Map<string, Promise<QueryResult>>();
let cacheVersion = -1;

function runQuery(key: string, version: number, fn: () => Promise<QueryResult>) {
  if (version !== cacheVersion) {
    cache.clear();
    cacheVersion = version;
  }
  let p = cache.get(key);
  if (!p) {
    p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return p;
}

export function VisualHost({ visual, page }: { visual: Visual; page: Page }) {
  const model = useStore((s) => s.model);
  const report = useStore((s) => s.report);
  const cross = useStore((s) => s.crossFilter);
  const version = useStore((s) => s.dataVersion);
  const setCross = useStore((s) => s.setCrossFilter);
  const updateVisual = useStore((s) => s.updateVisual);
  const [state, setState] = useState<{ result?: QueryResult; error?: string; loading: boolean }>({ loading: true });

  const plan = useMemo(() => planFor(model, report, page, visual, cross), [model, report, page, visual, cross]);
  const key = plan ? JSON.stringify(plan.query) : "";

  useEffect(() => {
    if (!plan) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    runQuery(key, version, () => api.query(plan.query))
      .then((result) => alive && setState({ result, loading: false }))
      .catch((e) => alive && setState({ error: String(e?.message ?? e), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const theme = report.theme ?? {};
  const colors = theme.colors?.length ? theme.colors : DEFAULT_COLORS;
  const fg = theme.foreground ?? "#1F2937";

  if (visual.type === "text") return <TextVisual visual={visual} fg={fg} />;
  if (visual.type === "shape") return <ShapeVisual visual={visual} />;
  if (visual.type === "image") return <ImageVisual visual={visual} />;
  if (visual.type === "button") return <ButtonVisual visual={visual} />;
  if (visual.type === "unsupported")
    return <div className="muted pad center">Visual “{visual.source_type}” ainda não é suportado pelo Free BI.</div>;
  if (!plan) return <Placeholder visual={visual} />;
  if (state.error) return <div className="visual-error">⚠ {state.error}</div>;
  if (!state.result) return <div className="muted pad center">Carregando…</div>;

  const result = state.result;
  const mine = cross?.visualId === visual.id ? cross.values : null;
  const onSelect = (value: unknown | null) => {
    const field = plan.keys[0];
    if (value === null || !field || (mine && mine.length === 1 && mine[0] === value)) setCross(null);
    else setCross({ visualId: visual.id, field, values: [value] });
  };
  const onSort = (field: FieldItem) => {
    const desc = visual.sort && sameField(visual.sort.field, field) ? !visual.sort.desc : field.kind === "measure" || !!field.agg;
    updateVisual(visual.id, (v) => ({ ...v, sort: { field, desc } }));
  };

  switch (visual.type) {
    case "card":
      return <CardVisual plan={plan} result={result} model={model} fg={fg} />;
    case "gauge":
      return <GaugeVisual plan={plan} result={result} model={model} color={colors[0]} />;
    case "table":
    case "matrix":
      return <TableVisual visual={visual} plan={plan} result={result} model={model} accent={theme.table_accent ?? colors[0]} onSort={onSort} onSelect={onSelect} selected={mine} />;
    case "slicer":
      return (
        <SlicerVisual
          visual={visual}
          plan={plan}
          result={result}
          model={model}
          onChange={(selected) => useStore.getState().setReport(
            {
              ...useStore.getState().report,
              pages: useStore.getState().report.pages.map((p) =>
                p.id !== page.id ? p : { ...p, visuals: p.visuals.map((x) => (x.id === visual.id ? { ...x, options: { ...x.options, selected } } : x)) },
              ),
            },
            { history: false },
          )}
        />
      );
    default:
      if (result.rows.length === 0) return <div className="muted pad center">Sem dados para exibir</div>;
      if (visual.options?.as_table) {
        // "Mostrar como tabela": os mesmos dados do gráfico, em grade.
        const asTable: Visual = { ...visual, fields: { columns: [...plan.keys, ...plan.vals] } };
        return <TableVisual visual={asTable} plan={plan} result={result} model={model} accent={theme.table_accent ?? colors[0]} onSort={onSort} onSelect={onSelect} selected={mine} />;
      }
      return <ChartVisual visual={visual} plan={plan} result={result} model={model} colors={colors} foreground={fg} selected={mine} onSelect={onSelect} />;
  }
}

function Placeholder({ visual }: { visual: Visual }) {
  const hint: Record<string, string> = {
    card: "Arraste uma medida para Valores",
    slicer: "Arraste uma coluna para Campo",
    table: "Arraste colunas e medidas para Colunas",
    matrix: "Arraste campos para Linhas e Valores",
  };
  return <div className="muted pad center">{hint[visual.type] ?? "Arraste campos para Eixo e Valores"}</div>;
}
