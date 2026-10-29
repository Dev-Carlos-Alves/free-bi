// Faixa de opções com abas, no estilo do Power BI Desktop.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getData, importPbix, newProject, openProject, refreshData, saveProject } from "../actions";
import {
  addPage, applyTheme, copyVisual, cutVisual, exportThemeFile, importThemeFile, insertButton, insertImage, insertShape,
  insertTextBox, isBuiltinTheme, PAGE_SIZES, pasteVisual, setPageSize, startPainter, THEMES,
} from "../reportOps";
import { currentPage, newId, useStore, type FitMode, type RibbonTab, type ViewPrefs } from "../store";
import type { Theme } from "../types";
import { openDialog } from "./dialogs";

const TABS: { id: RibbonTab; label: string }[] = [
  { id: "file", label: "Arquivo" },
  { id: "home", label: "Página Inicial" },
  { id: "insert", label: "Inserir" },
  { id: "modeling", label: "Modelagem" },
  { id: "view", label: "Exibição" },
  { id: "design", label: "Design" },
];

export function Ribbon() {
  const tab = useStore((s) => s.ribbonTab);
  return (
    <header className="ribbon">
      <div className="ribbon-tabs">
        <div className="brand">
          <Logo /> Free BI
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`rtab ${tab === t.id ? "active" : ""}`} onClick={() => useStore.setState({ ribbonTab: t.id })}>
            {t.label}
          </button>
        ))}
        <span className="grow" />
        <button className="rtab" onClick={() => openDialog({ kind: "about" })} title="Sobre o Free BI">?</button>
      </div>
      <div className="ribbon-body">
        {tab === "file" && <FileTab />}
        {tab === "home" && <HomeTab />}
        {tab === "insert" && <InsertTab />}
        {tab === "modeling" && <ModelingTab />}
        {tab === "view" && <ViewTab />}
        {tab === "design" && <DesignTab />}
      </div>
    </header>
  );
}

/** O mesmo desenho de src-tauri/icons/icon-source.svg. */
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 1024 1024" width="20" height="20" aria-hidden="true">
      <rect x="40" y="40" width="944" height="944" rx="216" fill="#0F766E" />
      <rect x="262" y="236" width="124" height="560" rx="30" fill="#F0FDFA" />
      <rect x="262" y="236" width="520" height="124" rx="30" fill="#F0FDFA" />
      <rect x="262" y="452" width="350" height="124" rx="30" fill="#5EEAD4" />
      <rect x="660" y="452" width="96" height="124" rx="30" fill="#FBBF24" />
    </svg>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rgroup-items">{children}</div>
      <div className="rgroup-label">{label}</div>
    </div>
  );
}

function Btn({ icon, label, onClick, title, disabled, active }: { icon: string; label: string; onClick: () => void; title?: string; disabled?: boolean; active?: boolean }) {
  return (
    <button className={`rbtn ${active ? "on" : ""}`} onClick={onClick} title={title ?? label} disabled={disabled}>
      <i>{icon}</i>
      <span>{label}</span>
    </button>
  );
}

