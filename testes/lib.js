// Utilitários comuns da bateria: base de dados (sintética ou export real), planilha simulada e relatório ✅/❌.
//
// BASE SINTÉTICA (padrão): só DADOS_IMPORTADOS é gerada aqui; PEDIDOS e Relatorio_DB nascem do próprio
// sistema (resetarEReprocessarSilencioso no simulador). Não há dado real de cliente no repositório.
// BASE REAL (--dados <pasta>): 3 CSV exportados do Google Sheets (nomes terminando em DADOS_IMPORTADOS,
// PEDIDOS e Relatorio_DB). A pasta fica fora do Git (testes/dados_locais/ já está no .gitignore).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarContexto, lerCsv, celula, dataFortaleza } = require('./gasmock');

// ── Relatório ✅/❌ ─────────────────────────────────────────────────────────────────────────────────────
function criarRelatorio(nomeArquivo) {
  const r = { ok: 0, falhas: 0, pulados: 0 };
  r.t = (nome, fn) => {
    try { fn(); console.log('✅', nome); r.ok++; }
    catch (e) { console.log('❌', nome, '\n    ', String(e.message).split('\n').join('\n     ')); r.falhas++; process.exitCode = 1; }
  };
  r.pular = (nome, motivo) => { console.log('⏭️ ', nome, '—', motivo); r.pulados++; };
  r.fim = () => {
    console.log(`RESULTADO ${nomeArquivo}: ${r.ok} ok, ${r.falhas} falha(s)${r.pulados ? `, ${r.pulados} pulado(s)` : ''}`);
  };
  return r;
}

// ── Base sintética ──────────────────────────────────────────────────────────────────────────────────────
const D = (y, m, d) => dataFortaleza(y, m, d);
const CLIENTES = ['DASS ITABERABA', 'DASS VITORIA', 'DASS SEST'];
const DATA_LOTE_NOVO = D(2026, 10, 23); // o "lote recém-chegado" do incidente de 26/10/2026

/**
 * DADOS_IMPORTADOS sintética (cabeçalho de 3 linhas + dados; colunas A–Y).
 * escala = nº de OCs antigas (12 itens cada). O lote novo (3 OCs × 12 itens) é sempre o mesmo.
 * Há um grupo de linhas-irmãs idênticas em mm (CÓD. OS "0"), como na fonte real.
 */
function gerarImp(escala = 30) {
  const linhas = [];
  const add = (cli, pedido, oc, k, dtrec, mm) => {
    const tam = mm ? `${10 + (k % 3)}MM` : `${60 + 5 * k}CM`;
    const os = mm ? '0' : `${oc}${String(k).padStart(2, '0')}BRITB0${pedido}`;
    linhas.push(['', 'OK', cli, 70, pedido, `${900000 + Number(pedido) + k}`, `${90000 + k}`,
      `${mm ? 'FITA' : 'ELAST.'} M${1000 + k} POLIESTER COR ${100 + k} / COR ${200 + k}`, tam, oc, 100 * (k + 1) + 12, '', os,
      dtrec, D(2026, 11, 3 + (k % 5)), 8 + (k % 5), '', D(2026, 11, 3), '', '', '', '', '', '', '']);
  };
  for (let i = 0; i < escala; i++) {
    const cli = CLIENTES[i % 3], pedido = String(140000 + i), oc = String(16100000 + i);
    for (let k = 0; k < 12; k++) add(cli, pedido, oc, k, D(2026, 9, 8 + (i % 10)), false);
  }
  for (let k = 0; k < 4; k++) add('DASS SEST', '149000', '16199000', 1, D(2026, 9, 9), true); // 4 irmãs idênticas em mm
  for (let i = 0; i < 3; i++) {
    const cli = CLIENTES[i % 3], pedido = String(145000 + i), oc = String(16309000 + i);
    for (let k = 0; k < 12; k++) add(cli, pedido, oc, k, DATA_LOTE_NOVO, false);
  }
  const cab = [
    ['', '', '', '', '', '', '', '26/10/2026', 'RELATÓRIO BAHIA ATUALIZADO'],
    ['', '', '', 'EM VERMELHO CÓD. DA CARTELA NÃO LOCALIZADO', '', '', '', '26/10/2026 13:00:00'],
    ['Coluna 1', 'cartela', 'CLIENTE', 'CÓD. FILIAL', 'PEDIDO', 'CÓD. CLIENTE', 'CÓD. MARFIM', 'DESCRIÇÃO', 'TAMANHO', 'ORD. COMPRA',
      'QTD. ABERTA', 'LOTES', 'código OS', 'DT. RECEBIMENTO', 'DT. ENTREGA', 'PRAZO']
  ];
  return [...cab, ...linhas].map(r => { const o = [...r]; while (o.length < 25) o.push(''); return o; });
}

