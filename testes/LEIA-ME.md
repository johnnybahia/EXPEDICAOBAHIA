# Testes — simulação do Apps Script

Roda o `CODIGO.GS` inteiro em Node, com uma planilha em memória (`gasmock.js`), e a tela (`INDEX.HTML`) no Chromium.
Serve para provar uma mudança **antes** de publicar no Apps Script.

```
node testes/rodar_todos.js                    # base sintética: nenhum dado real no repositório
node testes/rodar_todos.js --dados <pasta>    # export real (3 CSV do Google Sheets) — a pasta fica fora do Git
```

Precisa de Node 22. O teste da tela precisa do Playwright
(`npm install --no-save playwright && npx playwright install chromium`); sem ele a etapa é **pulada** (⚠️ no placar).
O GitHub roda a bateria sozinho a cada push (`.github/workflows/testes.yml`).

Na pasta de `--dados`, os CSV são achados pelo fim do nome: `…DADOS_IMPORTADOS`, `…PEDIDOS` e `…Relatorio_DB`.
Use `testes/dados_locais/` (já está no `.gitignore`).

## O que cobre

| Arquivo | Cobre |
|---|---|
| `cenarios.js` | O incidente de 26/10/2026 (leitura da fonte sem o lote recém-chegado) e a regra **"nenhum Faturado sem usuário"**: marcado pelo usuário → Faturado; sem marcação (QTD>0 ou QTD=0) → `PENDENTE`; volta à origem → pendência some; aviso de conferência (`confirmarSaidaFonte`: nível TOTAL, linha desatualizada, resposta repetida, histórico); releitura antes de gravar (baixa do usuário não é desfeita); trava da importação; menu "sinalizar"; válvula de queda brusca da fonte; reset do zero; e o nº de chamadas a `Utilities.formatDate` não crescer com o nº de linhas |
| `sequencia.js` | Sequência por OC: a OC **inteira** é numerada se tem ao menos 1 item com DT. ENTREGA ≥ 04/11/2026 (OC toda anterior ou sem data fica sem número); o número é a posição na aba `original`; sequência já gravada no PEDIDOS chega ao DB mesmo com o item já lá (defeito antigo); número gravado é imutável (nova importação, QTD alterada, `original` reordenada); item elegível fora da `original` fica sem número e é contado; a função de menu `numerarSequenciasAgora`; **RESET COMPLETO**: backup da sequência antes (aba `BACKUP_SEQUENCIA`, últimas 5 cópias, reset cancelado se o backup falhar); depois do reset o item mantém o número da própria linha do PEDIDOS (mesmo sem ID) ou, na falta dela, o do backup (por UUID, ou por OC+pedido+produto+tamanho+lote+data) **antes** de qualquer derivação da aba `original` — que encolhe quando itens são faturados (caso coberto: faturar os PRIMEIROS itens desloca as posições); OC que deixou de ser elegível pela data mas ainda tem itens abertos mantém o número no DB; pior caso (PEDIDOS e DB apagados, UUIDs perdidos) também volta igual; nunca sobrescreve nem repete número na OC; menu "Restaurar sequência do último backup" como plano B |
| `tela.js` | Janela de conferência: abre só para TOTAL, escapa HTML, chama `confirmarSaidaFonte` com os argumentos certos, selos da tabela |

## Provar que a bateria pega defeito (teste de mutação)

`CODIGO_GS=<outro .gs>` roda os cenários contra outra versão do código:

```
git show <commit antigo>:CODIGO.GS > /tmp/antigo.gs
CODIGO_GS=/tmp/antigo.gs node testes/cenarios.js      # tem que FALHAR (o código antigo faturava sozinho)
```

## Limites do simulador

Não reproduz: limite de 6 min e cota diária, horário real, gatilhos, concorrência real do `LockService`, tipos de
célula além do que o CSV mostra, e as abas `original` e `LOTE DILLY` reais (a base não as inclui). A sequência por OC é
exercitada em `sequencia.js` com uma aba `original` **sintética** montada a partir do DADOS_IMPORTADOS (o layout A..N é o
do código, não o da planilha real); a troca de CÓD. OS do Dilly **não** é exercitada. Mudança feita direto no editor do
Apps Script não passa por teste.
O ganho de tempo é medido em **chamadas** a `Utilities.formatDate`, não em segundos.
