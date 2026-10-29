# Configurar o ambiente local (Fedora e Windows) e abrir a nova sessão

## 1. Trazer o código para o seu PC
Se o repositório ainda não foi publicado no GitHub, use o pacote `free-bi.bundle` gerado na sessão anterior (baixe pelo app do Claude):
```bash
git clone free-bi.bundle free-bi
cd free-bi
git remote set-url origin https://github.com/Dev-Carlos-Alves/free-bi.git
git push -u origin main        # pede usuário/senha: use um token NOVO (o antigo foi exposto no chat e deve ser revogado)
```
Depois disso, nas outras máquinas basta `git clone https://github.com/Dev-Carlos-Alves/free-bi.git`.

> Para o git não lembrar o token da conta pessoal: não use `credential.helper store`. Use o gerenciador de credenciais só para este repositório, ou digite o token a cada push.

## 2. Dependências
### Fedora 44
```bash
sudo dnf install -y gcc gcc-c++ make rpm-build webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel libappindicator-gtk3-devel nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust estável
```
### Windows 10/11
1. Instale o **Visual Studio Build Tools** com a carga "Desenvolvimento para desktop com C++" (compila o XPress9 e o SQLite).
2. Instale o Rust por https://rustup.rs (toolchain `stable-x86_64-pc-windows-msvc`).
3. Instale o Node.js 20 ou superior.
4. O WebView2 já vem no Windows 10/11.

## 3. Rodar
```bash
npm ci
cargo test -p freebi-engine -p freebi-pbix
npx tauri dev
```
Gerar o instalador:
- Fedora: `npx tauri build --bundles rpm`, depois `sudo dnf install ./target/release/bundle/rpm/*.rpm`
- Windows: `npx tauri build --bundles msi,nsis` (o instalador fica em `target\release\bundle\`)

A primeira compilação release do Polars demora de 10 a 20 minutos.

## 4. Abrir a nova sessão do Claude Code localmente
1. Instale o Claude Code e entre na pasta: `cd free-bi && claude`. Pelo app desktop, abra a pasta `free-bi`.
2. Deixe `BI_Steam_AVD.pbix` acessível, por exemplo em `free-bi/exemplos/` (a pasta está no `.gitignore`, então não sobe para o GitHub).
3. Para usar o Power BI Desktop como referência, a sessão precisa rodar no **Windows**, onde ele está instalado.
4. Cole como primeira mensagem o texto de `docs/PROMPT_NOVA_SESSAO.md`.
