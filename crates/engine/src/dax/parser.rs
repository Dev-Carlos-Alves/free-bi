//! Analisador léxico e sintático de um subconjunto de DAX.

use anyhow::{bail, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Num(f64),
    Str(String),
    Bool(bool),
    /// `Tabela[Coluna]` ou `[Nome]` (coluna da tabela atual ou medida).
    Ref { table: Option<String>, name: String },
    /// Nome de tabela usado como argumento (`'Vendas'` ou `Vendas`).
    Table(String),
    Call { name: String, args: Vec<Ast> },
    Bin { op: BinOp, l: Box<Ast>, r: Box<Ast> },
    Neg(Box<Ast>),
    Not(Box<Ast>),
    In { e: Box<Ast>, list: Vec<Ast> },
    /// `VAR a = ... RETURN expr`
    Let { vars: Vec<(String, Ast)>, body: Box<Ast> },
    Var(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Concat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Ident(String),
    Quoted(String),
    Bracket(String),
    Op(&'static str),
    LParen,
    RParen,
    LBrace,
    RBrace,
    Comma,
    Eof,
}

fn lex(src: &str) -> Result<Vec<Tok>> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        // Comentários: -- , // e /* */
        if (c == '-' && chars.get(i + 1) == Some(&'-')) || (c == '/' && chars.get(i + 1) == Some(&'/')) {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                i += 1;
                if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
                    i += 1;
                }
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            let s: String = chars[start..i].iter().collect();
            out.push(Tok::Num(s.parse().map_err(|_| anyhow::anyhow!("número inválido: {s}"))?));
            continue;
        }
        match c {
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match chars.get(i) {
                        None => bail!("texto sem aspas de fechamento"),
                        Some('"') if chars.get(i + 1) == Some(&'"') => {
                            s.push('"');
                            i += 2;
                        }
                        Some('"') => {
                            i += 1;
                            break;
                        }
                        Some(ch) => {
                            s.push(*ch);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::Str(s));
            }
            '\'' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match chars.get(i) {
                        None => bail!("nome de tabela sem aspas de fechamento"),
                        Some('\'') if chars.get(i + 1) == Some(&'\'') => {
                            s.push('\'');
                            i += 2;
                        }
                        Some('\'') => {
                            i += 1;
                            break;
                        }
                        Some(ch) => {
                            s.push(*ch);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::Quoted(s));
            }
            '[' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match chars.get(i) {
                        None => bail!("falta ']'"),
                        Some(']') if chars.get(i + 1) == Some(&']') => {
                            s.push(']');
                            i += 2;
                        }
                        Some(']') => {
                            i += 1;
                            break;
                        }
                        Some(ch) => {
                            s.push(*ch);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::Bracket(s));
            }
            '(' => {
                out.push(Tok::LParen);
                i += 1;
            }
            ')' => {
                out.push(Tok::RParen);
                i += 1;
            }
            '{' => {
                out.push(Tok::LBrace);
                i += 1;
            }
            '}' => {
                out.push(Tok::RBrace);
                i += 1;
            }
            ',' | ';' => {
                out.push(Tok::Comma);
                i += 1;
            }
            _ => {
                let two: String = chars[i..(i + 2).min(chars.len())].iter().collect();
                let op2 = ["<=", ">=", "<>", "&&", "||", "=="].iter().find(|o| **o == two);
                if let Some(op) = op2 {
                    out.push(Tok::Op(op));
                    i += 2;
                    continue;
                }
                let op1 = ["+", "-", "*", "/", "^", "&", "=", "<", ">"].iter().find(|o| o.starts_with(c));
                if let Some(op) = op1 {
                    out.push(Tok::Op(op));
                    i += 1;
                    continue;
                }
                if c.is_alphanumeric() || c == '_' {
                    let start = i;
                    while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.') {
                        i += 1;
                    }
                    out.push(Tok::Ident(chars[start..i].iter().collect()));
                    continue;
                }
                bail!("caractere inesperado: '{c}'");
            }
        }
    }
    out.push(Tok::Eof);
    Ok(out)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

