// Cenários do sync, do faturamento e do aviso de conferência, no simulador do Apps Script.
//   node testes/cenarios.js                   → base sintética (sem dado real)
//   node testes/cenarios.js --dados <pasta>   → export real (3 CSV) fora do Git
//
// Regra que protege tudo (incidente de 26/10/2026): NENHUM item vira Faturado sem usuário. Uma leitura da fonte
// sem o lote recém-chegado não pode faturar nada; o item vira PENDENTE (aviso na tela) e volta ao normal quando
// reaparece na origem.
const assert = require('assert');
const { criarRelatorio, montar, carregarBase, baseSintetica, linhasDB, dataDoLoteNovo, ehData, totalFonte } = require('./lib');

const R = criarRelatorio('cenarios.js');
const t = R.t;
const base = carregarBase();
console.log('Base:', base.origem);
const TLOTE = dataDoLoteNovo(base.imp);
const N = totalFonte(base.imp);

// ── Cenário do incidente: a leitura da fonte vem SEM o lote recém-chegado ─────────────────────────────────
let ids = null, marcados = [], qtdZero = null;
const env = montar(base, {
  ped: (p) => { ids = [...new Set(p.filter((r, i) => i >= 3 && ehData(r[12], TLOTE)).map(r => r[0]))]; return p.filter((r, i) => i < 3 || !ehData(r[12], TLOTE)); },
  imp: (m) => m.filter((r, i) => i < 3 || !ehData(r[13], TLOTE)),
  db: (d) => {
    marcados = ids.slice(0, 3); qtdZero = ids[3];
    return d.map((r, i) => {
      if (i === 0 || !ids.includes(r[0])) return r;
      const o = [...r]; o[14] = 'Ativo'; o[16] = '';
      if (marcados.includes(r[0])) { o[15] = 'SIM'; o[21] = '{"BAIXA1":"ANA"}'; o[23] = 'BAIXA1'; } // marcado por ANA no perfil BAIXA1
      if (r[0] === qtdZero) o[9] = 0;
      return o;
    });
  }
});
const nLote = ids.length;
const nPend = nLote - 3;
const faturadosAntes = linhasDB(env).filter(r => r.Status === 'Faturado' && !ids.includes(r.ID_UNICO)).length;
console.log(`Lote recém-chegado: ${nLote} itens de ${N}; fonte da rodada: ${N - nLote}`);
env.props.set('ULTIMO_TOTAL_FONTE', String(N));
env.ctx.processoAutomaticoCompleto();
let dep = linhasDB(env);
const por = (id) => dep.find(r => r.ID_UNICO === id);

t('item MARCADO pelo usuário que saiu da origem vira Faturado, com o nome gravado', () => {
  marcados.forEach(id => {
    const r = por(id);
    assert.strictEqual(r.Status, 'Faturado');
    assert.match(r.CONFERENCIA_SAIDA, /^FATURADO\|ANA \(BAIXA1\)\|/);
    assert.ok(r.DATA_STATUS instanceof Date);
  });
});
t('item NÃO marcado (QTD>0) que saiu vira PENDENTE e continua Ativo', () => {
  const r = por(ids[10]);
  assert.strictEqual(r.Status, 'Ativo');
  assert.match(r.CONFERENCIA_SAIDA, /^PENDENTE\|sistema\|/);
});
t('item com QTD=0 sem marcação NÃO é faturado sozinho (vira PENDENTE)', () => {
  const r = por(qtdZero);
  assert.strictEqual(r.Status, 'Ativo');
  assert.match(r.CONFERENCIA_SAIDA, /^PENDENTE/);
});
t('só os marcados foram faturados; o resto do lote ficou PENDENTE; nada mais mudou', () => {
  const lote = ids.map(por);
  assert.strictEqual(lote.filter(r => r.Status === 'Faturado').length, 3);
  assert.strictEqual(lote.filter(r => r.Status === 'Ativo' && /^PENDENTE/.test(r.CONFERENCIA_SAIDA)).length, nPend);
  assert.strictEqual(dep.filter(r => r.Status === 'Faturado' && !ids.includes(r.ID_UNICO)).length, faturadosAntes, 'Faturado fora do lote mudou');
  assert.strictEqual(dep.filter(r => /^PENDENTE/.test(r.CONFERENCIA_SAIDA || '') && !ids.includes(r.ID_UNICO)).length, 0, 'PENDENTE fora do lote');
});
t('Historico_Decisoes registra os 3 faturamentos com usuário', () => {
  const h = env.ss.getSheetByName('Historico_Decisoes');
  assert.ok(h, 'aba não criada');
  const linhas = h.data.slice(1).filter(r => r[1] === 'FATURADO');
  assert.strictEqual(linhas.length, 3);
  assert.ok(linhas.every(r => /ANA \(BAIXA1\)/.test(r[2])));
});
t('segunda rodada é estável: não refatura, não duplica, não registra de novo', () => {
  env.props.set('ULTIMO_TOTAL_FONTE', String(N - nLote));
  const fat = dep.filter(r => r.Status === 'Faturado').length;
  env.ctx.sincronizarDados();
  const d2 = linhasDB(env);
  assert.strictEqual(d2.length, dep.length, 'linhas');
  assert.strictEqual(d2.filter(r => r.Status === 'Faturado').length, fat);
  assert.strictEqual(d2.filter(r => /^PENDENTE/.test(r.CONFERENCIA_SAIDA || '')).length, nPend);
  assert.strictEqual(env.ss.getSheetByName('Historico_Decisoes').data.length, 4);
});

