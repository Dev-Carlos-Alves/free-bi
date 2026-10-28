//! Parser XML mínimo (elementos e texto), suficiente para os logs de backup do ABF.

#[derive(Debug, Default, Clone)]
pub struct Element {
    pub name: String,
    pub text: String,
    pub children: Vec<Element>,
}

impl Element {
    pub fn child(&self, name: &str) -> Option<&Element> {
        self.children.iter().find(|c| c.name == name)
    }
    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }
    pub fn text_of(&self, name: &str) -> Option<&str> {
        self.child(name).map(|c| c.text.as_str())
    }
    pub fn num_of(&self, name: &str) -> u64 {
        self.text_of(name).and_then(|t| t.trim().parse().ok()).unwrap_or(0)
    }
    pub fn bool_of(&self, name: &str) -> bool {
        self.text_of(name).is_some_and(|t| t.trim() == "true")
    }
}

pub fn parse(src: &str) -> Option<Element> {
    let mut p = P { s: src.as_bytes(), i: 0 };
    p.skip_misc();
    p.element()
}

struct P<'a> {
    s: &'a [u8],
    i: usize,
}

impl P<'_> {
    fn starts(&self, pat: &str) -> bool {
        self.s[self.i..].starts_with(pat.as_bytes())
    }
    fn skip_until(&mut self, pat: &str) {
        while self.i < self.s.len() && !self.starts(pat) {
            self.i += 1;
        }
        self.i = (self.i + pat.len()).min(self.s.len());
    }
    fn skip_misc(&mut self) {
        loop {
            while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
                self.i += 1;
            }
            if self.starts("<?") {
                self.skip_until("?>");
            } else if self.starts("<!--") {
                self.skip_until("-->");
            } else if self.starts("\u{feff}") {
                self.i += 3;
            } else {
                return;
            }
        }
    }
    fn element(&mut self) -> Option<Element> {
        if !self.starts("<") {
            return None;
        }
        self.i += 1;
        let start = self.i;
        while self.i < self.s.len() && !matches!(self.s[self.i], b' ' | b'>' | b'/' | b'\t' | b'\r' | b'\n') {
            self.i += 1;
        }
        let full = String::from_utf8_lossy(&self.s[start..self.i]).to_string();
        // Remove prefixo de namespace (ex.: "ddl:Name").
        let name = full.rsplit(':').next().unwrap_or(&full).to_string();
        // Pula atributos.
        let mut quote: Option<u8> = None;
        while self.i < self.s.len() {
            let c = self.s[self.i];
            match quote {
                Some(q) if c == q => quote = None,
                Some(_) => {}
                None if c == b'"' || c == b'\'' => quote = Some(c),
                None if c == b'>' || c == b'/' => break,
                None => {}
            }
            self.i += 1;
        }
        let mut el = Element { name, ..Default::default() };
        if self.starts("/>") {
            self.i += 2;
            return Some(el);
        }
        self.i += 1; // '>'
        loop {
            if self.i >= self.s.len() {
                return Some(el);
            }
            if self.starts("</") {
                self.skip_until(">");
                el.text = unescape(el.text.trim());
                return Some(el);
            }
            if self.starts("<!--") {
                self.skip_until("-->");
                continue;
            }
            if self.starts("<![CDATA[") {
                let st = self.i + 9;
                self.skip_until("]]>");
                el.text.push_str(&String::from_utf8_lossy(&self.s[st..self.i.saturating_sub(3)]));
                continue;
            }
            if self.starts("<") {
                if let Some(c) = self.element() {
                    el.children.push(c);
                }
                continue;
            }
            let st = self.i;
            while self.i < self.s.len() && self.s[self.i] != b'<' {
                self.i += 1;
            }
            el.text.push_str(&String::from_utf8_lossy(&self.s[st..self.i]));
        }
    }
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

pub fn decode_utf16le(b: &[u8]) -> String {
    let b = b.strip_prefix(&[0xFF, 0xFE]).unwrap_or(b);
    let units: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units).trim_end_matches('\0').to_string()
}
