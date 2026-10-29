//! Importa um .pbix e executa as consultas de cartões e gráficos (verificação manual).
use freebi_engine::model::*;
use freebi_engine::Engine;

fn m(name: &str) -> ValueSpec { ValueSpec::Measure { name: name.into() } }
fn f(t: &str, c: &str) -> FieldRef { FieldRef { table: t.into(), column: c.into(), date_part: None } }

fn main() -> anyhow::Result<()> {
    let path = std::env::args().nth(1).expect("uso: report <arquivo.pbix>");
    let mut e = Engine::new();
    let t = std::time::Instant::now();
    let s = e.import_pbix(&path)?;
    println!("import {:?}: {}", t.elapsed(), serde_json::to_string(&s)?);
    let cards = ["Total de Jogos", "% Gratuitos", "Preço Mediano (Pagos)", "Aprovação Mediana", "Taxa de Sucesso",
        "Jogos com 100 mil+ Donos", "Taxa de Aprovação Geral", "Pico de Jogadores (CCU)", "Mediana de CCU",
        "Total de Donos Estimados", "Tempo Médio de Jogo (h)", "Média de Idiomas"];
    let t = std::time::Instant::now();
    let r = e.query(&VisualQuery { values: cards.iter().map(|c| m(c)).collect(), ..Default::default() })?;
    println!("cards {:?}", t.elapsed());
    for (c, v) in cards.iter().zip(r.rows[0].iter()) { println!("CARD {c} = {v}"); }
    let t = std::time::Instant::now();
    let r = e.query(&VisualQuery { group_by: vec![f("dim_genero", "genero_principal")], values: vec![m("Total de Jogos"), m("Taxa de Sucesso")], sort_by: Some(1), sort_desc: true, limit: Some(5), ..Default::default() })?;
    println!("genero {:?} {:?}", t.elapsed(), r.rows);
    let r = e.query(&VisualQuery { group_by: vec![f("dim_genero", "genero_principal")], values: vec![m("Total de Jogos")],
        filters: vec![Filter { field: f("dim_plataforma", "descricao_plataforma"), kind: FilterKind::In { values: vec!["Windows + Mac + Linux".into()] } }],
        sort_by: Some(1), sort_desc: true, limit: Some(3), totals: true, ..Default::default() })?;
    println!("genero filtrado {:?} total {:?}", r.rows, r.total);
    let r = e.query(&VisualQuery { group_by: vec![f("dim_jogo", "nome_jogo"), f("dim_genero", "genero_principal")], values: vec![m("Pico de Jogadores (CCU)"), m("Taxa de Aprovação Geral")], sort_by: Some(2), sort_desc: true, limit: Some(3), ..Default::default() })?;
    println!("ranking {:?} (de {})", r.rows, r.row_count);
    let r = e.query(&VisualQuery { group_by: vec![f("dim_tempo", "data_lancamento")].into_iter().map(|mut x| { x.date_part = Some(DatePart::Year); x }).collect(), values: vec![m("Total de Jogos")], limit: Some(3), ..Default::default() })?;
    println!("por ano (date_part) {:?}", r.rows);
    let r = e.query(&VisualQuery { group_by: vec![f("dim_plataforma", "descricao_plataforma")], ..Default::default() })?;
    println!("slicer {:?}", r.rows);
    let tmp = std::env::temp_dir().join("teste.freebi");
    let tmp = tmp.to_str().unwrap();
    e.save_project(tmp)?;
    let e2 = Engine::load_project(tmp)?;
    let r = e2.query(&VisualQuery { values: vec![m("Total de Jogos")], ..Default::default() })?;
    println!("após salvar/abrir: {:?}", r.rows);
    Ok(())
}