// ── Aviso de conferência: servidor ────────────────────────────────────────────────────────────────────────
t('fetchAllDataUnified devolve pendentesSaida e stats', () => {
  const r = env.ctx.fetchAllDataUnified(true);
  assert.ok(r.success, r.error);
  assert.strictEqual(r.pendentesSaida.length, nPend);
  assert.strictEqual(r.stats.pendentesSaida, nPend);
  const p = r.pendentesSaida[0];
  ['uniqueId', 'planilhaLinha', 'cliente', 'pedido', 'oc', 'descricao', 'tamanho', 'qtdAberta', 'saiuEm', 'motivo'].forEach(k => assert.ok(k in p, k));
  assert.ok(!/\[[0-9a-f]{8}-/.test(p.descricao), 'descrição sem o [uuid]');
});
const alvo = () => linhasDB(env).filter(r => r.Status === 'Ativo' && /^PENDENTE/.test(r.CONFERENCIA_SAIDA));
t('confirmarSaidaFonte recusa usuário PARCIAL, desconhecido e decisão inválida', () => {
  const r = alvo()[0];
  const parcial = env.ctx.confirmarSaidaFonte(r.ID_UNICO, 2, 'FATURADO', 'BETO');
  assert.strictEqual(parcial.success, false);
  assert.match(parcial.error, /TOTAL/);
  assert.strictEqual(env.ctx.confirmarSaidaFonte(r.ID_UNICO, 2, 'FATURADO', 'FULANO').success, false);
  assert.strictEqual(env.ctx.confirmarSaidaFonte(r.ID_UNICO, 2, 'XYZ', 'ANA').success, false);
  assert.strictEqual(linhasDB(env).find(q => q.ID_UNICO === r.ID_UNICO).Status, 'Ativo', 'nada pode ter mudado');
});
t('FATURADO por usuário TOTAL grava Status, DATA_STATUS, aviso e histórico — mesmo com a linha desatualizada', () => {
  const r = alvo()[0];
  const x = env.ctx.confirmarSaidaFonte(r.ID_UNICO, 9999, 'FATURADO', 'ANA'); // linha errada → resolve pelo ID
  assert.ok(x.success, x.error);
  const d = linhasDB(env).find(q => q.ID_UNICO === r.ID_UNICO);
  assert.strictEqual(d.Status, 'Faturado');
  assert.match(d.CONFERENCIA_SAIDA, /^FATURADO\|ANA\|/);
  assert.ok(d.DATA_STATUS instanceof Date);
  const h = env.ss.getSheetByName('Historico_Decisoes').data;
  assert.strictEqual(h[h.length - 1][2], 'ANA');
});
t('responder duas vezes o mesmo aviso é recusado', () => {
  const faturado = linhasDB(env).filter(r => /^FATURADO\|ANA\|/.test(r.CONFERENCIA_SAIDA))[0];
  const x = env.ctx.confirmarSaidaFonte(faturado.ID_UNICO, 2, 'ABERTO', 'ANA');
  assert.strictEqual(x.success, false);
  assert.match(x.error, /não está mais pendente/);
});
t('CANCELADO vira Excluido; ABERTO mantém Ativo e não é perguntado de novo', () => {
  const [a, b] = alvo();
  assert.ok(env.ctx.confirmarSaidaFonte(a.ID_UNICO, 2, 'CANCELADO', 'ANA').success);
  assert.ok(env.ctx.confirmarSaidaFonte(b.ID_UNICO, 2, 'ABERTO', 'ANA').success);
  const d = linhasDB(env);
  assert.strictEqual(d.find(r => r.ID_UNICO === a.ID_UNICO).Status, 'Excluido');
  const rb = d.find(r => r.ID_UNICO === b.ID_UNICO);
  assert.strictEqual(rb.Status, 'Ativo');
  assert.match(rb.CONFERENCIA_SAIDA, /^ABERTO\|ANA\|/);
  assert.ok(!env.ctx.fetchAllDataUnified(true).pendentesSaida.some(p => p.uniqueId === b.ID_UNICO));
});

// ── Recuperação: os itens voltam à origem ─────────────────────────────────────────────────────────────────
t('quando a origem traz os itens de volta, a pendência some e o status continua Ativo', () => {
  const imp = env.ss.getSheetByName('DADOS_IMPORTADOS');
  imp.data = structuredClone(base.imp);
  imp.getRange('H2').setValue('26/10/2026 14:00:00'); // nova importação
  env.ss.getSheetByName('PEDIDOS').data = structuredClone(base.ped);
  env.props.set('ULTIMO_TOTAL_FONTE', String(N - nLote));
  env.ctx.processoAutomaticoCompleto();
  const d = linhasDB(env);
  const pend = d.filter(r => /^(PENDENTE|ABERTO)/.test(r.CONFERENCIA_SAIDA || ''));
  assert.strictEqual(pend.length, 0, `restaram ${pend.length} pendência(s)`);
  const voltou = ids.map(id => d.find(r => r.ID_UNICO === id)).filter(Boolean);
  assert.ok(voltou.length >= nLote - 6, `itens do lote no DB: ${voltou.length} de ${nLote}`);
  assert.ok(voltou.filter(r => r.Status === 'Ativo').length >= nLote - 6 - 4, 'quase todo o lote deve estar Ativo');
});

// ── Concorrência: baixa do usuário durante o sync não é desfeita ──────────────────────────────────────────
t('_mesclarAlteracoesConcorrentes_ preserva a QTD alterada pelo usuário e cancela faturamento desmarcado', () => {
  const sh = env.ss.getSheetByName('Relatorio_DB');
  const snap = sh.data.slice(1).map(r => [...r]); // leitura do sync (snapshot)
  const linhaA = 5, linhaB = 6;
  sh.data[linhaA - 1][9] = 7;   // usuário deu baixa depois do snapshot
  sh.data[linhaB - 1][15] = ''; // usuário desmarcou
  const novaA = [...snap[linhaA - 2]].slice(0, 21); novaA[9] = 999; novaA[12] = 'novo';
  const novaB = [...snap[linhaB - 2]]; novaB[14] = 'Faturado';
  const ups = [
    { linha: linhaA, dados: novaA, id: 'a', colsIntencionais: [12] },
    { linha: linhaB, dados: novaB, id: 'b', exigeMarcacao: true, colsIntencionais: [14] }
  ];
  env.ctx._mesclarAlteracoesConcorrentes_(sh, snap, ups);
  assert.strictEqual(ups[0].dados[9], 7, 'a QTD do usuário deve ser preservada');
  assert.strictEqual(ups[0].dados[12], 'novo', 'a mudança intencional do sync deve ser mantida');
  assert.strictEqual(ups[1].cancelado, true, 'faturamento desmarcado no meio do sync deve ser cancelado');
});

// ── Trava da importação ───────────────────────────────────────────────────────────────────────────────────
t('processoImportacao pula a rodada quando a trava do sync está ocupada', () => {
  let chamou = 0;
  env.ctx.importarDadosExternos = () => { chamou++; return { success: false, erro: 'x' }; };
  const orig = env.ctx.LockService.getScriptLock;
  env.ctx.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {}, waitLock() {} });
  env.ctx.processoImportacao();
  env.ctx.LockService.getScriptLock = orig;
  assert.strictEqual(chamou, 0, 'não pode importar com a trava ocupada');
  env.ctx.processoImportacao();
  assert.strictEqual(chamou, 1, 'com a trava livre importa');
});

