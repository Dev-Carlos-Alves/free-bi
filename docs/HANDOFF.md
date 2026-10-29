# HANDOFF — continuação da conversa que criou o Free BI

> Para colar na nova sessão local: *"Leia CLAUDE.md e docs/HANDOFF.md e continue o projeto de onde paramos."*

## 1. O pedido original (palavras do usuário, resumidas)
- O usuário fez um trabalho de faculdade no **Power BI Desktop** em casa (Windows). Na aula usa **Fedora 44** e não consegue abrir o `.pbix`.
- Pediu uma alternativa ao Power BI **em Rust** (pela velocidade com dados), **instalável e completa**, ligada ao repositório pessoal `Dev-Carlos-Alves/free-bi`, com o tempo de trabalho que for preciso.
- Pediu para usar o repositório **REA** (`https://github.com/morluto/rea`, MCP de engenharia reversa) como apoio.
- Arquivo real fornecido: **`BI_Steam_AVD.pbix`** (projeto AVD da Faculdade Nova Roma, Data Mart de jogos da Steam). Ele não está no repositório. O usuário tem o arquivo no PC.
- Exigência explícita: **compatível com Fedora Linux e Windows**.
- O usuário ofereceu deixar o Claude **abrir o Power BI no PC dele** para comparar design e comportamento. Isso ainda não foi feito, porque a sessão anterior rodava na nuvem.

## 2. Decisões e discussões importantes
- **Engenharia reversa:** o usuário afirmou que ela é legal, e de fato é para interoperabilidade (Lei 9.609/98, art. 6º). A conclusão técnica foi não usar o REA para desmontar o binário do Power BI: o formato `.pbix` já está documentado publicamente ([MS-XLDM]) e o projeto open-source PBIXRay (MIT) já o decodifica. O leitor foi portado para Rust a partir dessas fontes. O REA continua disponível se for preciso investigar algo específico do Power BI Desktop, como o comportamento de visuais ou o formato de tema.
- **Sinceridade sobre o escopo:** um "Power BI completo" não é realista. O objetivo passou a ser um BI desktop funcional que abre o `.pbix` do usuário e permite criar e editar relatórios. As limitações estão no README.
- **Atalho imediato contado ao usuário:** o `.pbix` também abre em app.powerbi.com pelo navegador do Fedora.
- **Stack:** Rust (Polars 0.55) + Tauri 2 + React 19 + ECharts 6. O motor fica num crate separado e é testável sem interface.
- **Git:** o push pela sessão na nuvem falhou porque o proxy da sessão só tinha acesso à conta da empresa (Prottus). O usuário passou um token pessoal pelo chat. **Ele não foi salvo em lugar nenhum e deve ser revogado.** Regras de git no CLAUDE.md.

## 3. Estado atual (o que já funciona e foi verificado)
### Leitor `.pbix` (`crates/pbix`)
- Descompressão XPress9 (stream único e multithread) → ABF → índice de arquivos internos.
- `metadata.sqlitedb` (via rusqlite com SQLite embutido): tabelas, colunas, tipos, BaseId/Magnitude, medidas (com FormatString e DisplayFolder), colunas calculadas, relações, partições M, SortByColumn.
- VertiPaq: `.idfmeta` (tags `<1:CP`, `<1:CS`, `<1:SS`), `.idf` (RLE + bit-packing híbrido), dicionários de números e de texto (páginas sem compressão em UTF-16 e páginas Huffman com charset de byte único ou geral).
- Layout: PBIR (`Report/definition/pages/*/visuals/*/visual.json`) completo. O legado (`Report/Layout`, UTF-16) é lido em modo de melhor esforço. Tema em `RegisteredResources/*.json`.
- **Validação:** as 48 colunas do `BI_Steam_AVD.pbix` são idênticas às do pbixray (contagem de não nulos + soma ou comprimento): `tools/pbix_checksums.py` × exemplo `dump`.

