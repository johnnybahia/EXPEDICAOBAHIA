// Sequência por OC (aba "original" → PEDIDOS col V → Relatorio_DB col Y).
//   node testes/sequencia.js
//
// Regras provadas aqui:
//  - a OC INTEIRA é numerada se ao menos 1 item tem DT. ENTREGA >= 04/11/2026; OC toda anterior (ou sem data) fica sem número;
//  - o número é a posição do item na aba "original" (não a ordem do DADOS_IMPORTADOS);
//  - sequência que já está em PEDIDOS chega ao DB mesmo com o item já existente lá (defeito: só itens novos chegavam);
//  - número gravado é imutável (nova importação, QTD alterada, aba "original" reordenada);
//  - item elegível que a aba "original" não tem fica SEM número (nunca chuta) e é contado.
process.env.TZ = 'America/Fortaleza'; // o script compara datas pelo dia local; fixa o fuso para o teste não depender da máquina
const assert = require('assert');
const { criarRelatorio, planilhaVazia, linhasDB, gerarImp } = require('./lib');
const { dataFortaleza } = require('./gasmock');

const R = criarRelatorio('sequencia.js');
const t = R.t;

const OC_ANTES = '16100000';   // todas as entregas antes do corte        → sem número
const OC_MISTA = '16100001';   // 1 item antes do corte, 11 depois        → OC inteira numerada
const OC_DEPOIS = '16100002';  // todas depois do corte                   → numerada
const OC_SEM_DATA = '16100003'; // DT. ENTREGA vazia                       → sem número
const OC_IRMAS = '16199000';   // 4 itens 100% idênticos (mm)             → 4 números distintos
const ANTES = dataFortaleza(2026, 11, 2), DEPOIS = dataFortaleza(2026, 11, 10);

function entrega(oc, linha) {
  if (oc === OC_MISTA) return String(linha[7]).includes('M1000 ') ? ANTES : DEPOIS; // k=0 é o único item antes do corte
  if (oc === OC_DEPOIS || oc === OC_IRMAS) return DEPOIS;
  if (oc === OC_SEM_DATA) return '';
  return ANTES;
}

/** Planilha com PEDIDOS e Relatorio_DB gerados pelo sistema a partir de uma DADOS_IMPORTADOS controlada (sem aba "original"). */
function montarEnv() {
  const imp = gerarImp(6).map((r, i) => {
    if (i < 3) return r;
    const o = [...r];
    o[14] = entrega(String(o[9]), o);
    return o;
  });
  const env = planilhaVazia();
  env.ss.addSheet('DADOS_IMPORTADOS', imp, 25);
  env.ss.addSheet('PEDIDOS', [['', ''], ['', ''], ['', '']], 23);
  env.ss.addSheet('Relatorio_DB', [], 27);
  env.ctx.resetarEReprocessarSilencioso();
  return env;
}

/** Cria a aba "original" (sem cabeçalho; layout A..N confirmado) a partir da DADOS_IMPORTADOS, na ordem dada. */
function criarOriginal(env, ordenar) {
  const imp = env.ss.getSheetByName('DADOS_IMPORTADOS').data.slice(3).filter(r => String(r[1] || '').trim());
  const linhas = imp.map(r => [r[1], r[2], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[12], r[13], r[14], r[15], r[11]]);
  const ordem = ordenar(linhas);
  env.ss.addSheet('original', ordem, 14);
  return ordem;
}
/** Mapa "OC|descrição" → posição (1..n) do item dentro da sua OC na aba "original". */
function esperado(original) {
  const cont = {}, mapa = new Map();
  original.forEach(r => { const oc = String(r[7]); cont[oc] = (cont[oc] || 0) + 1; mapa.set(`${oc}|${r[5]}`, cont[oc]); });
  return mapa;
}

const seqDB = (env, oc) => linhasDB(env).filter(r => String(r['ORD. COMPRA']) === oc);
const seqDe = (r) => String(r.SEQUENCIA === undefined || r.SEQUENCIA === null ? '' : r.SEQUENCIA).trim();
const descBase = (r) => String(r['DESCRIÇÃO']).replace(/\s*\[[0-9a-f-]{36}\]\s*$/i, '');
const colV = (env) => env.ss.getSheetByName('PEDIDOS').data.slice(3).filter(r => String(r[1] || '').trim());

