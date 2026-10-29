// Formatação de números no padrão brasileiro, com suporte ao essencial das
// strings de formato do Power BI ("0.0%", "#,0", "R$ #,0.00", "0.00"...).

const MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function nf(min: number, max: number, grouping = true) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping });
}

/** Formata com uma string de formato do Power BI (subconjunto). */
export function formatWith(v: number, fmt: string): string {
  const section = fmt.split(";")[v < 0 && fmt.includes(";") ? 1 : 0] ?? fmt;
  const percent = section.includes("%");
  const m = section.match(/[0#][0#,]*(?:\.([0#]+))?/);
  const decimals = m?.[1]?.length ?? 0;
  const minDec = m?.[1] ? (m[1].match(/0/g) ?? []).length : 0;
  const grouping = /#,|0,0|,0/.test(section);
  const value = percent ? v * 100 : v;
  const body = nf(minDec, decimals, grouping).format(v < 0 && fmt.includes(";") ? Math.abs(value) : value);
  const prefix = m ? section.slice(0, m.index).replace(/["\\]/g, "") : "";
  const suffix = m ? section.slice((m.index ?? 0) + m[0].length).replace(/["\\]/g, "") : "";
  return `${prefix}${body}${suffix}`.replace("%%", "%");
}

export interface FormatOpts {
  format?: string | null;
  /** Abrevia (mil, mi, bi) como nos cartões do Power BI. */
  compact?: boolean;
  dtype?: string;
}

export function formatValue(v: unknown, opts: FormatOpts = {}): string {
  if (v === null || v === undefined) return "(Em branco)";
  if (typeof v === "boolean") return v ? "Verdadeiro" : "Falso";
  if (typeof v === "number") {
    if (opts.format && !opts.compact) return formatWith(v, opts.format);
    if (opts.format && opts.format.includes("%")) return formatWith(v, opts.format);
    if (opts.compact) return compact(v, opts.format);
    if (Number.isInteger(v)) return nf(0, 0).format(v);
    return nf(0, 2).format(v);
  }
  if (typeof v === "string" && (opts.dtype === "date" || opts.dtype === "datetime")) return formatDate(v);
  return String(v);
}

export function compact(v: number, fmt?: string | null): string {
  const a = Math.abs(v);
  if (a >= 1e9) return nf(0, 2).format(v / 1e9) + " bi";
  if (a >= 1e6) return nf(0, 2).format(v / 1e6) + " mi";
  if (a >= 1e4) return nf(0, 2).format(v / 1e3) + " mil";
  if (fmt) return formatWith(v, fmt);
  return Number.isInteger(v) ? nf(0, 0).format(v) : nf(0, 2).format(v);
}

/** "2024-03-05" → "05/03/2024" (e com hora, se houver). */
export function formatDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return s;
  const d = `${m[3]}/${m[2]}/${m[1]}`;
  if (m[4] && !(m[4] === "00" && m[5] === "00" && (m[6] ?? "00") === "00")) return `${d} ${m[4]}:${m[5]}`;
  return d;
}

/** Rótulo de categoria (inclui nomes de mês para hierarquia de datas). */
export function formatCategory(v: unknown, datePart?: string | null, dtype?: string): string {
  if (datePart === "month" && typeof v === "number") return MONTHS[v] ?? String(v);
  if (datePart === "quarter" && typeof v === "number") return `Trim ${v}`;
  if (typeof v === "number") return datePart === "year" || dtype === "integer" ? String(v) : formatValue(v);
  return formatValue(v, { dtype });
}