### Motor (`crates/engine`)
- Carga: CSV (detecta `;`/`,`/tab/`|`, vírgula decimal, UTF-8/Windows-1252), Excel/ODS (calamine, uma tabela por planilha), Parquet, JSON/NDJSON.
- Etapas: remover/manter/renomear coluna, mudar tipo (texto com vírgula decimal → número), filtrar, substituir, preencher vazios, remover vazios, remover duplicatas, aparar, maiúsculas/minúsculas, dividir coluna, ordenar, manter primeiras linhas.
- DAX: parser próprio (`dax/parser.rs`) e compilação para Polars (`dax/compile.rs`) em contexto de agregação (medidas) e de linha (colunas calculadas, iteradores X, filtros de CALCULATE). Funções suportadas: lista na UI do editor de medidas, em `src/components/dialogs.tsx`, constante `FUNCS`.
- Consultas: escolhe a tabela base que alcança todas as tabelas usadas por relações N→1, faz left join, aplica filtros, faz group by e ordena. Também oculta grupos vazios, calcula a linha de total e trata hierarquia de datas (ano, trimestre, mês, dia) e "classificar por coluna".
- `ALL`/`REMOVEFILTERS` em `CALCULATE`: calculados fora do grupo (com os filtros da página mantidos, comportamento de ALLSELECTED).
- Projeto `.freebi`: zip com `project.json` + `data/N.parquet` (dados brutos; etapas e colunas calculadas são reaplicadas ao abrir).
- **Validação:** os 12 cartões do relatório do usuário batem exatamente com um cálculo independente em pandas (`tools/verify_measures.py`). Exemplo: Total de Jogos 125.855; % Gratuitos 21,18%; Preço Mediano (Pagos) 3,59; Aprovação Mediana 81,25%; Taxa de Sucesso 7,01%. A importação leva cerca de 0,43 s e os 12 cartões, cerca de 7 ms (release).
- Testes: `crates/engine/tests/engine.rs` cobre CSV brasileiro, CALCULATE/ALL/DIVIDE, filtros, hierarquia de datas, RELATED, etapas e salvar/abrir. Foram escritos mas **ainda não rodaram** (`cargo test`), porque a sessão acabou antes. Rode primeiro na sessão local.