// ── Estado inicial: sem aba "original" nada é numerado ────────────────────────────────────────────────────
const env = montarEnv();
t('sem a aba "original" nada é numerado (nem chuta)', () => {
  assert.ok(linhasDB(env).length > 0);
  assert.ok(linhasDB(env).every(r => seqDe(r) === ''));
  assert.ok(colV(env).every(r => String(r[21] || '').trim() === ''));
});

// ── numerarSequenciasAgora: a função do menu ──────────────────────────────────────────────────────────────
const original = criarOriginal(env, (l) => [...l].reverse()); // ordem da "original" ≠ ordem do DADOS_IMPORTADOS
const esp = esperado(original);
let alertas = [];
env.ctx.SpreadsheetApp.getUi = () => ({ alert: (...a) => { alertas.push(a); return 'OK'; }, ButtonSet: { OK: 'OK' } });
env.ctx.numerarSequenciasAgora();

t('OC mista: a OC inteira é numerada, inclusive o item com entrega antes do corte', () => {
  const itens = seqDB(env, OC_MISTA);
  assert.strictEqual(itens.length, 12);
  const antigo = env.ss.getSheetByName('DADOS_IMPORTADOS').data.slice(3).filter(r => String(r[9]) === OC_MISTA && r[14].getTime() === ANTES.getTime());
  assert.strictEqual(antigo.length, 1, 'a OC mista precisa ter exatamente 1 item com entrega antes do corte');
  itens.forEach(r => assert.strictEqual(Number(seqDe(r)), esp.get(`${OC_MISTA}|${descBase(r)}`), descBase(r)));
});
t('OC com todas as entregas depois do corte: numerada pela posição na aba "original" (não pela ordem do DADOS_IMPORTADOS)', () => {
  const itens = seqDB(env, OC_DEPOIS);
  itens.forEach(r => assert.strictEqual(Number(seqDe(r)), esp.get(`${OC_DEPOIS}|${descBase(r)}`), descBase(r)));
  const imp = env.ss.getSheetByName('DADOS_IMPORTADOS').data.slice(3).filter(r => String(r[9]) === OC_DEPOIS);
  const primeiro = itens.find(r => descBase(r) === String(imp[0][7]));
  assert.strictEqual(Number(seqDe(primeiro)), 12, 'o 1º do DADOS_IMPORTADOS é o último da "original" (ordem invertida)');
});
t('sequência de cada OC é 1..n sem repetir nem pular', () => {
  [OC_MISTA, OC_DEPOIS, OC_IRMAS].forEach(oc => {
    const nums = seqDB(env, oc).map(r => Number(seqDe(r))).sort((a, b) => a - b);
    assert.deepStrictEqual(nums, nums.map((_, i) => i + 1), `OC ${oc}: ${nums}`);
  });
});
t('4 itens 100% idênticos recebem 4 números distintos', () => {
  const nums = seqDB(env, OC_IRMAS).map(r => seqDe(r));
  assert.strictEqual(nums.length, 4);
  assert.strictEqual(new Set(nums).size, 4);
});
t('OC com todas as entregas antes do corte, ou sem data, NÃO é numerada (PEDIDOS e DB)', () => {
  [OC_ANTES, OC_SEM_DATA].forEach(oc => {
    assert.ok(seqDB(env, oc).length > 0);
    assert.ok(seqDB(env, oc).every(r => seqDe(r) === ''), `DB da OC ${oc}`);
    assert.ok(colV(env).filter(r => String(r[9]) === oc).every(r => String(r[21] || '').trim() === ''), `PEDIDOS da OC ${oc}`);
  });
});
t('a função informa o resumo: nada sem número, DB = PEDIDOS', () => {
  const d = env.ctx._diagnosticoSequencias_();
  assert.strictEqual(d.semNumero, 0);
  assert.strictEqual(d.numeradosPedidos, d.itens);
  assert.strictEqual(d.numeradosDB, d.itens);
  assert.strictEqual(d.ocs, 3, 'elegíveis: MISTA, DEPOIS e IRMAS (as demais OCs têm entrega antes do corte)');
  assert.strictEqual(d.itens, 12 + 12 + 4);
});

