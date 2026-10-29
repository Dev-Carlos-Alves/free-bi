# Free BI

Ferramenta de Business Intelligence **livre e multiplataforma** (Linux, Windows e macOS), com motor em **Rust** ([Polars](https://pola.rs)) e interface desktop em [Tauri](https://tauri.app).

Ela nasceu de um problema real: fazer o relatório no Power BI em casa (Windows) e não conseguir abri-lo na faculdade (Fedora Linux).

## O que ela faz

| Área | Recursos |
| --- | --- |
| **Importar .pbix** | Abre arquivos do Power BI Desktop com o modelo importado: tabelas e dados (VertiPaq), medidas DAX, colunas calculadas, relações, "classificar por coluna", consultas M (só para consulta), páginas, visuais, segmentações e tema. |
| **Obter dados** | CSV (detecta `;` ou `,`, vírgula decimal e Latin-1/UTF-8), Excel (`.xlsx`, `.xls`, `.ods`, escolhendo as planilhas), Parquet e JSON. |
| **Transformar** | Etapas aplicadas no estilo Power Query: remover e renomear colunas, mudar o tipo, filtrar linhas, substituir valores, preencher vazios, remover duplicatas, aparar, maiúsculas e minúsculas, dividir coluna, ordenar, manter as primeiras linhas. |
| **Modelo** | Relações muitos-para-um (com detecção automática), diagrama arrastável, relações ativas e inativas. |
| **DAX** | Medidas e colunas calculadas: `SUM`, `AVERAGE`, `MEDIAN`, `COUNTROWS`, `DISTINCTCOUNT`, `SUMX`/`AVERAGEX`/`MEDIANX`/…, `CALCULATE` com filtros, `FILTER`, `ALL`/`REMOVEFILTERS`, `DIVIDE`, `IF`, `SWITCH`, `VAR`/`RETURN`, `RELATED`, `IN {…}`, funções de data e de texto, e outras. |
| **Relatório** | Colunas, barras (agrupadas e empilhadas), linhas, área, combinação, pizza, rosca, funil, treemap, dispersão, cartão, medidor, tabela, matriz, segmentação (lista ou suspensa) e caixa de texto. Também filtro cruzado ao clicar, filtros de visual, página e relatório, hierarquia de datas, várias páginas, desfazer/refazer. |
| **Projeto** | Arquivo `.freebi` (zip com JSON + Parquet) que abre igual no Linux e no Windows. |

### Desempenho

O `.pbix` de exemplo (7 tabelas, cerca de 257 mil linhas, 12 medidas) é importado em ~0,4 s. Os 12 cartões da primeira página são calculados em ~7 ms.

## Instalar

Os instaladores são gerados pelo GitHub Actions (aba **Actions**, ou **Releases** quando houver uma tag `v*`):

- **Fedora / RHEL:** `sudo dnf install ./Free.BI-0.1.0-1.x86_64.rpm`
- **Ubuntu / Debian:** `sudo apt install ./Free.BI_0.1.0_amd64.deb`
- **Qualquer Linux:** baixe o `.AppImage`, dê `chmod +x` e execute.
- **Windows:** `.msi` ou `-setup.exe`.

### Modo navegador (sem instalar nada)

```bash
cargo build --release -p freebi-web && npm ci && npm run build
./target/release/freebi-web 7878 dist   # abra http://127.0.0.1:7878
```

## Desenvolvimento

Requisitos: Rust estável, Node 20+. No Linux, também as bibliotecas do WebKitGTK:

```bash
# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel
# Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
```

```bash
npm ci
npx tauri dev          # app desktop com recarga automática
npx tauri build        # gera os instaladores em target/release/bundle
cargo test -p freebi-engine -p freebi-pbix
```

### Estrutura

```
crates/pbix/     leitor de .pbix: XPress9 (C, MIT, Microsoft) → backup ABF → SQLite de metadados → colunas VertiPaq
crates/engine/   motor: carga de dados, etapas, DAX → Polars, consultas das visuais, projeto .freebi
crates/server/   servidor HTTP (modo navegador)
src-tauri/       app desktop
src/             interface (React + ECharts)
```

## Limitações conhecidas (sinceramente)

- **Não substitui o Power BI por completo.** Ficam de fora: Power Query M completo (os passos M do `.pbix` não são reexecutados, e os dados vêm já processados do modelo), DirectQuery/conexão ao vivo, publicação no serviço, mapas, visuais personalizados, segurança em nível de linha, inteligência de tempo (`SAMEPERIODLASTYEAR`, `TOTALYTD`…), relações muitos-para-muitos e filtro bidirecional.
- `ALL`/`REMOVEFILTERS` dentro de `CALCULATE` removem o agrupamento da visual, mas mantêm os filtros de página e de segmentação (comportamento de `ALLSELECTED`).
- Colunas calculadas vindas do `.pbix` são importadas como valores prontos. A expressão fica guardada só para referência.
- A importação de `.pbix` foi validada com o formato de relatório novo (PBIR) e com o modelo compactado em XPress9. O layout legado (`Report/Layout`) é lido em modo de melhor esforço.
- Modelos do Excel/Power Pivot com compressão XPress8 por arquivo ainda não são suportados.

## Créditos e licenças

- Descompressor XPress9: código da Microsoft sob licença MIT (`crates/pbix/vendor/xpress9`, via [xpress9-python](https://github.com/Hugoberry/xpress9-python)).
- Formato do modelo: especificação pública [MS-XLDM] e o trabalho de engenharia reversa do projeto [PBIXRay](https://github.com/Hugoberry/pbixray) (MIT), usado como referência e para validar os resultados.
- Projeto não afiliado à Microsoft. "Power BI" é marca da Microsoft.

Licença: MIT.
