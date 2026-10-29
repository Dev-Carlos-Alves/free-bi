<p align="center">
  <img src="src-tauri/icons/icon-source.svg" width="120" alt="Ícone do Free BI">
</p>

<h1 align="center">Free BI</h1>

<p align="center">
  <b>Business Intelligence livre, rápido e que abre o seu <code>.pbix</code> no Linux.</b><br>
  Motor em Rust · Interface desktop · Fedora, Windows e macOS
</p>

<p align="center">
  <a href="#instalar">Instalar</a> ·
  <a href="#o-que-ele-faz">Recursos</a> ·
  <a href="#rodar-a-partir-do-código">Rodar do código</a> ·
  <a href="#limitações-sinceramente">Limitações</a> ·
  <a href="#sobre-o-autor">Sobre</a>
</p>

---

## Por que o Free BI existe

Fiz um trabalho da faculdade no **Power BI Desktop**, em casa, no Windows. Na aula, os computadores rodam **Fedora Linux**, e o Power BI Desktop não existe para Linux. Resultado: o relatório não abria.

O Free BI resolve isso. Ele é um BI desktop que:

- **abre arquivos `.pbix` do Power BI** com dados, medidas DAX, relações, páginas, visuais e tema;
- **roda igual no Linux e no Windows**, e salva projetos `.freebi` que abrem nos dois;
- deixa você **criar e editar relatórios do zero** com CSV, Excel, Parquet ou JSON.

