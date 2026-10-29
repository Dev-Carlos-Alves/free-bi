// Operações de edição do relatório usadas pela faixa de opções, atalhos e menus.

import { api, pickExportPath } from "./api";
import { currentPage, errorText, newId, useStore } from "./store";
import type { ButtonAction, Page, ShapeKind, Theme, Visual, VisualType } from "./types";

// ------------------------------------------------------------ área de transferência

function selected(): Visual | null {
  const s = useStore.getState();
  return currentPage().visuals.find((v) => v.id === s.selectedVisual) ?? null;
}

export function copyVisual() {
  const v = selected();
  if (!v) return;
  useStore.setState({ clipboard: [structuredClone(v)] });
}

export function cutVisual() {
  const v = selected();
  if (!v) return;
  copyVisual();
  const s = useStore.getState();
  s.updatePage((p) => ({ ...p, visuals: p.visuals.filter((x) => x.id !== v.id) }));
  s.select(null);
}

/** Cola na página atual. Na mesma posição se a página for outra; deslocada se for a mesma (como no Power BI). */
export function pasteVisual() {
  const s = useStore.getState();
  if (!s.clipboard?.length) return;
  const page = currentPage();
  const copies = s.clipboard.map((v) => {
    const clash = page.visuals.some((x) => x.x === v.x && x.y === v.y);
    const off = clash ? 24 : 0;
    return { ...structuredClone(v), id: newId(), x: Math.min(v.x + off, page.width - v.w), y: Math.min(v.y + off, page.height - v.h) };
  });
  s.updatePage((p) => ({ ...p, visuals: [...p.visuals, ...copies] }));
  s.select(copies[copies.length - 1].id);
  // A próxima colagem sai deslocada em relação a esta.
  useStore.setState({ clipboard: copies.map((c) => structuredClone(c)) });
}

export function duplicateVisual(v: Visual) {
  const s = useStore.getState();
  const copy = { ...structuredClone(v), id: newId(), x: v.x + 24, y: v.y + 24 };
  s.updatePage((p) => ({ ...p, visuals: [...p.visuals, copy] }));
  s.select(copy.id);
}

export function removeVisual(id: string) {
  const s = useStore.getState();
  s.updatePage((p) => ({ ...p, visuals: p.visuals.filter((v) => v.id !== id) }));
  s.select(null);
  if (s.crossFilter?.visualId === id) s.setCrossFilter(null);
  if (s.focusVisual === id) useStore.setState({ focusVisual: null });
}

// ------------------------------------------------------------ pincel de formatação

/** Opções que descrevem aparência (o pincel não copia dados, texto, imagem nem ação). */
const STYLE_OPTIONS = ["labels", "shape", "fill", "line_color", "line_width", "fit", "slicer_mode"] as const;

export function startPainter() {
  const v = selected();
  const s = useStore.getState();
  if (s.painter) return useStore.setState({ painter: null });
  if (!v) return s.notify("Selecione a visual cuja formatação será copiada.");
  const options: Visual["options"] = {};
  for (const k of STYLE_OPTIONS) if (v.options?.[k] !== undefined) options[k] = v.options[k] as never;
  useStore.setState({ painter: { style: structuredClone(v.style), options } });
  s.notify("Pincel ativo: clique na visual que vai receber a formatação (Esc cancela).");
}

export function applyPainter(target: string) {
  const s = useStore.getState();
  const p = s.painter;
  if (!p) return;
  s.updateVisual(target, (v) => ({ ...v, style: structuredClone(p.style), options: { ...v.options, ...p.options } }));
  useStore.setState({ painter: null });
}

// ------------------------------------------------------------ camadas

export function moveLayer(id: string, to: "front" | "back" | "forward" | "backward") {
  useStore.getState().updatePage((p) => {
    const i = p.visuals.findIndex((v) => v.id === id);
    if (i < 0) return p;
    const list = [...p.visuals];
    const [v] = list.splice(i, 1);
    const j = to === "front" ? list.length : to === "back" ? 0 : to === "forward" ? Math.min(list.length, i + 1) : Math.max(0, i - 1);
    list.splice(j, 0, v);
    return { ...p, visuals: list };
  });
}

export function toggleHidden(id: string) {
  useStore.getState().updateVisual(id, (v) => ({ ...v, hidden: !v.hidden }));
}

// ------------------------------------------------------------ inserir

function addVisual(partial: Partial<Visual> & { type: VisualType }) {
  const s = useStore.getState();
  const page = currentPage();
  const n = page.visuals.length;
  const v: Visual = {
    id: newId(),
    x: 40 + (n % 6) * 24,
    y: 40 + (n % 6) * 24,
    w: 320,
    h: 180,
    title: null,
    fields: {},
    options: {},
    ...partial,
  };
  s.updatePage((p) => ({ ...p, visuals: [...p.visuals, v] }));
  s.select(v.id);
  s.setView("report");
  return v;
}

