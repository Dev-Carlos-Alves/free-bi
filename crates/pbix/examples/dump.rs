fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("uso: dump <arquivo.pbix>");
    let t = std::time::Instant::now();
    let p = freebi_pbix::open(&path)?;
    println!("lido em {:?}", t.elapsed());
    for t in &p.tables {
        let n = t.columns.first().map(|c| c.values.len()).unwrap_or(0);
        println!("== {} ({} linhas)", t.name, n);
        for c in &t.columns {
            let sample = match &c.values {
                freebi_pbix::ColumnValues::Int(v) => format!("{:?}", &v[..v.len().min(3)]),
                freebi_pbix::ColumnValues::Float(v) => format!("{:?}", &v[..v.len().min(3)]),
                freebi_pbix::ColumnValues::DateTime(v) => format!("datas {:?}", &v[..v.len().min(3)]),
                freebi_pbix::ColumnValues::Text(v) => format!("{:?}", &v[..v.len().min(3)]),
                freebi_pbix::ColumnValues::Bool(v) => format!("{:?}", &v[..v.len().min(3)]),
            };
            println!("   {}: {}", c.name, sample);
        }
    }
    for m in &p.measures { println!("medida {}[{}] = {}", m.table, m.name, m.expression); }
    for r in &p.relationships { println!("rel {}[{}] -> {}[{}]", r.from_table, r.from_column, r.to_table, r.to_column); }
    for pg in &p.report.pages { println!("página {} ({} visuais)", pg.display_name, pg.visuals.len()); }
    for w in &p.warnings { println!("AVISO {w}"); }
    if std::env::var("CK").is_ok() { checksums(&p); }
    Ok(())
}

#[allow(dead_code)]
pub fn checksums(p: &freebi_pbix::Pbix) {
    use freebi_pbix::ColumnValues::*;
    for t in &p.tables {
        for c in &t.columns {
            let (n, s): (usize, f64) = match &c.values {
                Int(v) => (v.iter().flatten().count(), v.iter().flatten().map(|x| *x as f64).sum()),
                Float(v) | DateTime(v) => (v.iter().flatten().count(), v.iter().flatten().sum()),
                Text(v) => (v.iter().flatten().count(), v.iter().flatten().map(|x| x.chars().count() as f64).sum()),
                Bool(v) => (v.iter().flatten().count(), v.iter().flatten().filter(|b| **b).count() as f64),
            };
            println!("CK {}|{}|{}|{:.4}", t.name, c.name, n, s);
        }
    }
}