// ── Menu "sinalizar itens que já saíram da origem" ────────────────────────────────────────────────────────
t('faturarItensForaDaFonte só sinaliza PENDENTE, nunca fatura', () => {
  const antes = linhasDB(env);
  const fatAntes = antes.filter(r => r.Status === 'Faturado').length;
  const alvoPed = antes.find(r => r.Status === 'Ativo' && !r.CONFERENCIA_SAIDA).PEDIDO;
  const imp = env.ss.getSheetByName('DADOS_IMPORTADOS'), ped = env.ss.getSheetByName('PEDIDOS');
  imp.data = imp.data.filter((r, i) => i < 3 || String(r[4]) !== String(alvoPed)); // some o pedido inteiro da origem
  ped.data = ped.data.filter((r, i) => i < 3 || String(r[4]) !== String(alvoPed));
  env.ctx.faturarItensForaDaFonte();
  const dep2 = linhasDB(env);
  assert.strictEqual(dep2.filter(r => r.Status === 'Faturado').length, fatAntes, 'nenhum novo Faturado');
  assert.ok(dep2.filter(r => String(r.PEDIDO) === String(alvoPed) && /^PENDENTE/.test(r.CONFERENCIA_SAIDA || '')).length > 0, 'deveria sinalizar');
});
t('marcarFaturado e confirmarTodosAlertas não existem mais (faturavam sem usuário)', () => {
  assert.strictEqual(typeof env.ctx.marcarFaturado, 'undefined');
  assert.strictEqual(typeof env.ctx.confirmarTodosAlertas, 'undefined');
  assert.strictEqual(typeof env.ctx.confirmarTodosAlertasMenu, 'undefined');
});

