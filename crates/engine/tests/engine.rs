use freebi_engine::model::*;
use freebi_engine::Engine;
use serde_json::json;

fn fixture(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn setup() -> Engine {
    let mut e = Engine::new();
    e.load_file(&fixture("vendas.csv"), None).unwrap();
    e.load_file(&fixture("produtos.csv"), None).unwrap();
    let rels = e.detect_relationships();
    assert_eq!(rels.len(), 1, "deve detectar vendas[produto_id] -> produtos[produto_id]");
    assert_eq!(rels[0].from_table, "vendas");
    e
}

fn measure(e: &mut Engine, name: &str, expr: &str) {
    e.handle("set_measure", &json!({ "measure": { "name": name, "table": "vendas", "expression": expr } })).unwrap();
}

#[test]
fn csv_brasileiro_com_virgula_decimal() {
    let e = setup();
    let t = e.table("vendas").unwrap();
    assert_eq!(t.df.height(), 5);
    let total = e.eval_measure("vendas", "SUM(vendas[valor])").unwrap();
    assert!((total.as_f64().unwrap() - 366.45).abs() < 1e-9);
}

#[test]
fn medidas_com_relacao_e_calculate() {
    let mut e = setup();
    measure(&mut e, "Receita", "SUM(vendas[valor])");
    measure(&mut e, "Papelaria", "CALCULATE([Receita], produtos[categoria] = \"Papelaria\")");
    measure(&mut e, "% Papelaria", "DIVIDE([Papelaria], [Receita])");
    measure(&mut e, "% do total", "DIVIDE([Receita], CALCULATE([Receita], ALL(produtos)))");
    let r = e
        .query(&VisualQuery {
            group_by: vec![FieldRef { table: "produtos".into(), column: "categoria".into(), date_part: None }],
            values: vec![
                ValueSpec::Measure { name: "Receita".into() },
                ValueSpec::Measure { name: "% Papelaria".into() },
                ValueSpec::Measure { name: "% do total".into() },
            ],
            sort_by: Some(1),
            sort_desc: true,
            totals: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(r.rows[0][0], json!("Eletrônicos"));
    assert!((r.rows[0][1].as_f64().unwrap() - 299.7).abs() < 1e-9);
    assert_eq!(r.rows[0][2].as_f64().unwrap(), 0.0);
    assert!((r.rows[1][3].as_f64().unwrap() - 66.75 / 366.45).abs() < 1e-9);
    let total = r.total.unwrap();
    assert!((total[1].as_f64().unwrap() - 366.45).abs() < 1e-9);
}

#[test]
fn filtros_hierarquia_de_data_e_colunas_calculadas() {
    let mut e = setup();
    e.handle("add_calc_column", &json!({ "table": "vendas", "name": "unitario", "expression": "DIVIDE(vendas[valor], vendas[quantidade])" })).unwrap();
    e.handle("add_calc_column", &json!({ "table": "vendas", "name": "cat", "expression": "RELATED(produtos[categoria])" })).unwrap();
    let r = e
        .query(&VisualQuery {
            group_by: vec![FieldRef { table: "vendas".into(), column: "data".into(), date_part: Some(DatePart::Month) }],
            values: vec![ValueSpec::Column { field: FieldRef { table: "vendas".into(), column: "quantidade".into(), date_part: None }, agg: Agg::Sum }],
            filters: vec![Filter {
                field: FieldRef { table: "vendas".into(), column: "cat".into(), date_part: None },
                kind: FilterKind::In { values: vec![json!("Papelaria")] },
            }],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(r.rows, vec![vec![json!(1), json!(2)], vec![json!(2), json!(5)], vec![json!(3), json!(3)]]);
    let unit = e.eval_measure("vendas", "MAXX(vendas, vendas[unitario])").unwrap();
    assert!((unit.as_f64().unwrap() - 99.9).abs() < 1e-9);
}

#[test]
fn etapas_e_projeto() {
    let mut e = setup();
    e.handle("add_step", &json!({ "table": "vendas", "step": { "op": "filter_rows", "column": "quantidade", "cmp": "ge", "value": 2 } })).unwrap();
    e.handle("add_step", &json!({ "table": "vendas", "step": { "op": "rename_column", "from": "valor", "to": "valor_total" } })).unwrap();
    assert_eq!(e.table("vendas").unwrap().df.height(), 4);
    let dir = std::env::temp_dir().join(format!("freebi-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("p.freebi");
    e.save_project(path.to_str().unwrap()).unwrap();
    let e2 = Engine::load_project(path.to_str().unwrap()).unwrap();
    assert_eq!(e2.table("vendas").unwrap().df.height(), 4);
    assert!(e2.table("vendas").unwrap().df.schema().contains("valor_total"));
    assert_eq!(e2.relationships.len(), 1);
}

#[test]
fn relatorio_guarda_campos_novos_e_grava_texto() {
    // A interface evolui o formato do relatório (estilo, camadas, imagem, tema); o motor deve guardar tudo sem perder campos.
    let mut e = setup();
    let report = json!({
        "theme": { "name": "Teste", "colors": ["#123456"] },
        "wallpaper": "#EEEEEE",
        "pages": [{ "id": "p1", "name": "Página 1", "width": 1280, "height": 720, "background": "#FAFAFA",
            "visuals": [{ "id": "v1", "type": "image", "x": 0, "y": 0, "w": 10, "h": 10, "fields": {}, "hidden": true,
                "style": { "background": "#FFFFFF", "radius": 8 }, "options": { "src": "data:image/png;base64,AA==" } }] }]
    });
    e.handle("report_set", &json!({ "report": report })).unwrap();
    let dir = std::env::temp_dir().join(format!("freebi-test-rel-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("r.freebi");
    e.save_project(path.to_str().unwrap()).unwrap();
    let mut e2 = Engine::load_project(path.to_str().unwrap()).unwrap();
    assert_eq!(e2.handle("report_get", &json!({})).unwrap(), report);

    let tema = dir.join("tema.json");
    e2.handle("write_text", &json!({ "path": tema.to_str().unwrap(), "text": "{\"name\":\"Tema\"}" })).unwrap();
    assert_eq!(std::fs::read_to_string(&tema).unwrap(), "{\"name\":\"Tema\"}");
}
