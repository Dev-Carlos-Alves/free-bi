// Elementos de Inserir › Formas, Imagem e Botões.

import type { Visual } from "../types";

export function ShapeVisual({ visual }: { visual: Visual }) {
  const o = visual.options ?? {};
  const kind = o.shape ?? "rect";
  const fill = o.fill ?? "none";
  const stroke = o.line_color ?? "none";
  const sw = o.line_width ?? 0;
  const h = sw / 2;
  // viewBox em pixels da própria visual: a forma acompanha o redimensionamento sem distorcer a borda.
  const W = Math.max(1, visual.w);
  const H = Math.max(1, visual.h);
  return (
    <svg className="shape" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
      {kind === "rect" && <rect x={h} y={h} width={W - sw} height={H - sw} fill={fill} stroke={stroke} strokeWidth={sw} />}
      {kind === "rounded" && <rect x={h} y={h} width={W - sw} height={H - sw} rx={Math.min(W, H) * 0.18} fill={fill} stroke={stroke} strokeWidth={sw} />}
      {kind === "ellipse" && <ellipse cx={W / 2} cy={H / 2} rx={Math.max(0, W / 2 - h)} ry={Math.max(0, H / 2 - h)} fill={fill} stroke={stroke} strokeWidth={sw} />}
      {(kind === "line" || kind === "arrow") && (
        <>
          <line x1={0} y1={H / 2} x2={kind === "arrow" ? W - sw * 3 : W} y2={H / 2} stroke={stroke === "none" ? "#0F766E" : stroke} strokeWidth={Math.max(1, sw)} />
          {kind === "arrow" && (
            <polygon
              points={`${W},${H / 2} ${W - Math.max(1, sw) * 4},${H / 2 - Math.max(1, sw) * 2.5} ${W - Math.max(1, sw) * 4},${H / 2 + Math.max(1, sw) * 2.5}`}
              fill={stroke === "none" ? "#0F766E" : stroke}
            />
          )}
        </>
      )}
    </svg>
  );
}

export function ImageVisual({ visual }: { visual: Visual }) {
  const src = visual.options?.src;
  if (!src) return <div className="muted pad center">Imagem sem arquivo — escolha uma na aba Formatar.</div>;
  return <img className="image-visual" src={src} alt={visual.title ?? ""} draggable={false} style={{ objectFit: visual.options?.fit ?? "contain" }} />;
}

export function ButtonVisual({ visual }: { visual: Visual }) {
  const o = visual.options ?? {};
  return (
    <div className="button-visual" style={{ background: o.fill ?? "#0F766E", color: (o.text_color as string) ?? "#FFFFFF", borderRadius: visual.style?.radius ?? 6 }}>
      {o.label ?? "Botão"}
    </div>
  );
}
