# Mensagem para iniciar a nova sessão local

Copie e cole o texto abaixo (ajuste o caminho do .pbix):

---

Estamos continuando o projeto **Free BI**: uma alternativa livre ao Power BI, em Rust (Polars) + Tauri + React. Ela precisa rodar no **Fedora Linux 44 e no Windows**. O projeto foi criado numa sessão anterior na nuvem, que agora continua no meu PC.

1. Leia `CLAUDE.md`, `docs/HANDOFF.md` e `docs/SETUP_LOCAL.md` antes de qualquer coisa. Lá estão as minhas preferências, as regras de git (a conta pessoal `Dev-Carlos-Alves` é só para este repositório; **nunca salve token**; não mexa na configuração global do git, que é a da empresa Prottus), o estado atual e os próximos passos.
2. Meu relatório de teste está em `exemplos/BI_Steam_AVD.pbix`.
3. Comece pelo item 1 dos "Próximos passos" do HANDOFF:
   - Verificar as dependências desta máquina.
   - Rodar `cargo test -p freebi-engine -p freebi-pbix` e corrigir as falhas (os testes foram escritos, mas nunca rodaram).
   - Rodar `npx tauri dev` e importar o `.pbix`.
   - Gerar o instalador desta plataforma.
4. Se estiver no Windows, com o Power BI Desktop instalado: abra o mesmo `.pbix` no Power BI e compare página por página com o Free BI (layout, números, formatos, ordenação, cores, interações). Liste as diferenças e corrija.
5. Mantenha tudo em português, seja direto e sincero, e me questione quando discordar.

Commit e push só quando eu pedir.
