import sys
from pbixray import PBIXRay
m = PBIXRay(sys.argv[1]); f = m.get_table("fato_desempenho_jogos"); p = m.get_table("dim_precificacao")
n=len(f); print("Total", n)
fp = f.merge(p, on="id_precificacao", how="left"); print("% Gratuitos", (fp.eh_gratuito=="Sim").sum()/n)
print("Preço Mediano (Pagos)", f.preco_usd[f.preco_usd>0].median())
tot=f.avaliacoes_positivas+f.avaliacoes_negativas; sel=f[tot>=10]
print("Aprovação Mediana", (sel.avaliacoes_positivas/(sel.avaliacoes_positivas+sel.avaliacoes_negativas)).median())
print("Taxa de Sucesso", (f.proprietarios_estimados>=150000).sum()/n)
print("Taxa Aprov Geral", f.avaliacoes_positivas.sum()/(f.avaliacoes_positivas.sum()+f.avaliacoes_negativas.sum()))
print("CCU", f.pico_jogadores_ccu.sum(), "Donos", f.proprietarios_estimados.sum(), "Tempo h", f.tempo_medio_jogo_min.mean()/60, "Idiomas", f.qtd_idiomas_suportados.mean())
