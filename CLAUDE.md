# CLAUDE.md — instruções para o Claude Code neste repositório

Leia também **docs/HANDOFF.md**. Ele traz o histórico completo da conversa que criou o projeto, as decisões tomadas, o estado atual e os próximos passos.

## Sobre o usuário (preferências — obrigatório seguir)
- Idioma: **português do Brasil** em tudo (respostas, comentários de código, textos da interface, mensagens de commit).
- Estilo: **direto e sincero**. Questione quando discordar, sem enrolação, sem elogio vazio e sem inflar o ego. Diga a verdade, inclusive sobre limitações.
- Plataformas obrigatórias: **Fedora Linux (44)** e **Windows**. Toda mudança precisa funcionar nos dois. Não use APIs exclusivas de um SO sem alternativa para o outro.

## Git — regras
- Repositório do projeto: `https://github.com/Dev-Carlos-Alves/free-bi.git` (conta pessoal **Dev-Carlos-Alves**).
- A conta e o token pessoais **só valem para este repositório**. **Nunca** salve token ou credencial em arquivo, config global, `.git/config`, remote URL, memória, CLAUDE.md ou qualquer outro lugar. Se o usuário fornecer um token, use-o apenas no comando, sem persistir.
- **Não altere a configuração global do git.** Por padrão, a identidade global continua a da empresa (Prottus). Neste repositório, use identidade local só se o usuário pedir.
- Commit e push só quando o usuário pedir. Mensagens de commit em português.

## Comandos
```bash
npm ci                                  # dependências do frontend
npx tauri dev                           # app desktop em modo desenvolvimento
npx tauri build                         # instaladores (Linux: rpm/deb/AppImage; Windows: msi/nsis)
cargo test -p freebi-engine -p freebi-pbix
npx tsc --noEmit && npx vite build      # checa e compila o frontend
cargo build -p freebi-web && ./target/debug/freebi-web 7878 dist   # modo navegador em http://127.0.0.1:7878
```
Dependências de sistema no Fedora: `sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel libappindicator-gtk3-devel rpm-build`
No Windows: Rust (MSVC) + Node 20+ + WebView2 (já vem no Windows 10/11) + "Desktop development with C++" do Visual Studio Build Tools (necessário para compilar o XPress9 em C e o SQLite).

## Arquitetura (resumo)
- `crates/pbix` — leitor de `.pbix`: XPress9 (C da Microsoft, MIT, em `vendor/`) → backup ABF → `metadata.sqlitedb` → colunas VertiPaq (.idf/.idfmeta/.dictionary com Huffman) + layout do relatório (PBIR e legado).
- `crates/engine` — motor: carga de CSV/Excel/Parquet/JSON, etapas (Power Query simplificado), DAX → expressões Polars, consultas das visuais com joins pelas relações, projeto `.freebi`. A interface chama tudo por `Engine::handle(cmd, args)`.
- `crates/server` — `freebi-web`: servidor HTTP (axum) que expõe `handle` em `POST /api/{cmd}` (modo navegador e testes com Playwright).
- `src-tauri` — app desktop (Tauri 2), comando único `call(cmd, args)`.
- `src/` — React 19 + ECharts 6 + zustand. `api.ts` detecta Tauri × navegador.

## Convenções
- As colunas no frame unificado usam o nome qualificado `Tabela[Coluna]` (veja `dax::qual`).
- Novo comando do motor: adicione no `match` de `Engine::handle` (`crates/engine/src/lib.rs`) e em `src/api.ts`.
- Toda mudança no motor deve vir com teste em `crates/engine/tests/engine.rs`.
- Validação com um `.pbix` real: veja "Como validar" em docs/HANDOFF.md.