pub fn parse(src: &str) -> Result<Ast> {
    let mut p = Parser { toks: lex(src)?, pos: 0 };
    let ast = p.expr()?;
    if p.peek() != &Tok::Eof {
        bail!("sobrou texto depois da expressão: {:?}", p.peek());
    }
    Ok(ast)
}

impl Parser {
    fn peek(&self) -> &Tok {
        &self.toks[self.pos]
    }
    fn next(&mut self) -> Tok {
        let t = self.toks[self.pos].clone();
        if self.pos < self.toks.len() - 1 {
            self.pos += 1;
        }
        t
    }
    fn eat(&mut self, t: &Tok) -> bool {
        if self.peek() == t {
            self.next();
            true
        } else {
            false
        }
    }
    fn expect(&mut self, t: Tok, what: &str) -> Result<()> {
        if !self.eat(&t) {
            bail!("esperava {what}, encontrei {:?}", self.peek());
        }
        Ok(())
    }
    fn is_kw(&self, kw: &str) -> bool {
        matches!(self.peek(), Tok::Ident(s) if s.eq_ignore_ascii_case(kw))
    }

    fn expr(&mut self) -> Result<Ast> {
        if self.is_kw("VAR") {
            let mut vars = Vec::new();
            while self.is_kw("VAR") {
                self.next();
                let name = match self.next() {
                    Tok::Ident(n) => n,
                    t => bail!("nome de variável inválido: {t:?}"),
                };
                self.expect(Tok::Op("="), "'='")?;
                let e = self.expr()?;
                vars.push((name, e));
            }
            if !self.is_kw("RETURN") {
                bail!("esperava RETURN");
            }
            self.next();
            let body = self.expr()?;
            return Ok(Ast::Let { vars, body: Box::new(body) });
        }
        self.or()
    }

