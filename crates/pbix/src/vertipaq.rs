//! Decodificação das colunas VertiPaq: segmentos .idf (RLE + bit-packing),
//! metadados .idfmeta e dicionários (números ou textos com Huffman) — ver [MS-XLDM].

use anyhow::{anyhow, bail, Result};

/// Id reservado para nulo; o primeiro valor real é 3.
const DATA_ID_NULL: i64 = 2;
const FIRST_DATA_ID: i64 = 3;

pub struct Cur<'a> {
    b: &'a [u8],
    pub i: usize,
}

impl<'a> Cur<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        Cur { b, i: 0 }
    }
    pub fn eof(&self) -> bool {
        self.i >= self.b.len()
    }
    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        let v = self.b.get(self.i..self.i + n).ok_or_else(|| anyhow!("dados VertiPaq truncados"))?;
        self.i += n;
        Ok(v)
    }
    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }
    pub fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }
    pub fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }
    pub fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }
    fn tag(&mut self, t: &[u8]) -> Result<()> {
        let got = self.bytes(t.len())?;
        if got != t {
            bail!("marcador inválido: esperado {:?}", String::from_utf8_lossy(t));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- .idfmeta

#[derive(Debug, Clone)]
pub struct SegMeta {
    pub records: u64,
    pub min_data_id: u32,
    pub has_nulls: bool,
    pub count_bit_packed: u64,
    pub bit_width: u32,
}

fn bit_width_of(class: u32) -> Option<u32> {
    match class {
        703031..=703040 => Some(class - 703030),
        703042 => Some(12),
        703046 => Some(16),
        703051 => Some(21),
        703062 => Some(32),
        _ => None,
    }
}

pub fn parse_idfmeta(b: &[u8]) -> Result<Vec<SegMeta>> {
    let mut c = Cur::new(b);
    c.tag(b"<1:CP\0")?;
    let n = c.u64()?;
    let mut out = Vec::with_capacity(n as usize);
    for _ in 0..n {
        out.push(parse_cs(&mut c)?);
    }
    c.tag(b"CP:1>\0")?;
    Ok(out)
}

fn parse_cs(c: &mut Cur) -> Result<SegMeta> {
    c.tag(b"<1:CS\0")?;
    let records = c.u64()?;
    let _base_id = c.u64()?;
    let class = c.u32()?;
    let sub_class = c.u32()?;
    if class == 703066 {
        c.u64()?;
        c.u64()?;
        c.u64()?;
        c.u8()?;
    }
    let _first_run = c.u32()?;
    // <1:SS ... SS:1>
    c.tag(b"<1:SS\0")?;
    let _distinct = c.u64()?;
    let min_data_id = c.u32()?;
    let _max = c.u32()?;
    let _orig_min = c.u32()?;
    let _sort = c.i64()?;
    let _rows = c.u64()?;
    let has_nulls = c.u8()? != 0;
    let _runs = c.u64()?;
    let _others = c.u64()?;
    c.tag(b"SS:1>\0")?;
    let has_sub = c.u8()? != 0;
    let mut count_bit_packed = 0;
    if has_sub {
        c.tag(b"<1:CS\0")?;
        count_bit_packed = c.u64()?;
        let _sub_base = c.u64()?;
        let nested = c.u8()?;
        if nested != 0 {
            bail!("subsegmento aninhado inesperado");
        }
        c.tag(b"CS:1>\0")?;
    }
    c.tag(b"CS:1>\0")?;
    let bit_width = bit_width_of(class)
        .or(if class == 703066 { bit_width_of(sub_class) } else { None })
        .unwrap_or(0);
    Ok(SegMeta { records, min_data_id, has_nulls, count_bit_packed, bit_width })
}

// ---------------------------------------------------------------- .idf

struct IdfSegment<'a> {
    entries: Vec<(u32, u32)>,
    sub: &'a [u8],
}

fn parse_idf(b: &[u8]) -> Result<Vec<IdfSegment<'_>>> {
    let mut c = Cur::new(b);
    let mut segs = Vec::new();
    while !c.eof() {
        let n = c.u64()? as usize;
        let raw = c.bytes(n * 8)?;
        let entries = raw
            .chunks_exact(8)
            .map(|e| (u32::from_le_bytes(e[0..4].try_into().unwrap()), u32::from_le_bytes(e[4..8].try_into().unwrap())))
            .collect();
        let sn = c.u64()? as usize;
        let sub = c.bytes(sn * 8)?;
        segs.push(IdfSegment { entries, sub });
    }
    Ok(segs)
}

