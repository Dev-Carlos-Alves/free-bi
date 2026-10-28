//! Descompressão do stream `DataModel` (XPress9) e leitura do backup ABF do Analysis Services.

use crate::xml;
use anyhow::{anyhow, bail, Context, Result};
use std::collections::HashMap;
use std::os::raw::{c_int, c_longlong, c_uchar, c_void};

extern "C" {
    fn freebi_x9_new() -> *mut c_void;
    fn freebi_x9_free(d: *mut c_void);
    fn freebi_x9_decompress(d: *mut c_void, input: *mut c_uchar, in_len: c_int, out: *mut c_uchar, out_cap: c_int) -> c_longlong;
}

/// Decodificador XPress9 com janela de histórico própria.
struct Decoder(*mut c_void);

impl Decoder {
    fn new() -> Result<Self> {
        let d = unsafe { freebi_x9_new() };
        if d.is_null() {
            bail!("falha ao iniciar o decodificador XPress9");
        }
        Ok(Decoder(d))
    }
    fn decompress(&mut self, input: &[u8], out_len: usize, out: &mut Vec<u8>) -> Result<()> {
        let start = out.len();
        out.resize(start + out_len, 0);
        let mut inp = input.to_vec();
        let n = unsafe {
            freebi_x9_decompress(self.0, inp.as_mut_ptr(), inp.len() as c_int, out[start..].as_mut_ptr(), out_len as c_int)
        };
        if n < 0 || n as usize != out_len {
            bail!("bloco XPress9 corrompido (esperado {out_len} bytes, obtido {n})");
        }
        Ok(())
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { freebi_x9_free(self.0) }
    }
}