// ── Válvula de segurança: fonte que encolhe de repente ────────────────────────────────────────────────────
t('queda brusca da fonte (>15%) não sinaliza nem fatura nada nessa rodada', () => {
  const e = montar(base, {
    imp: (m) => m.filter((r, i) => i < 3 || i % 3 !== 0), // some ~1/3 das linhas
    ped: (p) => p.filter((r, i) => i < 3 || i % 3 !== 0)
  });
  const antes = linhasDB(e);
  e.props.set('ULTIMO_TOTAL_FONTE', String(N));
  e.ctx.processoAutomaticoCompleto();
  const dep3 = linhasDB(e);
  assert.strictEqual(dep3.filter(r => r.Status === 'Faturado').length, antes.filter(r => r.Status === 'Faturado').length, 'faturou numa rodada suspeita');
  assert.strictEqual(dep3.filter(r => /^PENDENTE/.test(r.CONFERENCIA_SAIDA || '')).length, 0, 'sinalizou numa rodada suspeita');
});

// ── Estabilidade e reset ──────────────────────────────────────────────────────────────────────────────────
t('fonte sem nenhuma mudança: nada é faturado, sinalizado ou duplicado', () => {
  const e = montar(base, {});
  const antes = linhasDB(e);
  e.props.set('ULTIMO_TOTAL_FONTE', String(N));
  e.ctx.processoAutomaticoCompleto();
  const d = linhasDB(e);
  assert.strictEqual(d.length, antes.length, 'linhas');
  assert.strictEqual(d.filter(r => r.Status === 'Faturado').length, antes.filter(r => r.Status === 'Faturado').length);
  assert.strictEqual(d.filter(r => /^PENDENTE/.test(r.CONFERENCIA_SAIDA || '')).length, 0);
});
t('reset do zero: tudo Ativo, coluna AA criada, IDs únicos e rodada seguinte estável', () => {
  const e = montar(base, {});
  const sh = e.ss.getSheetByName('Relatorio_DB');
  e.ctx.resetarEReprocessarSilencioso();
  const d = linhasDB(e);
  assert.strictEqual(d.length, N, 'uma linha por item da fonte');
  assert.ok(d.every(r => r.Status === 'Ativo'));
  assert.strictEqual(sh.data[0][26], 'CONFERENCIA_SAIDA');
  assert.ok(sh.getMaxColumns() >= 27);
  assert.ok(d.every(r => !r.CONFERENCIA_SAIDA) && d.every(r => r.CODIGO_FIXO));
  assert.strictEqual(new Set(d.map(r => r.ID_UNICO)).size, d.length, 'IDs únicos');
  e.props.set('ULTIMO_TOTAL_FONTE', String(N));
  e.ctx.sincronizarDados();
  const d2 = linhasDB(e);
  assert.strictEqual(d2.length, N);
  assert.ok(d2.every(r => r.Status === 'Ativo' && !r.CONFERENCIA_SAIDA));
});

// ── Desempenho: o nº de chamadas a Utilities.formatDate não pode crescer com o nº de linhas ───────────────
if (process.argv.includes('--dados')) {
  R.pular('formatDate não cresce com o nº de linhas', 'só faz sentido com a base sintética');
} else {
  t('formatDate não cresce com o nº de linhas (ETAPA 0 chegou a 306 s em 26/10/2026)', () => {
    const chamadas = (escala) => {
      const b = baseSintetica(escala);
      const e = montar(b, {});
      e.ss.getSheetByName('DADOS_IMPORTADOS').getRange('H2').setValue('26/10/2026 15:00:00');
      e.props.set('ULTIMO_TOTAL_FONTE', String(totalFonte(b.imp)));
      e.ctx.processoAutomaticoCompleto();
      return { n: totalFonte(b.imp), chamadas: e.contadores.formatDate };
    };
    const pequena = chamadas(10), grande = chamadas(60);
    console.log(`    ${pequena.n} linhas → ${pequena.chamadas} chamadas; ${grande.n} linhas → ${grande.chamadas} chamadas`);
    assert.ok(grande.n > pequena.n * 3, 'a base grande deveria ter bem mais linhas');
    assert.ok(grande.chamadas <= pequena.chamadas * 1.5 + 20, `cresceu com as linhas: ${pequena.chamadas} → ${grande.chamadas}`);
    assert.ok(grande.chamadas < grande.n, `mais chamadas (${grande.chamadas}) do que linhas (${grande.n})`);
  });
}

R.fim();