/// Decodifica todas as partições de uma coluna em ids de dados (i64), na ordem de armazenamento.
/// Devolve também se há nulos em cada posição (id == DATA_ID_NULL num segmento com nulos).
pub fn decode_ids(idf: &[u8], metas: &[SegMeta]) -> Result<Vec<i64>> {
    let segs = parse_idf(idf)?;
    let total: u64 = metas.iter().map(|m| m.records).sum();
    let mut out = Vec::with_capacity(total as usize);
    for (k, meta) in metas.iter().enumerate() {
        let seg = segs.get(k).ok_or_else(|| anyhow!("segmento {k} ausente no .idf"))?;
        let base = if meta.has_nulls { DATA_ID_NULL } else { meta.min_data_id as i64 };

        // Valores bit-packed do subsegmento.
        let mut packed: Vec<i64> = Vec::new();
        if meta.count_bit_packed > 0 && meta.bit_width > 0 {
            let words: Vec<u64> = seg.sub.chunks_exact(8).map(|w| u64::from_le_bytes(w.try_into().unwrap())).collect();
            if words.len() == 1 && words[0] == 0 {
                packed = vec![base; meta.count_bit_packed as usize];
            } else {
                let bw = meta.bit_width;
                let per = 64 / bw;
                let mask = if bw == 64 { u64::MAX } else { (1u64 << bw) - 1 };
                packed.reserve(words.len() * per as usize);
                for w in words {
                    for j in 0..per {
                        packed.push(((w >> (j * bw)) & mask) as i64 + base);
                    }
                }
            }
        }

        let cap = meta.records;
        let mut acc = 0u64;
        let mut packed_off = 0usize;
        for &(value, repeat) in &seg.entries {
            if cap > 0 && acc >= cap {
                break;
            }
            let mut count = repeat as u64;
            if cap > 0 && acc + count > cap {
                count = cap - acc;
            }
            acc += count;
            if value as u64 + packed_off as u64 == 0xFFFF_FFFF {
                let end = (packed_off + count as usize).min(packed.len());
                out.extend_from_slice(&packed[packed_off..end]);
                // Garante o tamanho mesmo se o subsegmento vier curto.
                for _ in end..packed_off + count as usize {
                    out.push(base);
                }
                packed_off += count as usize;
            } else {
                out.extend(std::iter::repeat_n(value as i64, count as usize));
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- dicionários

pub enum Dictionary {
    Strings(Vec<String>),
    Longs(Vec<i64>),
    Reals(Vec<f64>),
}

impl Dictionary {
    /// Posição no dicionário para um id de dados (None = nulo/desconhecido).
    pub fn index(&self, id: i64) -> Option<usize> {
        let len = match self {
            Dictionary::Strings(v) => v.len(),
            Dictionary::Longs(v) => v.len(),
            Dictionary::Reals(v) => v.len(),
        };
        let k = id - FIRST_DATA_ID;
        (k >= 0 && (k as usize) < len).then_some(k as usize)
    }
}

pub fn parse_dictionary(b: &[u8]) -> Result<Dictionary> {
    let mut c = Cur::new(b);
    let kind = c.i32()?;
    for _ in 0..6 {
        c.i32()?;
    }
    match kind {
        0 | 1 => {
            let n = c.u64()? as usize;
            let size = c.u32()?;
            if kind == 1 && size == 8 {
                let mut v = Vec::with_capacity(n);
                for _ in 0..n {
                    v.push(c.f64()?);
                }
                Ok(Dictionary::Reals(v))
            } else {
                let mut v = Vec::with_capacity(n);
                for _ in 0..n {
                    v.push(if size == 4 { c.i32()? as i64 } else { c.i64()? });
                }
                Ok(Dictionary::Longs(v))
            }
        }
        2 => parse_string_dictionary(&mut c),
        k => bail!("tipo de dicionário desconhecido: {k}"),
    }
}

enum Page<'a> {
    Plain(Vec<String>),
    Huffman { total_bits: u32, general: bool, charset: u8, encode: &'a [u8], buf: &'a [u8] },
}

fn parse_string_dictionary(c: &mut Cur) -> Result<Dictionary> {
    let _count = c.i64()?;
    let _compressed = c.u8()?;
    let _longest = c.i64()?;
    let page_count = c.i64()? as usize;
    let mut pages = Vec::with_capacity(page_count);
    for _ in 0..page_count {
        let _mask = c.u64()?;
        let _nulls = c.u8()?;
        let _start = c.u64()?;
        let _n = c.u64()?;
        let compressed = c.u8()? != 0;
        c.tag(&[0xDD, 0xCC, 0xBB, 0xAA])?;
        if compressed {
            let total_bits = c.u32()?;
            let charset_type = c.u32()?;
            let len = c.u64()? as usize;
            let charset = if charset_type == 703121 { c.u8()? } else { 0 };
            let _decode_bits = c.u32()?;
            let encode = c.bytes(128)?;
            let _buf_size = c.u64()?;
            let buf = c.bytes(len)?;
            pages.push(Page::Huffman { total_bits, general: charset_type == 703122, charset, encode, buf });
        } else {
            let _remaining = c.u64()?;
            let used = c.u64()? as usize;
            let alloc = c.u64()? as usize;
            let chars = c.bytes(used * 2)?;
            c.bytes(alloc.saturating_sub(used * 2))?;
            let units: Vec<u16> = chars.chunks_exact(2).map(|x| u16::from_le_bytes([x[0], x[1]])).collect();
            let text = String::from_utf16_lossy(&units);
            let mut parts: Vec<String> = text.split('\0').map(str::to_string).collect();
            parts.pop();
            pages.push(Page::Plain(parts));
        }
        c.tag(&[0xCD, 0xAB, 0xCD, 0xAB])?;
    }
    let n_handles = c.u64()? as usize;
    c.tag(&[8, 0, 0, 0])?;
    let raw = c.bytes(n_handles * 8)?;
    let mut by_page: Vec<Vec<u32>> = vec![Vec::new(); pages.len()];
    for h in raw.chunks_exact(8) {
        let off = u32::from_le_bytes(h[0..4].try_into().unwrap());
        let page = u32::from_le_bytes(h[4..8].try_into().unwrap()) as usize;
        if let Some(v) = by_page.get_mut(page) {
            v.push(off);
        }
    }

    let mut out = Vec::new();
    for (pid, page) in pages.into_iter().enumerate() {
        match page {
            Page::Plain(v) => out.extend(v),
            Page::Huffman { total_bits, general, charset, encode, buf } => {
                let offsets = &by_page[pid];
                if offsets.is_empty() {
                    continue;
                }
                out.extend(huffman_page(buf, encode, offsets, total_bits as u64, general, charset)?);
            }
        }
    }
    Ok(Dictionary::Strings(out))
}

const MAX_CODE: u32 = 15;

fn huffman_page(buf: &[u8], encode: &[u8], offsets: &[u32], total_bits: u64, general: bool, charset: u8) -> Result<Vec<String>> {
    let mut lengths = [0u8; 256];
    for i in 0..128 {
        lengths[2 * i] = encode[i] & 0x0f;
        lengths[2 * i + 1] = encode[i] >> 4;
    }
    let mut count = [0u32; 17];
    let mut max_len = 0;
    for &l in &lengths {
        if l > 0 {
            count[l as usize] += 1;
            max_len = max_len.max(l as u32);
        }
    }
    if max_len == 0 {
        return Ok(vec![String::new(); offsets.len()]);
    }
    if max_len > MAX_CODE {
        bail!("código Huffman inválido");
    }
    let mut next = [0u32; 17];
    let mut code = 0u32;
    for l in 1..=max_len as usize {
        code = (code + count[l - 1]) << 1;
        next[l] = code;
    }
    let mut table = vec![0u16; 1 << max_len];
    for s in 0..256usize {
        let l = lengths[s] as u32;
        if l == 0 {
            continue;
        }
        let c = next[l as usize];
        next[l as usize] += 1;
        let pad = max_len - l;
        let base = (c << pad) as usize;
        let entry = ((s as u16) << 8) | l as u16;
        let end = (base + (1usize << pad)).min(table.len());
        table[base..end].fill(entry);
    }

    // O fluxo de bits é gravado com bytes trocados aos pares.
    let mut sw = buf.to_vec();
    for p in sw.chunks_exact_mut(2) {
        p.swap(0, 1);
    }
    let load = |byte: usize| -> u64 {
        let mut tmp = [0u8; 8];
        if byte < sw.len() {
            let n = (sw.len() - byte).min(8);
            tmp[..n].copy_from_slice(&sw[byte..byte + n]);
        }
        u64::from_be_bytes(tmp)
    };
    let shift = 64 - max_len;
    let mask = (1u64 << max_len) - 1;
    let mut out = Vec::with_capacity(offsets.len());
    let mut bytes = Vec::new();
    for (i, &start) in offsets.iter().enumerate() {
        let end = if i + 1 == offsets.len() { total_bits } else { offsets[i + 1] as u64 };
        let mut bit = start as u64;
        bytes.clear();
        while bit < end {
            let w = load((bit >> 3) as usize);
            let idx = ((w >> (shift - (bit & 7) as u32)) & mask) as usize;
            let e = table[idx];
            let l = (e & 0xff) as u64;
            if l == 0 {
                bail!("fluxo Huffman corrompido");
            }
            bytes.push((e >> 8) as u8);
            bit += l;
        }
        let s = if general {
            let units: Vec<u16> = bytes.chunks_exact(2).map(|x| u16::from_le_bytes([x[0], x[1]])).collect();
            String::from_utf16_lossy(&units)
        } else if charset == 0 {
            bytes.iter().map(|&b| b as char).collect()
        } else {
            let units: Vec<u16> = bytes.iter().map(|&b| u16::from_le_bytes([b, charset])).collect();
            String::from_utf16_lossy(&units)
        };
        out.push(s);
    }
    Ok(out)
}