const SINGLE: &str = "This backup was created using XPress9 compression.";
const MULTI: &str = "This backup was created using multithreaded XPrs9.";

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    fn u32(&mut self) -> Result<u32> {
        let v = self.b.get(self.i..self.i + 4).ok_or_else(|| anyhow!("fim inesperado do DataModel"))?;
        self.i += 4;
        Ok(u32::from_le_bytes(v.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64> {
        let v = self.b.get(self.i..self.i + 8).ok_or_else(|| anyhow!("fim inesperado do DataModel"))?;
        self.i += 8;
        Ok(u64::from_le_bytes(v.try_into().unwrap()))
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        let v = self.b.get(self.i..self.i + n).ok_or_else(|| anyhow!("fim inesperado do DataModel"))?;
        self.i += n;
        Ok(v)
    }
}

/// Descompacta o stream `DataModel` de um .pbix e devolve o backup ABF bruto.
pub fn decompress_datamodel(raw: &[u8]) -> Result<Vec<u8>> {
    let sig = xml::decode_utf16le(&raw[..raw.len().min(102)]);
    let storage_sig = "STREAM_STORAGE_SIGNATURE_)!@#$%^&*(";
    if xml::decode_utf16le(&raw[..raw.len().min(72)]).contains(storage_sig) {
        return Ok(raw.to_vec());
    }
    let mut out = Vec::new();
    let mut r = Reader { b: raw, i: 102 };
    if sig.contains(SINGLE) {
        let mut dec = Decoder::new()?;
        while r.i < raw.len() {
            let ulen = r.u32()? as usize;
            let clen = r.u32()? as usize;
            let data = r.bytes(clen)?;
            dec.decompress(data, ulen, &mut out)?;
        }
    } else if sig.contains(MULTI) {
        let main_chunks = r.u64()?;
        let prefix_chunks = r.u64()?;
        let prefix_threads = r.u64()?;
        let main_threads = r.u64()?;
        let _chunk_size = r.u64()?;
        // Cada grupo de blocos é um stream XPress9 independente (um por thread no compressor).
        for (threads, chunks) in [(prefix_threads, prefix_chunks), (main_threads, main_chunks)] {
            for _ in 0..threads {
                let mut dec = Decoder::new()?;
                for _ in 0..chunks {
                    let ulen = r.u32()? as usize;
                    let clen = r.u32()? as usize;
                    let data = r.bytes(clen)?;
                    dec.decompress(data, ulen, &mut out)?;
                }
            }
        }
    } else {
        bail!("formato de compressão do DataModel desconhecido (talvez um relatório com conexão ao vivo, sem dados embutidos)");
    }
    Ok(out)
}

#[derive(Debug, Clone)]
struct FileRef {
    offset: usize,
    size: usize,
}

/// Backup ABF já descompactado, com índice dos arquivos internos.
pub struct Abf {
    data: Vec<u8>,
    files: HashMap<String, FileRef>,
    error_code: bool,
    pub apply_compression: bool,
}

fn decode_xml_bytes(b: &[u8]) -> String {
    if b.starts_with(&[0xFF, 0xFE]) || (b.len() > 1 && b[1] == 0) {
        xml::decode_utf16le(b)
    } else {
        String::from_utf8_lossy(b).to_string()
    }
}

impl Abf {
    pub fn parse(data: Vec<u8>) -> Result<Self> {
        let header_xml = xml::decode_utf16le(data.get(72..0x1000).context("ABF muito pequeno")?);
        let header = xml::parse(&header_xml).context("cabeçalho do ABF inválido")?;
        let off = header.num_of("m_cbOffsetHeader") as usize;
        let size = header.num_of("DataSize") as usize;
        let error_code = header.bool_of("ErrorCode");
        let apply_compression = header.bool_of("ApplyCompression");

        let vdir_xml = decode_xml_bytes(data.get(off..off + size).context("diretório virtual fora do arquivo")?);
        let vdir = xml::parse(&vdir_xml).context("diretório virtual inválido")?;
        let vfiles: Vec<(String, FileRef)> = vdir
            .children_named("BackupFile")
            .map(|e| {
                (
                    e.text_of("Path").unwrap_or_default().to_string(),
                    FileRef { offset: e.num_of("m_cbOffsetHeader") as usize, size: e.num_of("Size") as usize },
                )
            })
            .collect();
        let (_, log_ref) = vfiles.last().context("diretório virtual vazio")?.clone();
        let mut log_bytes = data.get(log_ref.offset..log_ref.offset + log_ref.size).context("log fora do arquivo")?;
        if error_code {
            log_bytes = &log_bytes[..log_bytes.len().saturating_sub(4)];
        }
        let log = xml::parse(&decode_xml_bytes(log_bytes)).context("log de backup inválido")?;
        let vmap: HashMap<&str, &FileRef> = vfiles.iter().map(|(p, r)| (p.as_str(), r)).collect();

        let groups: Vec<&xml::Element> = log.child("FileGroups").map(|g| g.children_named("FileGroup").collect()).unwrap_or_default();
        let persist_root = groups
            .get(1)
            .and_then(|g| g.text_of("PersistLocationPath"))
            .map(|p| format!("{p}\\"))
            .unwrap_or_default();
        let mut files = HashMap::new();
        for g in &groups {
            let Some(list) = g.child("FileList") else { continue };
            for bf in list.children_named("BackupFile") {
                let storage = bf.text_of("StoragePath").unwrap_or_default();
                if let Some(r) = vmap.get(storage) {
                    let path = bf.text_of("Path").unwrap_or_default();
                    let path = path.strip_prefix(persist_root.as_str()).unwrap_or(path);
                    let name = path.rsplit('\\').next().unwrap_or(path).to_string();
                    files.insert(name, (*r).clone());
                }
            }
        }
        Ok(Abf { data, files, error_code, apply_compression })
    }

    pub fn file(&self, name: &str) -> Result<&[u8]> {
        let r = self.files.get(name).ok_or_else(|| anyhow!("arquivo interno não encontrado: {name}"))?;
        let mut end = r.offset + r.size;
        if self.error_code {
            end -= 4;
        }
        if self.apply_compression {
            bail!("modelo com compressão XPress8 por arquivo (comum em Excel/Power Pivot) ainda não é suportado");
        }
        self.data.get(r.offset..end).ok_or_else(|| anyhow!("arquivo interno fora dos limites: {name}"))
    }
}