Ele não tenta substituir o Power BI inteiro (veja as [limitações](#limitações-sinceramente)). Ele cobre o que um relatório acadêmico ou de pequena empresa usa no dia a dia, com uma interface parecida o bastante para quem já conhece o Power BI.

## O que ele faz

| Área | Recursos |
| --- | --- |
| **Importar `.pbix`** | Tabelas e dados (VertiPaq), medidas DAX, colunas calculadas, relações, "classificar por coluna", páginas, visuais, segmentações e tema. As consultas M ficam guardadas para referência. |
| **Obter dados** | CSV (detecta `;` ou `,`, vírgula decimal e Latin-1/UTF-8), Excel (`.xlsx`, `.xls`, `.ods`), Parquet e JSON. |
| **Transformar** | Etapas no estilo Power Query: remover e renomear colunas, mudar o tipo, filtrar, substituir, preencher vazios, remover duplicatas, aparar, maiúsculas e minúsculas, dividir coluna, ordenar, manter as primeiras linhas. |
| **Modelo** | Relações muitos-para-um, com detecção automática, diagrama arrastável e relações ativas ou inativas. |
| **DAX** | `SUM`, `AVERAGE`, `MEDIAN`, `COUNTROWS`, `DISTINCTCOUNT`, `SUMX`/`AVERAGEX`/`MEDIANX`/…, `CALCULATE` com filtros, `FILTER`, `ALL`/`REMOVEFILTERS`, `DIVIDE`, `IF`, `SWITCH`, `VAR`/`RETURN`, `RELATED`, `IN {…}`, funções de data e de texto, entre outras. |
| **Visuais** | Colunas, barras, linhas, área, combinação, pizza, rosca, funil, treemap, dispersão, cartão, medidor, tabela, matriz, segmentação, caixa de texto, formas, imagem e botões de navegação. |
| **Interação** | Filtro cruzado ao clicar, filtros de visual, de página e de relatório, hierarquia de datas, modo de foco, "mostrar como tabela" e exportar dados em CSV. |
| **Faixa de opções** | Abas Arquivo, Página Inicial, Inserir, Modelagem, Exibição e Design. Inclui recortar, copiar e colar visuais, pincel de formatação, painel Seleção (camadas), linhas de grade, bloquear objetos, temas prontos e importação/exportação de tema JSON compatível com o Power BI. |
| **Projeto** | Arquivo `.freebi` (zip com JSON e Parquet) que abre igual no Linux e no Windows. Desfazer e refazer em tudo. |

### Desempenho

Com o relatório de exemplo (7 tabelas, cerca de 257 mil linhas e 12 medidas), a importação do `.pbix` leva cerca de 0,4 s, e os 12 cartões da primeira página são calculados em cerca de 7 ms.

### Fidelidade com o Power BI

Os números foram conferidos contra o Power BI Desktop: os 12 cartões do relatório de teste batem com um cálculo independente, e a página de ranking bate linha a linha, inclusive no total.

## Instalar

> **Não baixe o ZIP do repositório** (botão verde **Code › Download ZIP**). Ele traz só o código-fonte, não o programa pronto.

O programa pronto fica na página de versões:

1. Abra **[github.com/Dev-Carlos-Alves/free-bi/releases/latest](https://github.com/Dev-Carlos-Alves/free-bi/releases/latest)**. Pelo site, é o link **Releases** na coluna da direita da página do repositório.
2. Desça até a seção **Assets**, no fim da versão. Se ela estiver fechada, clique em **Assets** para abrir.
3. Clique no arquivo do seu sistema (tabela abaixo). O download começa na hora e o arquivo vai para a pasta **Downloads**.

| Seu computador | Arquivo para baixar (versão 0.1.0) |
| --- | --- |
| **Windows 10/11** | `Free.BI_0.1.0_x64-setup.exe` |
| **Fedora** (RHEL, openSUSE) | `Free.BI-0.1.0-1.x86_64.rpm` |
| **Ubuntu / Debian** | `Free.BI_0.1.0_amd64.deb` |
| Outro Linux | `Free.BI_0.1.0_amd64.AppImage` |
| macOS | o arquivo `.dmg` |

Em versões novas, só o número (`0.1.0`) muda.

### Windows 10/11

1. Baixe o `Free.BI_0.1.0_x64-setup.exe` (veja os passos acima).
2. Abra a pasta **Downloads** e dê dois cliques no arquivo.
3. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e depois em **Executar assim mesmo**. O aviso aparece porque o instalador não tem uma assinatura digital paga, não porque haja algum problema.
4. Siga o assistente, que está em português. Dá para instalar só para você, sem precisar de administrador.
5. Abra pelo menu Iniciar, procurando "Free BI".

O `.msi` é a mesma coisa em outro formato, útil para TI instalar em vários computadores. Quem usa um computador só pode ignorar.

### Fedora

**Jeito mais fácil:** um comando só, que baixa e instala de uma vez. Abra o **Terminal** e cole:

```bash
sudo dnf install https://github.com/Dev-Carlos-Alves/free-bi/releases/download/v0.1.0/Free.BI-0.1.0-1.x86_64.rpm
```

Digite a sua senha do Linux quando ela for pedida (nada aparece enquanto você digita, é normal) e confirme com `s` ou `y`.

**Ou, se você já baixou o `.rpm` pelo navegador:**

```bash
cd ~/Downloads
sudo dnf install ./Free.BI-0.1.0-1.x86_64.rpm
```

O `./` na frente do nome é obrigatório, porque é ele que diz ao `dnf` que o arquivo está na pasta atual. O `dnf` instala sozinho as dependências (WebKitGTK e GTK 3). Depois, procure "Free BI" no menu de aplicativos (tecla Super).

Para desinstalar:

```bash
sudo dnf remove free-bi
```

### Ubuntu e Debian

```bash
cd ~/Downloads
sudo apt install ./Free.BI_0.1.0_amd64.deb
```

### Qualquer outro Linux (AppImage)

Não precisa instalar: basta dar permissão de execução e abrir.

```bash
cd ~/Downloads
chmod +x Free.BI_0.1.0_amd64.AppImage
./Free.BI_0.1.0_amd64.AppImage
```

### macOS

Baixe o `.dmg` e arraste o Free BI para Aplicativos. Ainda não foi testado num Mac de verdade.

## Primeiros passos

1. Abra o Free BI e clique em **Importar relatório do Power BI (.pbix)**. Se não tiver um `.pbix`, use **Obter dados** e escolha um CSV ou uma planilha do Excel.
2. Navegue pelas páginas nas abas de baixo. Clique numa barra ou numa linha da tabela para filtrar as outras visuais.
3. Para criar uma visual, escolha um tipo no painel **Visualizações** e arraste campos do painel **Dados**.
4. Salve com **Ctrl+S**. O arquivo `.freebi` abre em qualquer computador com o Free BI, no Linux ou no Windows.

Atalhos úteis: **Ctrl+C / Ctrl+X / Ctrl+V** (copiar, recortar e colar visuais), **Ctrl+Z / Ctrl+Y** (desfazer e refazer), **Delete** (excluir visual), **Esc** (sair do modo de foco ou do pincel) e **Ctrl+clique** num botão (acioná-lo durante a edição).

## Rodar a partir do código

### O que você precisa

| | Fedora | Windows |
| --- | --- | --- |
| Rust estável | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | [rustup.rs](https://rustup.rs) (toolchain MSVC) |
| Node.js 20+ | `sudo dnf install nodejs npm` | [nodejs.org](https://nodejs.org) |
| Compilador C/C++ | `sudo dnf install gcc gcc-c++ make` | Visual Studio Build Tools, com "Desenvolvimento para desktop com C++" |
| Bibliotecas do sistema | `sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel libappindicator-gtk3-devel rpm-build` | O WebView2 já vem no Windows 10/11 |

No Ubuntu, as bibliotecas do sistema são instaladas com `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`.

### Comandos

```bash
git clone https://github.com/Dev-Carlos-Alves/free-bi.git
cd free-bi
npm ci                                       # dependências da interface
npx tauri dev                                # abre o app em modo de desenvolvimento
cargo test -p freebi-engine -p freebi-pbix   # testes do motor e do leitor de .pbix
```

A primeira compilação demora: o Polars é grande. Conte de 10 a 20 minutos. Depois disso, recompila em segundos.

### Gerar o instalador

| Sistema | Comando | Onde fica |
| --- | --- | --- |
| Fedora | `npx tauri build --bundles rpm` | `target/release/bundle/rpm/` |
| Ubuntu/Debian | `npx tauri build --bundles deb,appimage` | `target/release/bundle/deb/` e `appimage/` |
| Windows | `npx tauri build --bundles nsis,msi` | `target\release\bundle\nsis\` e `msi\` |

Cada sistema gera os próprios instaladores: o `.rpm` sai do Linux e o `.exe` sai do Windows. O GitHub Actions (`.github/workflows/build.yml`) gera todos de uma vez.

### Modo navegador (sem app desktop)

```bash
npm ci && npm run build
cargo run --release -p freebi-web -- 7878 dist   # depois abra http://127.0.0.1:7878
```

### Como o código está organizado

```
crates/pbix/     leitor de .pbix: XPress9 (C, MIT, Microsoft) → backup ABF → SQLite de metadados → colunas VertiPaq
crates/engine/   motor: carga de dados, etapas, DAX → Polars, consultas das visuais, projeto .freebi
crates/server/   servidor HTTP (modo navegador e testes)
src-tauri/       app desktop (Tauri 2)
src/             interface (React 19 + ECharts 6 + zustand)
docs/            histórico do projeto, decisões e próximos passos
```

A interface conversa com o motor por um único ponto de entrada (`Engine::handle(cmd, args)`), tanto no app desktop quanto no modo navegador.

## Limitações (sinceramente)

- **Não substitui o Power BI por completo.** Ficam de fora: Power Query M completo (os passos M do `.pbix` não são reexecutados, e os dados vêm prontos do modelo), DirectQuery e conexão ao vivo, publicação no serviço, mapas, visuais personalizados, segurança em nível de linha, inteligência de tempo (`SAMEPERIODLASTYEAR`, `TOTALYTD`…), relações muitos-para-muitos e filtro bidirecional.
- **Não salva de volta em `.pbix`.** Isso exigiria reescrever o formato interno do Power BI de forma confiável. Use o `.freebi` e, se precisar voltar ao Power BI, exporte os dados em CSV.
- `ALL`/`REMOVEFILTERS` dentro de `CALCULATE` removem o agrupamento da visual, mas mantêm os filtros de página e de segmentação (comportamento de `ALLSELECTED`).
- Colunas calculadas vindas do `.pbix` são importadas como valores prontos. A expressão fica guardada só para referência.
- O layout de relatório novo (PBIR) é lido por completo. O layout legado (`Report/Layout`) é lido em modo de melhor esforço.
- Modelos do Excel/Power Pivot com compressão XPress8 ainda não são suportados.

Os próximos passos planejados estão em [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Agradecimentos

- **[PBIXRay](https://github.com/Hugoberry/pbixray)** e **[xpress9-python](https://github.com/Hugoberry/xpress9-python)**, de Igor Cotruta (Hugoberry), ambos sob licença MIT. Foram a referência para entender o formato do `.pbix` e para validar cada coluna lida pelo Free BI.
- **Microsoft**, pelo descompressor XPress9 publicado sob licença MIT e pela especificação pública [MS-XLDM].
- **[Polars](https://pola.rs)**, **[Tauri](https://tauri.app)**, **[Apache ECharts](https://echarts.apache.org)**, **[React](https://react.dev)** e **[calamine](https://github.com/tafia/calamine)**, que fazem o trabalho pesado.
- **Faculdade Nova Roma**, onde nasceu o relatório de teste (Data Mart de jogos da Steam, projeto AVD) que motivou e validou o projeto.
- **[Claude](https://claude.ai)** (Anthropic), parceiro de programação no desenvolvimento.

## Sobre o autor

Feito por **Carlos Alves** ([@Dev-Carlos-Alves](https://github.com/Dev-Carlos-Alves)), estudante da Faculdade Nova Roma, que precisava abrir um relatório do Power BI no Linux e acabou construindo um BI.

Sugestões, problemas e contribuições são bem-vindos nas [Issues](https://github.com/Dev-Carlos-Alves/free-bi/issues).

## Licença

[MIT](LICENSE). Use, modifique e distribua à vontade.

O Free BI não é afiliado à Microsoft. "Power BI" é marca registrada da Microsoft.