    fn or(&mut self) -> Result<Ast> {
        let mut l = self.and()?;
        while self.eat(&Tok::Op("||")) {
            let r = self.and()?;
            l = Ast::Bin { op: BinOp::Or, l: Box::new(l), r: Box::new(r) };
        }
        Ok(l)
    }
    fn and(&mut self) -> Result<Ast> {
        let mut l = self.cmp()?;
        while self.eat(&Tok::Op("&&")) {
            let r = self.cmp()?;
            l = Ast::Bin { op: BinOp::And, l: Box::new(l), r: Box::new(r) };
        }
        Ok(l)
    }
    fn cmp(&mut self) -> Result<Ast> {
        let l = self.concat()?;
        if self.is_kw("IN") {
            self.next();
            self.expect(Tok::LBrace, "'{'")?;
            let mut list = Vec::new();
            if !self.eat(&Tok::RBrace) {
                loop {
                    list.push(self.concat()?);
                    if self.eat(&Tok::RBrace) {
                        break;
                    }
                    self.expect(Tok::Comma, "','")?;
                }
            }
            return Ok(Ast::In { e: Box::new(l), list });
        }
        let op = match self.peek() {
            Tok::Op("=") | Tok::Op("==") => BinOp::Eq,
            Tok::Op("<>") => BinOp::Ne,
            Tok::Op("<") => BinOp::Lt,
            Tok::Op("<=") => BinOp::Le,
            Tok::Op(">") => BinOp::Gt,
            Tok::Op(">=") => BinOp::Ge,
            _ => return Ok(l),
        };
        self.next();
        let r = self.concat()?;
        Ok(Ast::Bin { op, l: Box::new(l), r: Box::new(r) })
    }
    fn concat(&mut self) -> Result<Ast> {
        let mut l = self.add()?;
        while self.eat(&Tok::Op("&")) {
            let r = self.add()?;
            l = Ast::Bin { op: BinOp::Concat, l: Box::new(l), r: Box::new(r) };
        }
        Ok(l)
    }
    fn add(&mut self) -> Result<Ast> {
        let mut l = self.mul()?;
        loop {
            let op = match self.peek() {
                Tok::Op("+") => BinOp::Add,
                Tok::Op("-") => BinOp::Sub,
                _ => return Ok(l),
            };
            self.next();
            let r = self.mul()?;
            l = Ast::Bin { op, l: Box::new(l), r: Box::new(r) };
        }
    }
    fn mul(&mut self) -> Result<Ast> {
        let mut l = self.pow()?;
        loop {
            let op = match self.peek() {
                Tok::Op("*") => BinOp::Mul,
                Tok::Op("/") => BinOp::Div,
                _ => return Ok(l),
            };
            self.next();
            let r = self.pow()?;
            l = Ast::Bin { op, l: Box::new(l), r: Box::new(r) };
        }
    }
    fn pow(&mut self) -> Result<Ast> {
        let l = self.unary()?;
        if self.eat(&Tok::Op("^")) {
            let r = self.pow()?;
            return Ok(Ast::Bin { op: BinOp::Pow, l: Box::new(l), r: Box::new(r) });
        }
        Ok(l)
    }
    fn unary(&mut self) -> Result<Ast> {
        if self.eat(&Tok::Op("-")) {
            return Ok(Ast::Neg(Box::new(self.unary()?)));
        }
        if self.eat(&Tok::Op("+")) {
            return self.unary();
        }
        if self.is_kw("NOT") && self.toks.get(self.pos + 1) != Some(&Tok::LParen) {
            self.next();
            return Ok(Ast::Not(Box::new(self.unary()?)));
        }
        self.primary()
    }
    fn primary(&mut self) -> Result<Ast> {
        match self.next() {
            Tok::Num(n) => Ok(Ast::Num(n)),
            Tok::Str(s) => Ok(Ast::Str(s)),
            Tok::LParen => {
                let e = self.expr()?;
                self.expect(Tok::RParen, "')'")?;
                Ok(e)
            }
            Tok::Bracket(name) => Ok(Ast::Ref { table: None, name }),
            Tok::Quoted(t) => {
                if let Tok::Bracket(_) = self.peek() {
                    let Tok::Bracket(name) = self.next() else { unreachable!() };
                    Ok(Ast::Ref { table: Some(t), name })
                } else {
                    Ok(Ast::Table(t))
                }
            }
            Tok::Ident(id) => {
                if self.eat(&Tok::LParen) {
                    let mut args = Vec::new();
                    if !self.eat(&Tok::RParen) {
                        loop {
                            args.push(self.expr()?);
                            if self.eat(&Tok::RParen) {
                                break;
                            }
                            self.expect(Tok::Comma, "',' ou ')'")?;
                        }
                    }
                    let name = id.to_uppercase();
                    return Ok(match (name.as_str(), args.len()) {
                        ("TRUE", 0) => Ast::Bool(true),
                        ("FALSE", 0) => Ast::Bool(false),
                        _ => Ast::Call { name, args },
                    });
                }
                if let Tok::Bracket(_) = self.peek() {
                    let Tok::Bracket(name) = self.next() else { unreachable!() };
                    return Ok(Ast::Ref { table: Some(id), name });
                }
                match id.to_uppercase().as_str() {
                    "TRUE" => Ok(Ast::Bool(true)),
                    "FALSE" => Ok(Ast::Bool(false)),
                    _ => Ok(Ast::Var(id)),
                }
            }
            t => bail!("token inesperado: {t:?}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_measures() {
        for src in [
            "SUM(Vendas[Valor])",
            "DIVIDE(SUM('Vendas'[Lucro]), SUM(Vendas[Receita]), 0)",
            "CALCULATE([Total], Produtos[Categoria] = \"Bebidas\", Vendas[Qtd] > 10)",
            "SUMX(Vendas, Vendas[Qtd] * Vendas[Preço Unitário])",
            "VAR t = [Total] RETURN IF(t > 1000, \"Alto\", \"Baixo\")",
            "CALCULATE(SUM(V[x]); V[c] IN {\"a\", \"b\"})",
            "-- comentário\n[A] + [B] * 2 ^ 2",
        ] {
            parse(src).unwrap_or_else(|e| panic!("{src}: {e}"));
        }
    }

    #[test]
    fn precedence() {
        let a = parse("1 + 2 * 3").unwrap();
        assert!(matches!(a, Ast::Bin { op: BinOp::Add, .. }));
    }
}