export function insertTextBox() {
  addVisual({ type: "text", w: 480, h: 72, text: [[{ value: "Novo título", bold: true, size: 18 }]] });
}

export function insertShape(shape: ShapeKind) {
  const line = shape === "line" || shape === "arrow";
  addVisual({
    type: "shape",
    w: line ? 240 : 200,
    h: line ? 24 : 120,
    options: { shape, fill: line ? null : "#14B8A6", line_color: line ? "#0F766E" : null, line_width: line ? 3 : 0 },
  });
}

export function insertButton(action: ButtonAction, label: string) {
  addVisual({ type: "button", w: 160, h: 40, options: { action, label, fill: "#0F766E" }, style: { radius: 6 } });
}

/** Lê um arquivo local escolhido pelo usuário (funciona no app e no navegador). */
function readLocalFile(accept: string, as: "text" | "dataUrl"): Promise<{ name: string; data: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, data: String(reader.result) });
      reader.onerror = () => resolve(null);
      if (as === "text") reader.readAsText(file);
      else reader.readAsDataURL(file);
    };
    input.click();
  });
}

/** Imagens maiores que isso deixariam o .freebi pesado (a imagem fica dentro do projeto). */
const MAX_IMAGE = 4 * 1024 * 1024;

export async function insertImage() {
  const f = await readLocalFile("image/png,image/jpeg,image/gif,image/svg+xml,image/webp", "dataUrl");
  if (!f) return;
  if (f.data.length > MAX_IMAGE * 1.37) return useStore.getState().notify("Imagem grande demais (máximo 4 MB).", "error");
  const img = new Image();
  img.onload = () => {
    // Entre 120 e 400 px de largura (ícones minúsculos ficariam impossíveis de selecionar), mantendo a proporção.
    const ratio = img.width && img.height ? img.width / img.height : 1;
    const w = Math.max(120, Math.min(400, img.width || 400));
    addVisual({ type: "image", w, h: Math.max(24, Math.round(w / ratio)), title: null, options: { src: f.data, fit: "contain" } });
  };
  img.onerror = () => useStore.getState().notify("Não foi possível abrir a imagem.", "error");
  img.src = f.data;
}

// ------------------------------------------------------------ páginas

export function addPage(copyOf?: Page) {
  const s = useStore.getState();
  const n = s.report.pages.length + 1;
  const p: Page = copyOf
    ? { ...structuredClone(copyOf), id: newId("p"), name: `Duplicata de ${copyOf.name}`, visuals: copyOf.visuals.map((v) => ({ ...structuredClone(v), id: newId() })) }
    : { id: newId("p"), name: `Página ${n}`, width: currentPage()?.width ?? 1280, height: currentPage()?.height ?? 720, visuals: [] };
  const at = copyOf ? s.pageIndex + 1 : s.report.pages.length;
  const pages = [...s.report.pages];
  pages.splice(at, 0, p);
  s.setReport({ ...s.report, pages });
  s.setPage(at);
  s.setView("report");
}

export const PAGE_SIZES: { label: string; w: number; h: number }[] = [
  { label: "16:9 (1280 × 720)", w: 1280, h: 720 },
  { label: "4:3 (960 × 720)", w: 960, h: 720 },
  { label: "Carta (816 × 1056)", w: 816, h: 1056 },
  { label: "Celular (320 × 568)", w: 320, h: 568 },
];

export function setPageSize(w: number, h: number) {
  useStore.getState().updatePage((p) => ({
    ...p,
    width: w,
    height: h,
    // Mantém as visuais dentro da nova área.
    visuals: p.visuals.map((v) => ({ ...v, w: Math.min(v.w, w), h: Math.min(v.h, h), x: Math.min(v.x, Math.max(0, w - Math.min(v.w, w))), y: Math.min(v.y, Math.max(0, h - Math.min(v.h, h))) })),
  }));
}

export function goBack() {
  const s = useStore.getState();
  const prev = s.pageTrail[s.pageTrail.length - 1];
  if (prev === undefined) return;
  useStore.setState({ pageIndex: prev, pageTrail: s.pageTrail.slice(0, -1), selectedVisual: null, crossFilter: null, focusVisual: null });
}

export function runButton(action: ButtonAction | undefined) {
  if (!action || action.kind === "none") return;
  if (action.kind === "back") return goBack();
  const s = useStore.getState();
  const i = s.report.pages.findIndex((p) => p.id === action.page_id);
  if (i >= 0) s.setPage(i);
  else s.notify("A página de destino deste botão não existe mais.", "error");
}

// ------------------------------------------------------------ temas