// ── Imutabilidade ─────────────────────────────────────────────────────────────────────────────────────────
const fotografia = () => Object.fromEntries(linhasDB(env).filter(r => seqDe(r)).map(r => [r.ID_UNICO, seqDe(r)]));
const antes = fotografia();
t('nova importação + QTD alterada + aba "original" reordenada: nenhum número muda', () => {
  const imp = env.ss.getSheetByName('DADOS_IMPORTADOS');
  imp.data.forEach((r, i) => { if (i >= 3 && String(r[9]) === OC_DEPOIS) r[10] = Number(r[10]) - 7; }); // baixa parcial na origem: QTD muda
  imp.getRange('H2').setValue('03/11/2026 09:00:00'); // nova importação
  env.ss.getSheetByName('original').data.reverse();    // outra ordem na aba
  env.ctx.processoAutomaticoCompleto();
  env.ctx.numerarSequenciasAgora();
  const depois = fotografia();
  assert.deepStrictEqual(depois, antes);
});
t('executar a função de novo é idempotente (não duplica nem renumera)', () => {
  const linhas = linhasDB(env).length;
  env.ctx.numerarSequenciasAgora();
  env.ctx.numerarSequenciasAgora();
  assert.deepStrictEqual(fotografia(), antes);
  assert.strictEqual(linhasDB(env).length, linhas, 'não pode criar linhas');
});

// ── Defeito corrigido: V já existe no PEDIDOS e o item já está no DB ──────────────────────────────────────
t('sequência que já está no PEDIDOS chega ao DB mesmo com o item já existente lá', () => {
  const e = montarEnv();                                  // PEDIDOS e DB prontos, sem números
  const ped = e.ss.getSheetByName('PEDIDOS');
  const alvo = ped.data.slice(3).filter(r => String(r[9]) === OC_DEPOIS);
  alvo.forEach((r, i) => { r[21] = i + 1; });             // número atribuído depois, só no PEDIDOS
  const legado = ped.data.slice(3).filter(r => String(r[9]) === OC_ANTES);
  legado.forEach((r, i) => { r[21] = i + 1; });           // OC fora do corte: número legado NÃO sobe ao DB
  assert.ok(seqDB(e, OC_DEPOIS).every(r => seqDe(r) === ''));
  e.props.set('ULTIMO_TOTAL_FONTE', String(linhasDB(e).length));
  e.ctx.processoAutomaticoCompleto();
  assert.deepStrictEqual(seqDB(e, OC_DEPOIS).map(seqDe).sort((a, b) => a - b), alvo.map((_, i) => String(i + 1)));
  assert.ok(seqDB(e, OC_ANTES).every(r => seqDe(r) === ''), 'OC fora do corte não pode ganhar número no DB');
});

// ── Item elegível que a aba "original" não tem ────────────────────────────────────────────────────────────
t('item elegível ausente da aba "original" fica SEM número e aparece no resumo', () => {
  const e = montarEnv();
  const orig = criarOriginal(e, (l) => l.filter(r => !(String(r[7]) === OC_DEPOIS && String(r[5]).includes('M1003 '))));
  e.ctx.SpreadsheetApp.getUi = () => ({ alert: () => 'OK', ButtonSet: { OK: 'OK' } });
  e.ctx.numerarSequenciasAgora();
  const sem = seqDB(e, OC_DEPOIS).filter(r => seqDe(r) === '');
  assert.strictEqual(sem.length, 1);
  assert.ok(descBase(sem[0]).includes('M1003 '));
  const d = e.ctx._diagnosticoSequencias_();
  assert.strictEqual(d.semNumero >= 1, true);
  assert.ok(d.exemplos.some(x => x.includes(OC_DEPOIS)));
  assert.ok(orig.length > 0);
});