/** Botão pequeno (empilhado em coluna, como Recortar/Copiar no Power BI). */
function Small({ icon, label, onClick, title, disabled }: { icon: string; label: string; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button className="rsmall" onClick={onClick} title={title ?? label} disabled={disabled}>
      <i>{icon}</i> {label}
    </button>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="rcheck">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/** Botão que abre um menu suspenso. */
function Drop({ icon, label, children, disabled }: { icon: string; label: string; children: (close: () => void) => ReactNode; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="rdrop" ref={ref}>
      <button className={`rbtn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} disabled={disabled}>
        <i>{icon}</i>
        <span>{label} ▾</span>
      </button>
      {open && <div className="rmenu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function FileTab() {
  return (
    <>
      <Group label="Arquivo">
        <Btn icon="📄" label="Novo" onClick={newProject} title="Novo relatório" />
        <Btn icon="📂" label="Abrir" onClick={openProject} title="Abrir projeto .freebi (Ctrl+O)" />
        <Btn icon="💾" label="Salvar" onClick={() => saveProject(false)} title="Salvar (Ctrl+S)" />
        <Btn icon="🗂" label="Salvar como" onClick={() => saveProject(true)} title="Salvar como (Ctrl+Shift+S)" />
      </Group>
      <Group label="Power BI">
        <Btn icon="⇪" label="Importar .pbix" onClick={importPbix} title="Abrir um relatório do Power BI (.pbix)" />
      </Group>
    </>
  );
}

function HomeTab() {
  const sel = useStore((s) => s.selectedVisual);
  const clip = useStore((s) => s.clipboard);
  const painter = useStore((s) => s.painter);
  const firstTable = useStore((s) => s.model.tables[0]?.name);
  return (
    <>
      <Group label="Área de transferência">
        <Btn icon="📋" label="Colar" onClick={pasteVisual} disabled={!clip?.length} title="Colar (Ctrl+V)" />
        <div className="rstack">
          <Small icon="✂" label="Recortar" onClick={cutVisual} disabled={!sel} title="Recortar (Ctrl+X)" />
          <Small icon="⧉" label="Copiar" onClick={copyVisual} disabled={!sel} title="Copiar (Ctrl+C)" />
          <button className={`rsmall ${painter ? "on" : ""}`} onClick={startPainter} disabled={!sel && !painter} title="Pincel de formatação: copia a aparência da visual selecionada para outra">
            <i>🖌</i> Pincel de formatação
          </button>
        </div>
      </Group>
      <Group label="Dados">
        <Btn icon="🛢" label="Obter dados" onClick={getData} title="CSV, Excel, Parquet, JSON" />
        <Btn icon="⇪" label="Importar .pbix" onClick={importPbix} />
        <Btn icon="⟳" label="Atualizar" onClick={refreshData} title="Recarregar arquivos de origem" />
      </Group>
      <Group label="Inserir">
        <Btn icon="▥" label="Novo visual" onClick={() => newChart()} title="Nova visual de colunas" />
        <Btn icon="T" label="Caixa de texto" onClick={insertTextBox} />
      </Group>
      <Group label="Cálculos">
        <Btn icon="ƒx" label="Nova medida" disabled={!firstTable} onClick={() => openDialog({ kind: "measure", table: firstTable! })} />
        <Btn icon="ƒ" label="Nova coluna" disabled={!firstTable} onClick={() => openDialog({ kind: "calc-column", table: firstTable! })} />
      </Group>
      <Group label="Histórico">
        <Btn icon="↶" label="Desfazer" onClick={() => useStore.getState().undo()} title="Desfazer (Ctrl+Z)" />
        <Btn icon="↷" label="Refazer" onClick={() => useStore.getState().redo()} title="Refazer (Ctrl+Y)" />
      </Group>
    </>
  );
}

function newChart() {
  const s = useStore.getState();
  const n = currentPage().visuals.length;
  const id = newId();
  s.updatePage((p) => ({ ...p, visuals: [...p.visuals, { id, type: "column", x: 40 + (n % 6) * 24, y: 40 + (n % 6) * 24, w: 420, h: 280, title: null, fields: {}, options: { labels: false } }] }));
  s.select(id);
  s.setView("report");
}

function InsertTab() {
  const pages = useStore((s) => s.report.pages);
  return (
    <>
      <Group label="Páginas">
        <Btn icon="＋" label="Nova página" onClick={() => addPage()} />
        <Btn icon="⧉" label="Duplicar página" onClick={() => addPage(currentPage())} />
      </Group>
      <Group label="Visuais">
        <Btn icon="▥" label="Novo visual" onClick={newChart} />
      </Group>
      <Group label="Elementos">
        <Btn icon="T" label="Caixa de texto" onClick={insertTextBox} />
        <Drop icon="⏵" label="Botões">
          {(close) => (
            <>
              <button onClick={() => { insertButton({ kind: "back" }, "← Voltar"); close(); }}>← Voltar (página anterior)</button>
              <div className="rmenu-sep">Navegar para a página</div>
              {pages.map((p) => (
                <button key={p.id} onClick={() => { insertButton({ kind: "page", page_id: p.id }, p.name); close(); }}>{p.name}</button>
              ))}
              <div className="rmenu-sep" />
              <button onClick={() => { insertButton({ kind: "none" }, "Botão"); close(); }}>Botão em branco</button>
            </>
          )}
        </Drop>
        <Drop icon="◆" label="Formas">
          {(close) => (
            <>
              {([["rect", "▭ Retângulo"], ["rounded", "▢ Retângulo arredondado"], ["ellipse", "◯ Elipse"], ["line", "— Linha"], ["arrow", "→ Seta"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => { insertShape(k); close(); }}>{label}</button>
              ))}
            </>
          )}
        </Drop>
        <Btn icon="🖼" label="Imagem" onClick={insertImage} title="PNG, JPG, GIF, SVG ou WebP (fica salva dentro do .freebi)" />
      </Group>
    </>
  );
}

function ModelingTab() {
  const tables = useStore((s) => s.model.tables);
  const firstTable = tables[0]?.name;
  return (
    <>
      <Group label="Relações">
        <Btn icon="⛓" label="Nova relação" disabled={tables.length < 2} onClick={() => openDialog({ kind: "relationship" })} />
        <Btn icon="🗺" label="Exibir modelo" onClick={() => useStore.getState().setView("model")} />
      </Group>
      <Group label="Cálculos">
        <Btn icon="ƒx" label="Nova medida" disabled={!firstTable} onClick={() => openDialog({ kind: "measure", table: firstTable! })} />
        <Btn icon="ƒ" label="Nova coluna" disabled={!firstTable} onClick={() => openDialog({ kind: "calc-column", table: firstTable! })} />
      </Group>
      <Group label="Dados">
        <Btn icon="▦" label="Exibir dados" onClick={() => useStore.getState().setView("data")} />
      </Group>
    </>
  );
}

function ViewTab() {
  const prefs = useStore((s) => s.prefs);
  const set = (patch: Partial<ViewPrefs>) => useStore.getState().setPrefs((p) => ({ ...p, ...patch }));
  const pane = (k: keyof ViewPrefs["panes"]) => () => useStore.getState().setPrefs((p) => ({ ...p, panes: { ...p.panes, [k]: !p.panes[k] } }));
  const fits: { f: FitMode; icon: string; label: string }[] = [
    { f: "page", icon: "⤢", label: "Ajustar à página" },
    { f: "width", icon: "↔", label: "Ajustar à largura" },
    { f: "actual", icon: "1:1", label: "Tamanho real" },
  ];
  return (
    <>
      <Group label="Exibição de página">
        {fits.map((x) => (
          <Btn key={x.f} icon={x.icon} label={x.label} active={prefs.fit === x.f} onClick={() => set({ fit: x.f })} />
        ))}
      </Group>
      <Group label="Opções de página">
        <div className="rstack">
          <Check label="Linhas de grade" checked={prefs.gridlines} onChange={(v) => set({ gridlines: v })} />
          <Check label="Ajustar à grade" checked={prefs.snap} onChange={(v) => set({ snap: v })} />
          <Check label="Bloquear objetos" checked={prefs.lock} onChange={(v) => set({ lock: v })} />
        </div>
      </Group>
      <Group label="Mostrar painéis">
        <Btn icon="⚲" label="Filtros" active={prefs.panes.filters} onClick={pane("filters")} />
        <Btn icon="▤" label="Visualizações" active={prefs.panes.visualizations} onClick={pane("visualizations")} />
        <Btn icon="🗃" label="Dados" active={prefs.panes.fields} onClick={pane("fields")} />
        <Btn icon="☰" label="Seleção" active={prefs.panes.selection} onClick={pane("selection")} title="Camadas da página: ordem, ocultar e selecionar visuais" />
      </Group>
    </>
  );
}

function ThemeSwatch({ t, active, onClick }: { t: Theme; active: boolean; onClick: () => void }) {
  return (
    <button className={`swatch ${active ? "on" : ""}`} onClick={onClick} title={t.name} style={{ background: t.page_background ?? "#fff" }}>
      <span className="swatch-bars">
        {(t.colors ?? []).slice(0, 5).map((c, i) => (
          <b key={i} style={{ background: c, height: `${40 + ((i * 37) % 60)}%` }} />
        ))}
      </span>
      <span className="swatch-name" style={{ color: t.foreground ?? "#111" }}>{t.name}</span>
    </button>
  );
}

function DesignTab() {
  const report = useStore((s) => s.report);
  const pageIndex = useStore((s) => s.pageIndex);
  const page = report.pages[pageIndex] ?? report.pages[0];
  const theme = report.theme;
  const custom = theme && !isBuiltinTheme(theme) ? theme : report.custom_theme ?? null;
  const s = useStore.getState();
  return (
    <>
      <Group label="Temas">
        <div className="swatches">
          {custom && <ThemeSwatch t={custom} active={theme?.name === custom.name} onClick={() => applyTheme(custom)} />}
          {THEMES.map((t) => (
            <ThemeSwatch key={t.name} t={t} active={theme?.name === t.name} onClick={() => applyTheme(t)} />
          ))}
        </div>
        <div className="rstack">
          <Small icon="⇩" label="Importar tema" onClick={importThemeFile} title="Tema JSON do Power BI (Design › Baixar tema)" />
          <Small icon="⇧" label="Baixar tema" onClick={exportThemeFile} title="Salva o tema atual em JSON compatível com o Power BI" />
        </div>
      </Group>
      <Group label="Personalizar página">
        <Drop icon="▭" label="Tamanho da página">
          {(close) => (
            <>
              {PAGE_SIZES.map((p) => (
                <button key={p.label} className={page.width === p.w && page.height === p.h ? "on" : ""} onClick={() => { setPageSize(p.w, p.h); close(); }}>{p.label}</button>
              ))}
              <div className="rmenu-sep">Personalizado</div>
              <PageSizeForm w={page.width} h={page.height} onDone={close} />
            </>
          )}
        </Drop>
        <label className="rcolor" title="Segundo plano desta página">
          <input type="color" value={page.background ?? theme?.page_background ?? "#ffffff"} onChange={(e) => s.updatePage((p) => ({ ...p, background: e.target.value }))} />
          <span>Segundo plano da página</span>
        </label>
        <label className="rcolor" title="Cor da área em volta da página">
          <input type="color" value={report.wallpaper ?? "#e5e7eb"} onChange={(e) => s.setReport({ ...useStore.getState().report, wallpaper: e.target.value })} />
          <span>Papel de parede</span>
        </label>
        <Small icon="↺" label="Restaurar cores" onClick={() => {
          const r = useStore.getState().report;
          s.setReport({ ...r, wallpaper: null, pages: r.pages.map((p, i) => (i === pageIndex ? { ...p, background: null } : p)) });
        }} title="Volta ao segundo plano do tema" />
      </Group>
    </>
  );
}

function PageSizeForm({ w, h, onDone }: { w: number; h: number; onDone: () => void }) {
  const [W, setW] = useState(w);
  const [H, setH] = useState(h);
  return (
    <div className="rsize">
      <input type="number" min={200} max={4000} value={W} onChange={(e) => setW(Number(e.target.value))} aria-label="Largura" />
      ×
      <input type="number" min={200} max={4000} value={H} onChange={(e) => setH(Number(e.target.value))} aria-label="Altura" />
      <button onClick={() => { setPageSize(Math.max(200, W), Math.max(200, H)); onDone(); }}>Aplicar</button>
    </div>
  );
}
