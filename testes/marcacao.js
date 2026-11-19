// Marcação para faturar × faturamento parcial (incidente de 18/11/2026, no sistema irmão do Ceará): depois da NF
// da parte baixada, o sync gravou o CHECKPOINT do ciclo novo e a execução morreu (limite de 6 min) antes de limpar
// a marcação. O saldo restante amanheceu "marcado para faturar" no nome de quem marcou o ciclo anterior e o
// relatório o listaria inteiro.
//   node testes/marcacao.js
const assert = require('assert');
const { criarRelatorio, montar, baseSintetica, linhasDB } = require('./lib');

const R = criarRelatorio('marcacao.js');
const t = R.t;
const base = baseSintetica(30);
const COL = { QTD: 9, P: 15, V: 21, W: 22, X: 23 };

/** Ambiente com um item Ativo de QTD > 500 escolhido; devolve {env, id, linha, qtd}. */
function preparar() {
  const env = montar(base);
  const db = env.ss.getSheetByName('Relatorio_DB').data;
  for (let i = 1; i < db.length; i++) {
    if (db[i][14] === 'Ativo' && Number(db[i][COL.QTD]) > 500) return { env, id: db[i][0], linha: i + 1, qtd: Number(db[i][COL.QTD]) };
  }
  throw new Error('base sem item adequado');
}
const linhaDb = (env, id) => env.ss.getSheetByName('Relatorio_DB').data.find(r => r[0] === id);
const marcacao = (env, id) => { const r = linhaDb(env, id); return [r[COL.P], r[COL.V], r[COL.W], r[COL.X]].map(v => String(v || '')); };
const checkpoints = (env, id) => env.ss.getSheetByName('Baixas_Historico').data.filter(r => r[0] === id && r[6] === 'CHECKPOINT');
const historico = (env, evento) => { const h = env.ss.getSheetByName('Historico_Decisoes'); return h ? h.data.slice(1).filter(r => r[1] === evento) : []; };
const noRelatorio = (env, id) => env.ctx.obterItensMarcadosParaFaturar('BAIXA1');
/** A origem (PEDIDOS) passa a ter `qtd` para o item — é o que acontece quando o ERP emite a NF parcial. */
const origemPassaA = (env, id, qtd) => env.ss.getSheetByName('PEDIDOS').data.forEach(r => { if (r[0] === id) r[10] = qtd; });
/** Rotina do dia: baixa parcial B, marca (usuário ANA), imprime o relatório (lote FAT-900) e o ERP fatura B. */
function cicloParcial(B) {
  const p = preparar();
  assert.ok(p.env.ctx.aplicarBaixa(p.id, p.linha, B, 'ANA').success, 'baixa');
  const m = p.env.ctx.marcarParaFaturar(p.id, p.linha, true, 'ANA', 'BAIXA1');
  assert.ok(m.success, 'marcação: ' + m.error);
  p.env.ctx.registrarLoteEmissao([{ planilhaLinha: p.linha, uniqueId: p.id, loteId: 'FAT-900' }]);
  origemPassaA(p.env, p.id, p.qtd - B);
  return p;
}

// ── 1. Reset de ciclo completo ─────────────────────────────────────────────────────────────────────────────
{
  const p = cicloParcial(311);
  const rel = noRelatorio(p.env).items.find(i => i.uniqueId === p.id);
  t('antes da NF: o relatório traz o item com o que foi baixado (311)', () => assert.strictEqual(rel && rel.SALDO, 311));
  p.env.ctx.sincronizarDados();
  t('NF parcial: a marcação some por inteiro — P, V (usuário), W (lote) e X (perfil)', () => assert.deepStrictEqual(marcacao(p.env, p.id), ['', '', '', '']));
  t('NF parcial: um CHECKPOINT com a nova base (saldo restante)', () => {
    const c = checkpoints(p.env, p.id);
    assert.strictEqual(c.length, 1); assert.strictEqual(Number(c[0][5]), p.qtd - 311);
  });
  t('NF parcial: Historico_Decisoes registra a marcação encerrada, com quem marcou e o lote', () => {
    const h = historico(p.env, 'MARCACAO_ENCERRADA').filter(r => r[4] === p.id);
    assert.strictEqual(h.length, 1);
    assert.match(h[0][2], /ANA/);
    assert.match(h[0][13], /ciclo encerrado/);
  });
  t('NF parcial: o saldo restante NÃO vai para o relatório', () => assert.ok(!noRelatorio(p.env).items.some(i => i.uniqueId === p.id)));
  const d1 = JSON.stringify(linhasDB(p.env));
  p.env.ctx.sincronizarDados();
  t('segunda rodada não muda nada e não grava outro CHECKPOINT', () => {
    assert.strictEqual(JSON.stringify(linhasDB(p.env)), d1); assert.strictEqual(checkpoints(p.env, p.id).length, 1);
  });
}

// ── 2. A execução morre entre o processamento e a gravação (o que aconteceu às 19:54) ─────────────────────────
{
  const p = cicloParcial(311);
  const original = p.env.ctx._mesclarAlteracoesConcorrentes_;
  p.env.ctx._mesclarAlteracoesConcorrentes_ = () => { throw new Error('Exceeded maximum execution time'); };
  let morreu = false;
  try { p.env.ctx.sincronizarDados(); } catch (e) { morreu = /Exceeded/.test(e.message); }
  p.env.ctx._mesclarAlteracoesConcorrentes_ = original;
  t('rodada interrompida: nenhum CHECKPOINT gravado (nada pela metade)', () => {
    assert.ok(morreu); assert.strictEqual(checkpoints(p.env, p.id).length, 0);
  });
  p.env.ctx.sincronizarDados();
  t('rodada seguinte conclui o reset: marcação limpa e exatamente um CHECKPOINT', () => {
    assert.deepStrictEqual(marcacao(p.env, p.id), ['', '', '', '']); assert.strictEqual(checkpoints(p.env, p.id).length, 1);
  });
}