// ── OC que entra na faixa depois ──────────────────────────────────────────────────────────────────────────
t('OC que passa a ter entrega >= corte só depois é numerada então, com a posição da "original"', () => {
  const e = montarEnv();
  const orig = criarOriginal(e, (l) => [...l].reverse());
  e.ctx.SpreadsheetApp.getUi = () => ({ alert: () => 'OK', ButtonSet: { OK: 'OK' } });
  e.ctx.numerarSequenciasAgora();
  assert.ok(seqDB(e, OC_SEM_DATA).every(r => seqDe(r) === ''), 'começa sem número');
  const imp = e.ss.getSheetByName('DADOS_IMPORTADOS');
  imp.data.forEach((r, i) => { if (i >= 3 && String(r[9]) === OC_SEM_DATA) r[14] = DEPOIS; });
  imp.getRange('H2').setValue('03/11/2026 10:00:00');
  e.ctx.numerarSequenciasAgora();
  const esp2 = esperado(orig);
  const itens = seqDB(e, OC_SEM_DATA);
  assert.ok(itens.length > 0);
  itens.forEach(r => assert.strictEqual(Number(seqDe(r)), esp2.get(`${OC_SEM_DATA}|${descBase(r)}`)));
});

// ── Sistema pausado / sem aba "original" ──────────────────────────────────────────────────────────────────
t('sem a aba "original" a função avisa e não altera nada', () => {
  const e = montarEnv();
  let msg = '';
  e.ctx.SpreadsheetApp.getUi = () => ({ alert: (titulo) => { msg = titulo; return 'OK'; }, ButtonSet: { OK: 'OK' } });
  const antesDB = JSON.stringify(e.ss.getSheetByName('Relatorio_DB').data);
  e.ctx.numerarSequenciasAgora();
  assert.match(msg, /original/);
  assert.strictEqual(JSON.stringify(e.ss.getSheetByName('Relatorio_DB').data), antesDB);
});

