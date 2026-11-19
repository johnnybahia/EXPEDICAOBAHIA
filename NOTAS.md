# Notas — Expedição Bahia

A versão em uso aparece na faixa acima do programa ("Versão x.y.z · atualizado em dd/mm/aaaa"). Se a faixa não
mudou depois de publicar, a nova versão da implantação não foi publicada ou a página está em cache (Ctrl+F5).
Regra de numeração no `CLAUDE.md`.

## Histórico de versões

| Versão | Data | O que mudou |
|---|---|---|
| 1.0.0 | 19/11/2026 | **Marcação × faturamento parcial** (incidente de 18/11/2026 no sistema do Ceará; o mesmo defeito existia aqui). Depois da NF da parte baixada, o sync gravava o CHECKPOINT do ciclo novo e só no fim limpava a marcação; se a execução morresse no meio (limite de 6 min), o saldo restante ficava marcado para faturar no nome de quem marcou o ciclo anterior e o relatório o listaria inteiro. Agora: o reset de ciclo limpa P, V, W e X (antes X ficava) na mesma escrita da linha e o CHECKPOINT só é gravado depois — se morrer antes, a rodada seguinte refaz; o sync encerra marcação vencida (marcada, QTD aberta e sem baixa desde o último CHECKPOINT); o relatório deixa de fora item sem baixa no ciclo (antes usava a QTD aberta inteira) e avisa quais ficaram fora; `marcarParaFaturar` recusa QTD aberta sem baixa no ciclo (tela desatualizada), confere o ID da linha e registra MARCOU/DESMARCOU no `Historico_Decisoes` (o sync registra MARCACAO_ENCERRADA); baixa e lote de emissão conferem o ID da linha (a limpeza diária desloca linhas); marcar item com baixa parcial ganhou CANCELAR (no confirm antigo "Cancelar" marcava mesmo assim); a tela só mostra o item como marcado com P = SIM. Faixa de versão criada. Testes: `testes/marcacao.js` e novos casos em `testes/tela.js`. |