export const THEMES: Theme[] = [
  { name: "Free BI", colors: ["#0F766E", "#F59E0B", "#2563EB", "#DB2777", "#7C3AED", "#14B8A6", "#EA580C", "#64748B"], foreground: "#1F2937", page_background: "#FFFFFF", visual_background: "#FFFFFF", table_accent: "#0F766E" },
  { name: "Clássico", colors: ["#2563EB", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"], foreground: "#1F2937", page_background: "#FFFFFF", visual_background: "#FFFFFF", table_accent: "#2563EB" },
  { name: "Executivo", colors: ["#1E3A5F", "#C9A227", "#4A7BA7", "#8C6D1F", "#7F8C9A", "#2E5E4E", "#A3485A", "#5B4B8A"], foreground: "#1E293B", page_background: "#F5F3EE", visual_background: "#FFFFFF", table_accent: "#1E3A5F" },
  { name: "Pastel", colors: ["#7DB9B6", "#F4A896", "#A0C4E2", "#F6D186", "#C3AED6", "#9FD8A8", "#F2B5D4", "#B8B8B8"], foreground: "#334155", page_background: "#FBFAF7", visual_background: "#FFFFFF", table_accent: "#7DB9B6" },
  { name: "Alto contraste", colors: ["#000000", "#E00000", "#0050D0", "#008A00", "#B000B0", "#C06000", "#007070", "#606060"], foreground: "#000000", page_background: "#FFFFFF", visual_background: "#FFFFFF", table_accent: "#000000" },
  { name: "Escuro", colors: ["#2DD4BF", "#FBBF24", "#60A5FA", "#F472B6", "#A78BFA", "#4ADE80", "#FB923C", "#94A3B8"], foreground: "#E5E7EB", page_background: "#111827", visual_background: "#1F2937", table_accent: "#2DD4BF" },
];

export const isBuiltinTheme = (t?: Theme | null) => !!t && THEMES.some((x) => x.name === t.name);

export function applyTheme(theme: Theme) {
  const s = useStore.getState();
  const cur = s.report.theme;
  // O tema próprio que estava em uso continua disponível na galeria.
  const custom = !isBuiltinTheme(theme) ? theme : cur && !isBuiltinTheme(cur) ? cur : s.report.custom_theme ?? null;
  s.setReport({ ...s.report, theme: structuredClone(theme), custom_theme: custom ? structuredClone(custom) : null });
}

type Json = Record<string, unknown>;
const pick = (o: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Json)[k as string] : undefined), o);
const solid = (o: unknown) => pick(o, 0, "color", "solid", "color") as string | undefined;

/** Converte um tema JSON do Power BI (o mesmo de Design › Personalizar/Baixar tema) para o formato do Free BI. */
export function themeFromPowerBi(t: Json): Theme {
  const colors = Array.isArray(t.dataColors) ? (t.dataColors as unknown[]).filter((c): c is string => typeof c === "string") : undefined;
  return {
    name: typeof t.name === "string" ? t.name : "Tema importado",
    colors: colors?.length ? colors : undefined,
    background: (t.background as string) ?? undefined,
    foreground: (t.foreground as string) ?? undefined,
    table_accent: (t.tableAccent as string) ?? undefined,
    page_background: solid(pick(t, "visualStyles", "page", "*", "background")) ?? undefined,
    visual_background: solid(pick(t, "visualStyles", "*", "*", "background")) ?? (t.background as string) ?? undefined,
  };
}

export function themeToPowerBi(t: Theme): Json {
  const fill = (c?: string | null) => (c ? [{ color: { solid: { color: c } } }] : undefined);
  const visualStyles: Json = {};
  if (t.page_background) visualStyles.page = { "*": { background: fill(t.page_background) } };
  if (t.visual_background) visualStyles["*"] = { "*": { background: fill(t.visual_background) } };
  return {
    name: t.name ?? "Tema Free BI",
    dataColors: t.colors ?? [],
    ...(t.foreground ? { foreground: t.foreground } : {}),
    ...(t.visual_background ? { background: t.visual_background } : {}),
    ...(t.table_accent ? { tableAccent: t.table_accent } : {}),
    visualStyles,
  };
}

export async function importThemeFile() {
  const s = useStore.getState();
  const f = await readLocalFile(".json,application/json", "text");
  if (!f) return;
  try {
    const theme = themeFromPowerBi(JSON.parse(f.data) as Json);
    applyTheme(theme);
    s.notify(`Tema "${theme.name}" aplicado.`);
  } catch (e) {
    s.notify(`Tema inválido: ${errorText(e)}`, "error");
  }
}

export async function exportThemeFile() {
  const s = useStore.getState();
  const theme = s.report.theme ?? THEMES[0];
  const name = `${(theme.name ?? "tema").replace(/[\\/:*?"<>|]/g, "_")}.json`;
  const target = await pickExportPath(name, "json");
  if (!target) return;
  const text = JSON.stringify(themeToPowerBi(theme), null, 2);
  try {
    if (target.download) {
      // No navegador o download é direto: o arquivo não precisa passar pelo servidor.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } else {
      await api.writeText(target.path, text);
    }
    s.notify("Tema exportado. Ele também abre no Power BI (Design › Importar tema).");
  } catch (e) {
    s.notify(errorText(e), "error");
  }
}