### Interface (`src/`)
- Faixa de opções: Novo, Abrir, Salvar, Salvar como, Obter dados, Importar .pbix, Atualizar, Nova medida, Nova coluna, Desfazer/Refazer.
- Relatório: canvas 1280×720 com escala; visuais arrastáveis e redimensionáveis (grade de 8 px); duplicar, excluir e exportar CSV; abas de página (duplo clique renomeia, botão direito exclui); filtro cruzado ao clicar; tela inicial com atalhos.
- Painéis: Filtros (visual, página, todas as páginas; básico, excluir e avançado; recolhível), Visualizações (18 tipos, poços de campos com arrastar e soltar, agregação, renomear, classificação, aba Formatar) e Dados (tabelas, medidas, colunas, hierarquia de datas; clique adiciona à visual selecionada).
- Visão Dados: grade paginada com rolagem infinita, etapas aplicadas, tipo da coluna, classificar por coluna, estatísticas da coluna.
- Visão Modelo: cartões arrastáveis, linhas de relação (1/*), criar, detectar, ativar/desativar, excluir.
- **Validação:** teste Playwright (`tools/ui_test.cjs`) importa o `.pbix` pelo modo navegador e tira prints das 4 páginas. As 4 páginas renderizam e não houve erros no console.

### Empacotamento
- `src-tauri/tauri.conf.json`: alvos deb, rpm, appimage, msi, nsis e dmg; associação de arquivo `.freebi`; ícones em `src-tauri/icons`.
- `.github/workflows/build.yml`: testes + instaladores no Ubuntu 22.04 (glibc antiga, roda no Fedora 44), Windows e macOS. Release automática em tags `v*`.
- **O instalador ainda não foi testado num Fedora ou Windows real.** O build local do `.rpm` foi iniciado na nuvem e o resultado não foi confirmado.

## 3.1 Sessão local no Windows (29/10/2026)
- **Ambiente:** Rust 1.99.1 (MSVC) + VS Build Tools 2022 (C++) instalados. `cargo test -p freebi-engine -p freebi-pbix` passa (7 testes no motor; o leitor `.pbix` ainda não tem testes automatizados). `npx tauri dev` funciona.
- **Conferência com o Power BI:** a página "Ranking de Jogos" bate linha a linha com o Power BI Desktop do usuário, inclusive o total (6.693.875 · 10.515.020.000 · 86,1%). Diferença corrigida: medida em branco numa tabela agora fica vazia (antes aparecia "(Em branco)"). As outras 3 páginas ainda não foram comparadas visualmente com o Power BI.
- **Fase 1 da faixa de opções (inspirada no Power BI):**
  - Abas Arquivo, Página Inicial, Inserir, Modelagem, Exibição e Design (`src/components/Ribbon.tsx`).
  - Recortar/Copiar/Colar visual (Ctrl+X/C/V, entre páginas) e Pincel de formatação (copia `style` e opções visuais).
  - Inserir: nova página, duplicar página, caixa de texto, formas (retângulo, arredondado, elipse, linha, seta), imagem (guardada como data URL no projeto, máx. 4 MB) e botões (voltar / ir para página; Ctrl+clique aciona, como no Power BI Desktop).
  - Exibição: ajustar à página/largura/tamanho real, linhas de grade, ajustar à grade, bloquear objetos e mostrar/ocultar painéis, incluindo o novo painel **Seleção** (camadas, ordem, ocultar). As preferências ficam no `localStorage`, não no projeto.
  - Cabeçalho da visual: funil com os filtros que afetam a visual, Modo de foco e menu "⋯" (exportar CSV, mostrar como tabela, classificar, trazer para frente/enviar para trás, ocultar, duplicar, excluir).
  - Design: 6 temas prontos + o tema próprio do relatório (fica na galeria em `report.custom_theme`), importar/baixar tema JSON no formato do Power BI, tamanho da página, segundo plano da página e papel de parede.
  - Formatar: plano de fundo, transparência, borda, cantos e sombra de qualquer visual; cor, tamanho e alinhamento do título.
  - Lógica de edição em `src/reportOps.ts`. Motor: novo comando `write_text` (usado por "Baixar tema").
- **Ícone:** opção "F de barras" (`src-tauri/icons/icon-source.svg`; os demais tamanhos saem de `npx tauri icon src-tauri/icons/icon-source.svg -o src-tauri/icons`).
- **Instalador Windows:** NSIS em português (instala para o usuário ou para todos, com atalho no menu Iniciar) e MSI. O `.rpm` do Fedora não pode ser gerado no Windows: use o GitHub Actions (`.github/workflows/build.yml`) ou `npx tauri build --bundles rpm` no Fedora.

## 4. Próximos passos sugeridos (em ordem)
1. **Rodar tudo localmente no Fedora:** `npm ci`, `cargo test -p freebi-engine -p freebi-pbix` (corrigir o que falhar), `npx tauri dev`, importar `BI_Steam_AVD.pbix`, comparar com o Power BI.
2. **Gerar e instalar o `.rpm`** (`npx tauri build --bundles rpm`) e testar `sudo dnf install`. Depois, o mesmo no Windows (`npx tauri build --bundles msi,nsis`). Verificar a compilação do C (XPress9) com MSVC: há o `BUILD_STATIC` no `build.rs`.
3. **Comparação visual com o Power BI no PC do usuário** (ele autorizou): abrir o mesmo relatório nos dois, anotar as diferenças de layout, rótulos, formatos de número, ordenação e cores, e corrigir. Pontos já suspeitos:
   - As unidades automáticas dos cartões ("125,86 mil" contra o que o Power BI mostra).
   - O formato dos eixos ("5.000" ao lado de "10 mil").
   - O comportamento de segmentação suspensa e de seleção múltipla.
   - O cabeçalho de visual do Power BI (foco, "...").
   - Fontes Segoe UI no Linux (usar fallback).
4. **Lacunas de DAX mais comuns em trabalhos:** inteligência de tempo (`TOTALYTD`, `SAMEPERIODLASTYEAR`, `DATEADD`), `RANKX`, `TOPN`, `ALLEXCEPT` correto, `USERELATIONSHIP`, `FORMAT`, `DATE`, `TODAY`, `ROUND` com casas decimais (hoje ignora o 2º argumento — **bug conhecido**, em `compile.rs` função `scalar_fn`).
5. **Matriz de verdade** (pivot por colunas, subtotais) e formatação condicional.
6. **Salvar de volta em `.pbix`?** Não é viável de forma confiável: é preciso reescrever o VertiPaq. Recomendação: manter o `.freebi` e, se precisar, exportar CSV/Parquet para reimportar no Power BI.
7. Filtro bidirecional e relações muitos-para-muitos.
8. Desempenho em bases grandes: as consultas de uma página rodam em série. Dá para paralelizar com `queries` (o comando já existe no motor, mas a UI não usa).

## 5. Como validar com o `.pbix` do usuário
```bash
# Leitor nativo (Rust): lista tabelas, medidas, relações e páginas
cargo run --release -p freebi-pbix --example dump -- caminho/BI_Steam_AVD.pbix
CK=1 cargo run --release -p freebi-pbix --example dump -- caminho/BI_Steam_AVD.pbix | grep ^CK | sort > ck_rust.txt
# Referência independente (Python)
python -m venv .venv && .venv/bin/pip install pbixray
.venv/bin/python tools/pbix_checksums.py caminho/BI_Steam_AVD.pbix | sort > ck_py.txt && diff ck_py.txt ck_rust.txt
.venv/bin/python tools/verify_measures.py caminho/BI_Steam_AVD.pbix
cargo run --release -p freebi-engine --example report -- caminho/BI_Steam_AVD.pbix
# Teste de interface (modo navegador + Playwright)
npm run build && cargo build -p freebi-web && ./target/debug/freebi-web 7878 dist &
node tools/ui_test.cjs caminho/BI_Steam_AVD.pbix pasta_de_prints
```


## 6. Conteúdo do `.pbix` do usuário (para referência rápida)
- Tabelas:
  - `fato_desempenho_jogos` (125.855 linhas; chaves `id_jogo`, `id_tempo`, `id_genero`, `id_plataforma`, `id_precificacao`, `id_faixa_etaria`)
  - Dimensões: `dim_jogo`, `dim_tempo`, `dim_genero`, `dim_plataforma`, `dim_precificacao`, `dim_faixa_etaria`
- Medidas, todas em `fato_desempenho_jogos`:
  - `Total de Jogos = COUNTROWS(fato)`
  - `Jogos com 100 mil+ Donos = CALCULATE([Total de Jogos], fato[proprietarios_estimados] >= 150000)`
  - `Taxa de Sucesso = DIVIDE(...)`
  - `Aprovação Mediana = MEDIANX(FILTER(...), DIVIDE(...))`
  - `Taxa de Aprovação Geral`
  - `% Gratuitos = DIVIDE(CALCULATE([Total de Jogos], dim_precificacao[eh_gratuito] = "Sim"), [Total de Jogos])`
  - `Preço Mediano (Pagos) = CALCULATE(MEDIAN(preco_usd), preco_usd > 0)`
  - `Pico de Jogadores (CCU)`
  - `Mediana de CCU`
  - `Total de Donos Estimados`
  - `Tempo Médio de Jogo (h)`
  - `Média de Idiomas`
- Colunas calculadas, importadas como valores:
  - `dim_tempo[ordem_dia_semana]` (WEEKDAY)
  - `fato[faixa_idiomas]`, `fato[ordem_faixa_idiomas]` (SWITCH(TRUE()...))
  - `fato[tem_dlc]`
- Páginas:
  - Visão Geral: título, 2 segmentações suspensas, 5 cartões, colunas por ano, barras por gênero
  - Fatores de Sucesso: 4 gráficos
  - Gêneros e Lançamento: 3 gráficos
  - Ranking de Jogos: tabela com total
- Tema "Nova Roma": cores `#027A99`, `#072A44`, `#EDB926`…; fundo da página `#F4F8FA`.
- As fontes de dados originais eram CSVs numa pasta (parâmetro `PastaDados`). As consultas M estão guardadas em `origin_query` de cada tabela.

## 7. Armadilhas já encontradas
- `polars::prelude` exporta nomes que colidem com o crate `zip` e com `FieldRef`: use `::zip::` e `crate::model::FieldRef`.
- Polars 0.55: `DataFrame::new(height, cols)`, `df.columns()` (não `get_columns`), `is_in(lit(series).implode(false), false)`.
- `pkill -f freebi-web` mata o próprio shell que o chamou: use `pkill -x freebi-web`.
- O build release do Polars demora (10 a 20 min na primeira vez). `profile.dev.package."*"` usa opt-level 2 para o modo dev ficar rápido.
- Datas OLE do Power BI: dias desde 1899-12-30 (25569 = 1970-01-01).
- Ids VertiPaq: 2 = nulo, os valores começam em 3. Num segmento com nulos, a base é 2.