// ── RESET COMPLETO: backup antes, restauração depois ──────────────────────────────────────────────────────
function uiGravando(msgs) {
  return { alert: (t, m) => { msgs.push([String(t), String(m || '')]); return 'YES'; }, ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES' } };
}
/** Env numerado (original em ordem invertida) e utilitários para faturar/atualizar. */
function envNumerado() {
  const e = montarEnv();
  const msgs = [];
  e.ctx.SpreadsheetApp.getUi = () => uiGravando(msgs);
  const refazOriginal = () => { e.ss.sheets.delete('original'); criarOriginal(e, (l) => [...l].reverse()); };
  refazOriginal();
  e.ctx.numerarSequenciasAgora();
  let ts = 0;
  const importa = () => {
    const imp = e.ss.getSheetByName('DADOS_IMPORTADOS');
    imp.getRange('H2').setValue(`03/11/2026 11:${String(++ts).padStart(2, '0')}:00`);
    e.props.set('ULTIMO_TOTAL_FONTE', String(imp.data.slice(3).filter(r => String(r[1] || '').trim()).length));
  };
  return { e, msgs, refazOriginal, importa };
}
const porItem = (e) => Object.fromEntries(linhasDB(e).map(r => [`${r['ORD. COMPRA']}|${descBase(r)}|${r.TAMANHO}|${r.LOTE}|${r.ID_UNICO}`, seqDe(r)]));
const porDesc = (e, oc) => Object.fromEntries(linhasDB(e).filter(r => String(r['ORD. COMPRA']) === oc).map(r => [`${descBase(r)}`, seqDe(r)]));

t('RESET COMPLETO com itens já faturados e a "original" encolhida: os itens abertos mantêm a sequência', () => {
  const { e, msgs, refazOriginal, importa } = envNumerado();
  const antes = porDesc(e, OC_DEPOIS), antesMista = porDesc(e, OC_MISTA);
  assert.deepStrictEqual(Object.values(antes).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  // itens 7..12 faturados: saem da fonte; a "original" encolhe
  const imp = e.ss.getSheetByName('DADOS_IMPORTADOS');
  const faturados = Object.keys(antes).filter(k => Number(antes[k]) >= 7);
  faturados.forEach(alvo => { const i = imp.data.findIndex((r, ix) => ix >= 3 && String(r[9]) === OC_DEPOIS && String(r[7]) === alvo); imp.data.splice(i, 1); });
  refazOriginal(); importa(); e.ctx.processoAutomaticoCompleto();
  e.ctx.resetarEReprocessar();                       // diálogo responde SIM
  const dep = porDesc(e, OC_DEPOIS);
  assert.strictEqual(Object.keys(dep).length, 6, 'sobram os 6 itens abertos');
  Object.keys(dep).forEach(k => assert.strictEqual(dep[k], antes[k], `${k}: ${antes[k]} → ${dep[k]}`));
  assert.deepStrictEqual(porDesc(e, OC_MISTA), antesMista, 'outra OC não pode mudar');
  const colV = e.ss.getSheetByName('PEDIDOS').data.slice(3).filter(r => String(r[9]) === OC_DEPOIS).map(r => Number(r[21])).sort((a, b) => a - b);
  assert.deepStrictEqual(colV, [1, 2, 3, 4, 5, 6], 'PEDIDOS (col V) também restaurado');
  assert.match(msgs[msgs.length - 1][1], /Depois do reset, 6 de 6 item\(ns\) das OCs elegíveis|Depois do reset, \d+ de \d+ item/);
  assert.ok(e.ss.getSheetByName('BACKUP_SEQUENCIA'), 'aba de backup criada');
});
t('o backup guarda ID, UUID, OC, número, produto e status, e só dos itens numerados', () => {
  const { e } = envNumerado();
  const n = linhasDB(e).filter(r => seqDe(r)).length;
  e.ctx.resetarEReprocessar();
  const bk = e.ss.getSheetByName('BACKUP_SEQUENCIA');
  assert.deepStrictEqual(bk.data[0], ['BACKUP_EM', 'MOTIVO', 'ID_UNICO', 'CODIGO_FIXO', 'OC', 'SEQUENCIA', 'CLIENTE', 'PEDIDO', 'DESCRIÇÃO', 'TAMANHO', 'LOTE', 'DATA_RECEB', 'STATUS']);
  const linhas = bk.data.slice(1).filter(r => r[2]);
  assert.strictEqual(linhas.length, n);
  assert.ok(linhas.every(r => r[3] && r[4] && Number(r[5]) > 0 && r[8] && !/\[[0-9a-f-]{36}\]/.test(r[8])));
});
t('sem item numerado não grava cópia vazia (nem cria a aba)', () => {
  const e = montarEnv();
  e.ctx.resetarEReprocessar();
  assert.strictEqual(e.ss.getSheetByName('BACKUP_SEQUENCIA'), null);
});
t('restauração por identidade (OC|pedido|produto|tamanho|lote|data) quando o UUID do backup não casa', () => {
  const { e } = envNumerado();
  const antes = porDesc(e, OC_DEPOIS);
  e.ctx.resetarEReprocessar();
  const bk = e.ss.getSheetByName('BACKUP_SEQUENCIA');
  bk.data.slice(1).forEach(r => { if (r[3]) r[3] = 'uuid-que-nao-existe'; });   // UUID do backup deixa de casar
  e.ss.getSheetByName('PEDIDOS').data.slice(3).forEach(r => { r[21] = ''; });     // e a sequência some do PEDIDOS
  e.ss.getSheetByName('Relatorio_DB').data.forEach((r, i) => { if (i > 0) r[24] = ''; });
  e.ctx.restaurarSequenciaDoBackupMenu();
  assert.deepStrictEqual(porDesc(e, OC_DEPOIS), antes);
});
t('menu "Restaurar sequência": devolve ao PEDIDOS e ao DB, sem sobrescrever número existente', () => {
  const { e } = envNumerado();
  const antes = porDesc(e, OC_DEPOIS);
  e.ctx.resetarEReprocessar();
  const db = e.ss.getSheetByName('Relatorio_DB');
  const ped = e.ss.getSheetByName('PEDIDOS');
  db.data.forEach((r, i) => { if (i > 0 && String(r[8]) === OC_DEPOIS) r[24] = ''; });
  ped.data.slice(3).forEach(r => { if (String(r[9]) === OC_DEPOIS) r[21] = ''; });
  const umaOutra = ped.data.slice(3).find(r => String(r[9]) === OC_MISTA);
  const doBackup = umaOutra[21];
  assert.ok(Number(doBackup) > 0 && Number(doBackup) !== 777);
  umaOutra[21] = 777;                                    // número que já existe no PEDIDOS (≠ backup): não pode ser tocado
  e.ctx.restaurarSequenciaDoBackupMenu();
  assert.deepStrictEqual(porDesc(e, OC_DEPOIS), antes);
  assert.strictEqual(Number(umaOutra[21]), 777, 'número existente não pode ser sobrescrito pela restauração');
});
t('conflito: backup pede número já usado por outro item da OC → não restaura (nunca repete número)', () => {
  const { e } = envNumerado();
  e.ctx.resetarEReprocessar();
  const ped = e.ss.getSheetByName('PEDIDOS');
  const doOc = ped.data.slice(3).filter(r => String(r[9]) === OC_DEPOIS);
  const [a, b] = doOc;
  const seqA = Number(a[21]);
  b[21] = '';                                            // b perde o número; o backup dele agora "pede" o número de a
  const bk = e.ss.getSheetByName('BACKUP_SEQUENCIA');
  bk.data.slice(1).forEach(r => { if (String(r[3]) === String(b[18])) r[5] = seqA; });
  e.ctx._restaurarSequenciaDoBackup_();
  const nums = ped.data.slice(3).filter(r => String(r[9]) === OC_DEPOIS).map(r => Number(r[21])).filter(Boolean);
  assert.strictEqual(new Set(nums).size, nums.length, 'número repetido na OC');
  assert.strictEqual(String(b[21]), '', 'o item em conflito fica sem número');
});
t('mantém só as últimas 5 cópias do backup', () => {
  const { e } = envNumerado();
  const orig = e.ctx._formatarDataRapido_;
  let n = 0;
  e.ctx._formatarDataRapido_ = (d, p) => (p === 'dd/MM/yyyy HH:mm:ss' ? `cópia ${String(++n).padStart(2, '0')}` : orig(d, p));
  for (let i = 0; i < 8; i++) e.ctx._salvarBackupSequencia_('teste');
  e.ctx._formatarDataRapido_ = orig;
  const rotulos = [...new Set(e.ss.getSheetByName('BACKUP_SEQUENCIA').data.slice(1).filter(r => r[0]).map(r => r[0]))];
  assert.deepStrictEqual(rotulos, ['cópia 04', 'cópia 05', 'cópia 06', 'cópia 07', 'cópia 08']);
});
/** Fatura (remove da fonte) os itens da OC_DEPOIS com número <= corte e encolhe a "original": as posições dos que ficam deslocam. */
function faturarPrimeiros(ctxEnv, corte) {
  const { e, refazOriginal, importa } = ctxEnv;
  const antes = porDesc(e, OC_DEPOIS);
  const imp = e.ss.getSheetByName('DADOS_IMPORTADOS');
  Object.keys(antes).filter(k => Number(antes[k]) <= corte).forEach(alvo => {
    const i = imp.data.findIndex((r, ix) => ix >= 3 && String(r[9]) === OC_DEPOIS && String(r[7]) === alvo);
    imp.data.splice(i, 1);
  });
  refazOriginal(); importa(); e.ctx.processoAutomaticoCompleto();
  return Object.fromEntries(Object.entries(antes).filter(([, v]) => Number(v) > corte));
}
t('RESET COMPLETO quando os PRIMEIROS itens foram faturados (posições da "original" deslocam): ninguém é renumerado', () => {
  const amb = envNumerado();
  const restantes = faturarPrimeiros(amb, 3);                 // 4..12 ficam; na "original" encolhida viram as posições 1..9
  assert.strictEqual(Object.keys(restantes).length, 9);
  amb.e.ctx.resetarEReprocessar();
  assert.deepStrictEqual(porDesc(amb.e, OC_DEPOIS), restantes);
});
t('RESET sem backup disponível: o item herda o número da própria linha do PEDIDOS (não deriva da "original" encolhida)', () => {
  const amb = envNumerado();
  const restantes = faturarPrimeiros(amb, 3);
  amb.e.ctx._salvarBackupSequencia_ = () => ({ gravados: 0 });  // nenhum backup é gravado
  amb.e.ctx.resetarEReprocessar();
  assert.strictEqual(amb.e.ss.getSheetByName('BACKUP_SEQUENCIA'), null);
  assert.deepStrictEqual(porDesc(amb.e, OC_DEPOIS), restantes);
});
t('pior caso: PEDIDOS e DB apagados (UUIDs perdidos) depois de faturar os primeiros: o backup devolve os mesmos números', () => {
  const amb = envNumerado();
  const restantes = faturarPrimeiros(amb, 3);
  const { e, importa } = amb;
  e.ctx._salvarBackupSequencia_('antes do desastre');
  const ped = e.ss.getSheetByName('PEDIDOS'); ped.data = ped.data.slice(0, 3);   // PEDIDOS inteiro some (inclusive UUIDs)
  const db = e.ss.getSheetByName('Relatorio_DB'); db.data = [db.data[0]];        // DB some
  importa(); e.ctx.sincronizarPedidosComFonte(true);
  const v = e.ss.getSheetByName('PEDIDOS').data.slice(3).filter(r => String(r[9]) === OC_DEPOIS).map(r => Number(r[21])).sort((a, b) => a - b);
  assert.deepStrictEqual(v, [4, 5, 6, 7, 8, 9, 10, 11, 12], 'o sync já deve devolver o número do backup, não derivar da "original" encolhida');
  e.ctx.restaurarSequenciaDoBackupMenu();
  assert.deepStrictEqual(porDesc(e, OC_DEPOIS), restantes);
});
t('sem backup, o que não é do backup continua sendo derivado da "original" (item novo em OC nova)', () => {
  const amb = envNumerado();
  amb.e.ctx.resetarEReprocessar();                              // cria o backup
  const imp = amb.e.ss.getSheetByName('DADOS_IMPORTADOS');
  const molde = imp.data.slice(3).find(r => String(r[9]) === OC_DEPOIS);
  for (let k = 1; k <= 3; k++) { const n = [...molde]; n[9] = '16888000'; n[7] = `ELAST. NOVO${k} COR ${k}`; n[8] = `${60 + k}CM`; n[12] = `OS-NOVO-${k}`; imp.data.push(n); }
  amb.refazOriginal(); amb.importa(); amb.e.ctx.processoAutomaticoCompleto();
  const novos = seqDB(amb.e, '16888000').map(r => Number(seqDe(r))).sort((a, b) => a - b);
  assert.deepStrictEqual(novos, [1, 2, 3]);
});

t('RESET: OC cujos itens com entrega >= corte foram todos faturados mantém o número dos itens antigos que ficaram abertos', () => {
  const amb = envNumerado();
  const antes = porDesc(amb.e, OC_MISTA);                       // 12 numerados; só "M1000" tem entrega antes do corte
  const antigo = Object.keys(antes).find(k => /M1000 /.test(k));
  const imp = amb.e.ss.getSheetByName('DADOS_IMPORTADOS');
  imp.data = imp.data.filter((r, i) => i < 3 || String(r[9]) !== OC_MISTA || String(r[7]) === antigo);   // os outros 11 foram faturados
  amb.refazOriginal(); amb.importa(); amb.e.ctx.processoAutomaticoCompleto();
  assert.ok(Number(porDesc(amb.e, OC_MISTA)[antigo]) > 0, 'antes do reset o item tem número no DB');
  amb.e.ctx.resetarEReprocessar();
  const depois = porDesc(amb.e, OC_MISTA);
  assert.deepStrictEqual(Object.keys(depois), [antigo]);
  assert.strictEqual(depois[antigo], antes[antigo], 'o item antigo, ainda aberto, perdeu o número no relatório');
});
t('se o backup não puder ser gravado, o reset é cancelado e NADA é apagado', () => {
  const { e, msgs } = envNumerado();
  const antes = JSON.stringify(e.ss.getSheetByName('Relatorio_DB').data);
  e.ctx._salvarBackupSequencia_ = () => { throw new Error('sem espaço'); };
  e.ctx.resetarEReprocessar();
  assert.strictEqual(JSON.stringify(e.ss.getSheetByName('Relatorio_DB').data), antes, 'DB foi alterado');
  assert.match(msgs[msgs.length - 1][0], /Reset cancelado/);
});

R.fim();