// ── Base real (CSV) ─────────────────────────────────────────────────────────────────────────────────────
const TXT_IMP = new Set([5, 6, 9, 12]);
const TXT_PED = new Set([5, 6, 9, 11, 19, 20, 22]);
const TXT_DB = new Set([4, 5, 8, 10, 18, 19, 20, 21, 22, 23, 25, 26]);
function conv(rows, txt, ncols) {
  return rows.map(r => {
    const o = [];
    for (let j = 0; j < Math.max(ncols, r.length); j++) {
      let v = r[j] === undefined ? '' : r[j];
      if (!txt.has(j)) v = v.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/, (m, d, mo, y) => d.padStart(2, '0') + '/' + mo.padStart(2, '0') + '/' + y);
      o.push(celula(v, txt.has(j)));
    }
    return o;
  });
}
function acharCsv(pasta, sufixo) {
  const norm = f => f.toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\.CSV$/, '');
  const achados = fs.readdirSync(pasta).filter(f => /\.csv$/i.test(f) && new RegExp(`${sufixo}(_\\d+| \\(\\d+\\))?$`).test(norm(f)))
    .map(f => path.join(pasta, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (achados.length === 0) throw new Error(`CSV *${sufixo} não encontrado em ${pasta}`);
  return achados[0];
}
function baseReal(pasta) {
  return {
    origem: `export real em ${pasta}`,
    imp: conv(lerCsv(acharCsv(pasta, 'DADOS_IMPORTADOS')), TXT_IMP, 25),
    ped: conv(lerCsv(acharCsv(pasta, 'PEDIDOS')), TXT_PED, 23),
    db: conv(lerCsv(acharCsv(pasta, 'RELATORIO_DB')), TXT_DB, 27)
  };
}

// ── Planilha simulada ───────────────────────────────────────────────────────────────────────────────────
function planilhaVazia(opcoes = {}) {
  const env = criarContexto({ verbose: !!opcoes.verbose });
  const { ss } = env;
  ss.addSheet('Baixas_Historico', [['ID_ITEM', 'DATA_HORA', 'QTD_BAIXADA', 'QTD_RESTANTE', 'USUARIO', 'QTD_ORIGINAL', 'TIPO']], 7);
  ss.addSheet('CADASTRO', [['ANA', 'x', 'TOTAL'], ['BETO', 'x', 'PARCIAL']], 3);
  return env;
}

let _sintetica = {};
/** Base sintética: o sistema gera PEDIDOS e Relatorio_DB a partir de DADOS_IMPORTADOS (reset do zero). */
function baseSintetica(escala = 30) {
  if (!_sintetica[escala]) {
    const env = planilhaVazia();
    env.ss.addSheet('DADOS_IMPORTADOS', gerarImp(escala), 25);
    env.ss.addSheet('PEDIDOS', [['', ''], ['', ''], ['', '']], 23);
    env.ss.addSheet('Relatorio_DB', [], 27);
    env.ctx.resetarEReprocessarSilencioso();
    _sintetica[escala] = {
      origem: `sintética (${escala} OCs + lote novo)`,
      imp: structuredClone(env.ss.getSheetByName('DADOS_IMPORTADOS').data),
      ped: structuredClone(env.ss.getSheetByName('PEDIDOS').data),
      db: structuredClone(env.ss.getSheetByName('Relatorio_DB').data)
    };
  }
  return structuredClone(_sintetica[escala]);
}

function pastaDaLinhaDeComando() {
  const i = process.argv.indexOf('--dados');
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
}
/** Base do cenário: --dados <pasta> (export real) ou a sintética. */
function carregarBase(escala) {
  const pasta = pastaDaLinhaDeComando();
  return pasta ? baseReal(pasta) : baseSintetica(escala);
}

/**
 * Monta a planilha a partir da base. opcoes.imp/ped/db: função (linhas)=>linhas para alterar o cenário
 * (as 3 primeiras linhas de PEDIDOS/DADOS_IMPORTADOS são cabeçalho; os dados começam na linha 4).
 */
function montar(base, opcoes = {}) {
  const env = planilhaVazia(opcoes);
  let { imp, ped, db } = structuredClone({ imp: base.imp, ped: base.ped, db: base.db });
  if (opcoes.imp) imp = opcoes.imp(imp);
  if (opcoes.ped) ped = opcoes.ped(ped);
  if (opcoes.db) db = opcoes.db(db);
  env.ss.addSheet('DADOS_IMPORTADOS', imp, 25);
  env.ss.addSheet('PEDIDOS', ped, 23);
  env.ss.addSheet('Relatorio_DB', db, 27);
  env.base = base;
  // A purga diária depende do relógio (dia útil, hora, idade do Faturado): fora daqui, para os números não
  // mudarem conforme o dia em que a bateria roda. Passe opcoes.purga = true para exercitá-la.
  if (!opcoes.purga) env.ctx.purgarItensFinalizados = () => ({ purgados: 0 });
  return env;
}

/** Linhas do Relatorio_DB como objetos {cabeçalho: valor}. */
function linhasDB(env) {
  const sh = env.ss.getSheetByName('Relatorio_DB');
  const h = sh.data[0];
  return sh.data.slice(1).filter(r => r && String(r[0] || '').trim()).map(r => { const o = {}; h.forEach((k, i) => { if (k) o[k] = r[i]; }); return o; });
}

/** Data mais recente de DADOS_IMPORTADOS (DT. RECEBIMENTO, col N): é o "lote recém-chegado". */
function dataDoLoteNovo(imp) {
  let max = 0;
  imp.forEach((r, i) => { if (i >= 3 && r[13] instanceof Date && r[13].getTime() > max) max = r[13].getTime(); });
  return max;
}
const ehData = (v, t) => v instanceof Date && v.getTime() === t;
/** Total de linhas de dados (com cartela) em DADOS_IMPORTADOS. */
const totalFonte = (imp) => imp.filter((r, i) => i >= 3 && String(r[1] || '').trim()).length;

module.exports = {
  criarRelatorio, montar, carregarBase, baseSintetica, baseReal, gerarImp, linhasDB, dataDoLoteNovo, ehData, totalFonte,
  planilhaVazia, DATA_LOTE_NOVO
};
