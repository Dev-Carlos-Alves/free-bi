import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import { formatCategory, formatValue } from "../format";
import { columnDtype, itemLabel, measureFormat } from "../queryBuilder";
import type { Plan } from "../queryBuilder";
import type { Model, QueryResult, Visual } from "../types";

export const DEFAULT_COLORS = ["#2563EB", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#F97316", "#64748B"];

interface Props {
  visual: Visual;
  plan: Plan;
  result: QueryResult;
  model: Model;
  colors: string[];
  foreground: string;
  selected: unknown[] | null;
  onSelect: (value: unknown | null) => void;
}

function useChart(option: echarts.EChartsCoreOption, onClick: (p: echarts.ECElementEvent) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => clickRef.current(p as echarts.ECElementEvent));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  return ref;
}

export function ChartVisual({ visual, plan, result, model, colors, foreground, selected, onSelect }: Props) {
  const option = useMemo(() => buildOption(visual, plan, result, model, colors, foreground, selected), [visual, plan, result, model, colors, foreground, selected]);
  const ref = useChart(option, (p) => {
    const raw = (p.data as { raw?: unknown } | undefined)?.raw;
    if (raw !== undefined) onSelect(raw);
  });
  return <div ref={ref} className="chart" onClick={(e) => e.target === e.currentTarget && onSelect(null)} />;
}