// ── 3. Marcação que ficou presa numa versão antiga: o sync encerra sozinho ────────────────────────────────────
{
  const p = preparar();
  const resto = p.qtd - 311;
  const sh = p.env.ss.getSheetByName('Baixas_Historico');
  sh.data.push([p.id, new Date(), 311, resto, 'ANA', p.qtd, '']);
  sh.data.push([p.id, new Date(), 0, resto, 'FATURAMENTO', resto, 'CHECKPOINT']); // ciclo já fechado
  const r = linhaDb(p.env, p.id);
  r[COL.QTD] = resto; r[COL.P] = 'SIM'; r[COL.V] = '{"BAIXA1":"ANA"}'; r[COL.W] = 'FAT-900'; r[COL.X] = 'BAIXA1';
  origemPassaA(p.env, p.id, resto); // origem = base do ciclo: não há reset a fazer
  const rel = noRelatorio(p.env);
  t('relatório: item marcado sem baixa no ciclo fica FORA (não fatura o saldo inteiro) e volta em semBaixa', () => {
    assert.ok(!rel.items.some(i => i.uniqueId === p.id));
    assert.ok(rel.semBaixa.some(i => i.uniqueId === p.id && i['QTD. ABERTA'] === resto && /ANA/.test(i.MARCAR_FATURAR_USUARIO)));
  });
  p.env.ctx.sincronizarDados();
  t('sync encerra a marcação vencida (P, V, W, X) sem gravar CHECKPOINT novo', () => {
    assert.deepStrictEqual(marcacao(p.env, p.id), ['', '', '', '']); assert.strictEqual(checkpoints(p.env, p.id).length, 1);
  });
  t('Historico_Decisoes registra o encerramento automático', () =>
    assert.ok(historico(p.env, 'MARCACAO_ENCERRADA').some(h => h[4] === p.id && /ciclo anterior/.test(h[13]))));
}

// ── 4. Servidor recusa marcar o que não tem baixa no ciclo (página desatualizada) ─────────────────────────────
{
  const p = preparar();
  const ctx = p.env.ctx;
  const semHist = ctx.marcarParaFaturar(p.id, p.linha, true, 'ANA', 'BAIXA1');
  t('recusa QTD aberta sem nenhuma baixa', () => { assert.strictEqual(semHist.success, false); assert.ok(semHist.semBaixaNoCiclo); });
  ctx.aplicarBaixa(p.id, p.linha, 100, 'ANA');
  const comBaixa = ctx.marcarParaFaturar(p.id, p.linha, true, 'ANA', 'BAIXA1');
  t('aceita com baixa no ciclo e registra MARCOU (com o baixado)', () => {
    assert.strictEqual(comBaixa.success, true);
    assert.ok(historico(p.env, 'MARCOU').some(h => h[4] === p.id && /ANA/.test(h[2]) && /baixado no ciclo: 100/.test(h[13])));
  });
  ctx.marcarParaFaturar(p.id, p.linha, false, 'ANA', 'BAIXA1');
  t('desmarcar registra DESMARCOU', () => assert.ok(historico(p.env, 'DESMARCOU').some(h => h[4] === p.id)));
  p.env.ss.getSheetByName('Baixas_Historico').data.push([p.id, new Date(), 0, p.qtd - 100, 'FATURAMENTO', p.qtd - 100, 'CHECKPOINT']);
  const depoisNf = ctx.marcarParaFaturar(p.id, p.linha, true, 'ANA', 'BAIXA1');
  t('recusa depois da NF (último registro = CHECKPOINT) — o caso da tela desatualizada', () => assert.strictEqual(depoisNf.success, false));
  ctx.aplicarBaixa(p.id, p.linha, p.qtd - 100, 'ANA');
  t('aceita item zerado', () => assert.strictEqual(ctx.marcarParaFaturar(p.id, p.linha, true, 'ANA', 'BAIXA1').success, true));
}

// ── 5. Linha deslocada (a limpeza diária apaga linhas): ações caem no item certo ──────────────────────────────
{
  const p = preparar();
  const sh = p.env.ss.getSheetByName('Relatorio_DB');
  const acima = sh.data[1][0];
  sh.deleteRow(2); // o item sobe uma linha; a tela ainda tem o número antigo
  const b = p.env.ctx.aplicarBaixa(p.id, p.linha, 50, 'ANA');
  const m = p.env.ctx.marcarParaFaturar(p.id, p.linha, true, 'ANA', 'BAIXA1');
  p.env.ctx.registrarLoteEmissao([{ planilhaLinha: p.linha, uniqueId: p.id, loteId: 'FAT-901' }]);
  const r = linhaDb(p.env, p.id);
  const vizinho = sh.data[p.linha - 1];
  t('baixa, marcação e lote vão para o item certo mesmo com a linha deslocada', () => {
    assert.ok(b.success && m.success, (b.error || '') + (m.error || ''));
    assert.strictEqual(Number(r[COL.QTD]), p.qtd - 50);
    assert.deepStrictEqual([r[COL.P], r[COL.W], r[COL.X]], ['SIM', 'FAT-901', 'BAIXA1']);
    assert.ok(vizinho[0] !== p.id && String(vizinho[COL.P] || '') === '' && String(vizinho[COL.W] || '') === '', 'o vizinho foi alterado');
    assert.ok(acima);
  });
}

R.fim();