function buildOption(v: Visual, plan: Plan, r: QueryResult, model: Model, colors: string[], fg: string, selected: unknown[] | null): echarts.EChartsCoreOption {
  const nk = plan.keys.length;
  const labels = v.options?.labels ?? false;
  const fmtFor = (i: number) => measureFormat(model, plan.vals[i]) ?? null;
  const fmtVal = (x: unknown, i: number) => (typeof x === "number" ? formatValue(x, { format: fmtFor(i), compact: true }) : formatValue(x));
  const cat = plan.keys[0];
  const catDtype = cat ? columnDtype(model, cat) : undefined;
  const catLabel = (x: unknown) => formatCategory(x, cat?.date_part, cat?.date_part ? "integer" : catDtype);
  const isSel = (x: unknown) => !selected || selected.some((s) => s === x);
  const textStyle = { color: fg, fontFamily: "inherit" };
  const base = {
    color: colors,
    textStyle,
    animationDuration: 300,
    tooltip: { trigger: "item", confine: true },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
  };

  const pie = v.type === "pie" || v.type === "donut" || v.type === "funnel" || v.type === "treemap";
  if (pie) {
    const data = r.rows.map((row) => ({
      name: catLabel(row[0]),
      value: row[nk] as number,
      raw: row[0],
      itemStyle: { opacity: isSel(row[0]) ? 1 : 0.3 },
    }));
    const formatter = (p: { name: string; value: number; percent?: number }) =>
      `${p.name}: ${fmtVal(p.value, 0)}${p.percent !== undefined ? ` (${formatValue(p.percent / 100, { format: "0.0%" })})` : ""}`;
    if (v.type === "funnel") {
      return { ...base, tooltip: { trigger: "item", formatter }, series: [{ type: "funnel", data, left: 10, right: 10, top: 10, bottom: 10, label: { show: true, color: fg, formatter: (p: { name: string; value: number }) => `${p.name}: ${fmtVal(p.value, 0)}` } }] };
    }
    if (v.type === "treemap") {
      return { ...base, tooltip: { formatter }, series: [{ type: "treemap", data, roam: false, nodeClick: false, breadcrumb: { show: false }, width: "100%", height: "100%", label: { show: true } }] };
    }
    return {
      ...base,
      tooltip: { trigger: "item", formatter },
      legend: { type: "scroll", orient: "vertical", right: 0, top: "middle", textStyle },
      series: [{
        type: "pie",
        radius: v.type === "donut" ? ["45%", "72%"] : "72%",
        center: ["40%", "50%"],
        data,
        label: { show: labels, color: fg, formatter: (p: { percent: number }) => formatValue(p.percent / 100, { format: "0.0%" }) },
      }],
    };
  }

  if (v.type === "scatter") {
    const data = r.rows.map((row) => ({ value: [row[nk], row[nk + 1] ?? row[nk], row[nk + 2] ?? 1], name: catLabel(row[0]), raw: row[0] }));
    const sizes = r.rows.map((row) => Number(row[nk + 2] ?? 1));
    const maxSize = Math.max(1, ...sizes);
    return {
      ...base,
      grid: { left: 8, right: 24, top: 24, bottom: 24, containLabel: true },
      tooltip: { formatter: (p: { name: string; value: number[] }) => `${p.name}<br/>${itemLabel(plan.vals[0])}: ${fmtVal(p.value[0], 0)}<br/>${plan.vals[1] ? itemLabel(plan.vals[1]) + ": " + fmtVal(p.value[1], 1) : ""}` },
      xAxis: { type: "value", name: plan.vals[0] ? itemLabel(plan.vals[0]) : "", nameLocation: "middle", nameGap: 24, axisLabel: { formatter: (x: number) => fmtVal(x, 0) } },
      yAxis: { type: "value", axisLabel: { formatter: (x: number) => fmtVal(x, 1) } },
      series: [{ type: "scatter", data, symbolSize: (val: number[]) => (plan.vals[2] ? 6 + 30 * Math.sqrt(Number(val[2]) / maxSize) : 9) }],
    };
  }

  const horizontal = v.type === "bar" || v.type === "stacked_bar";
  const stacked = v.type === "stacked_bar" || v.type === "stacked_column";
  const legendField = v.fields.legend?.[0];
  let categories: unknown[] = [];
  let series: Record<string, unknown>[] = [];

  if (legendField && nk >= 2) {
    // Pivota: categoria × legenda.
    const cats: unknown[] = [];
    const leg: unknown[] = [];
    const cell = new Map<string, number>();
    const totals = new Map<unknown, number>();
    for (const row of r.rows) {
      if (!cats.includes(row[0])) cats.push(row[0]);
      if (!leg.includes(row[1])) leg.push(row[1]);
      cell.set(JSON.stringify([row[0], row[1]]), row[2] as number);
      totals.set(row[0], (totals.get(row[0]) ?? 0) + (Number(row[2]) || 0));
    }
    const catNumeric = cat?.date_part || ["integer", "decimal", "date", "datetime"].includes(catDtype ?? "");
    if (!catNumeric && !v.sort) cats.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    categories = cats;
    const legDtype = columnDtype(model, legendField);
    series = leg.map((l) => ({
      name: formatCategory(l, legendField.date_part, legDtype),
      type: v.type === "line" ? "line" : v.type === "area" ? "line" : "bar",
      areaStyle: v.type === "area" ? { opacity: 0.35 } : undefined,
      stack: stacked || v.type === "area" ? "s" : undefined,
      data: cats.map((c) => ({ value: cell.get(JSON.stringify([c, l])) ?? null, raw: c })),
      label: { show: labels, position: stacked ? "inside" : horizontal ? "right" : "top", color: fg, formatter: (p: { value: number }) => fmtVal(p.value, 0) },
    }));
  } else {
    categories = r.rows.map((row) => row[0]);
    const nv = plan.vals.length;
    const second = v.fields.values2?.length ?? 0;
    series = plan.vals.map((val, i) => {
      const isLine = v.type === "line" || v.type === "area" || (v.type === "combo" && i >= nv - second);
      return {
        name: itemLabel(val),
        type: isLine ? "line" : "bar",
        yAxisIndex: v.type === "combo" && i >= nv - second ? 1 : 0,
        smooth: false,
        showSymbol: r.rows.length < 60,
        areaStyle: v.type === "area" ? { opacity: 0.35 } : undefined,
        stack: stacked ? "s" : undefined,
        barMaxWidth: 48,
        data: r.rows.map((row) => ({
          value: row[nk + i] as number,
          raw: row[0],
          itemStyle: { opacity: isSel(row[0]) ? 1 : 0.3 },
        })),
        label: {
          show: labels,
          position: stacked ? "inside" : horizontal ? "right" : "top",
          color: fg,
          fontSize: 11,
          formatter: (p: { value: number }) => fmtVal(p.value, i),
        },
      };
    });
  }

  const catAxis = {
    type: "category",
    data: categories.map(catLabel),
    axisLabel: { color: fg, hideOverlap: true, overflow: "truncate", width: horizontal ? 140 : 90 },
    axisTick: { show: false },
    inverse: horizontal,
  };
  const valAxis = (i: number) => ({
    type: "value",
    axisLabel: { color: fg, formatter: (x: number) => fmtVal(x, i) },
    splitLine: { lineStyle: { color: "rgba(127,127,127,0.18)" } },
  });
  const legendShown = series.length > 1;
  return {
    ...base,
    grid: { left: 8, right: horizontal ? 48 : 16, top: legendShown ? 32 : 20, bottom: 8, containLabel: true },
    legend: legendShown ? { type: "scroll", top: 0, textStyle } : undefined,
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: v.type === "line" || v.type === "area" ? "line" : "shadow" },
      valueFormatter: (x: number) => fmtVal(x, 0),
    },
    dataZoom: categories.length > 40 && !horizontal ? [{ type: "inside" }] : undefined,
    xAxis: horizontal ? valAxis(0) : catAxis,
    yAxis: horizontal ? catAxis : v.type === "combo" ? [valAxis(0), { ...valAxis(plan.vals.length - 1), splitLine: { show: false } }] : valAxis(0),
    series,
  };
}
