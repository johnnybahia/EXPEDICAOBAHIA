// Teste da tela (INDEX.HTML) no Chromium: aviso de conferência — abre sozinho só para nível TOTAL, mostra os
// itens, escapa HTML, chama confirmarSaidaFonte com os argumentos certos e fecha quando acaba.
// Precisa do Playwright (npm install --no-save playwright && npx playwright install chromium); sem ele o teste
// é PULADO (o placar mostra ⚠️).
const assert = require('assert');
const path = require('path');
const { criarRelatorio } = require('./lib');

const R = criarRelatorio('tela.js');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  R.pular('aviso de conferência na tela', 'Playwright não instalado');
  R.fim();
  process.exit(0);
}

const LISTA = [
  { uniqueId: 'ID-1', planilhaLinha: 5, cliente: 'DASS ITABERABA', pedido: '144548', oc: '16309125', descricao: 'ATAC. M10110 <b>5MM</b>', tamanho: '105CM', lote: '145799', qtdAberta: 372, qtdOriginal: 372, saiuEm: '26/10/2026 13:57', motivo: 'produto_ausente', gemeo: null },
  { uniqueId: 'ID-2', planilhaLinha: 6, cliente: 'DASS VITORIA', pedido: '144521', oc: '16308033', descricao: 'FITA X', tamanho: '130CM', lote: '145780', qtdAberta: 100, qtdOriginal: 192, saiuEm: '26/10/2026 13:57', motivo: 'linha_excedente / com baixa registrada', gemeo: { uniqueId: 'G', oc: '1630', qtdAberta: 5 } }
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errosDePagina = [];
  page.on('pageerror', e => errosDePagina.push(e.message));
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort()); // sem rede
  await page.addInitScript(() => {
    window.__chamadas = [];
    const mk = (ok, fail) => new Proxy({}, { get: (_, nome) => {
      if (nome === 'withSuccessHandler') return fn => mk(fn, fail);
      if (nome === 'withFailureHandler') return fn => mk(ok, fn);
      return (...args) => { window.__chamadas.push({ nome, args }); setTimeout(() => { if (ok) ok(nome === 'confirmarSaidaFonte' ? { success: true } : null); }, 5); };
    } });
    window.google = { script: { run: mk(null, null) } };
    window.confirm = () => true;
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'INDEX.HTML'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    _fecharLoginModal(); window.ACCESS_NIVEL = 'TOTAL';
    localStorage.setItem('_relat_sessao_v1', JSON.stringify({ nivel: 'TOTAL', tempoSessao: 60, loginTime: Date.now(), usuario: 'ANA', perfilBaixa: 'BAIXA1' }));
  });
  const visivel = (sel) => page.isVisible(sel);

  await page.evaluate(l => atualizarPendentesSaida(l), LISTA);
  const r = {};
  r.abriu = await visivel('#conferenciaSaidaModal');
  r.cards = await page.locator('.conf-card').count();
  r.pill = (await page.textContent('#pendentes-saida-pill')).trim();
  r.duplicata = (await page.locator('.conf-card[data-id="ID-1"] .conf-duplicata').count()) + '/' + (await page.locator('.conf-card[data-id="ID-2"] .conf-duplicata').count());
  r.dados1 = await page.innerHTML('.conf-card[data-id="ID-1"] .conf-dados');
  r.dados2 = await page.textContent('.conf-card[data-id="ID-2"] .conf-dados');

  await page.click('.conf-card[data-id="ID-1"] .conf-faturado');
  await page.waitForTimeout(100);
  r.chamadas = await page.evaluate(() => window.__chamadas.filter(c => c.nome === 'confirmarSaidaFonte').map(c => c.args));
  r.cardsDepois = await page.locator('.conf-card').count();
  r.pillDepois = (await page.textContent('#pendentes-saida-pill')).trim();
  await page.click('.conf-card[data-id="ID-2"] .conf-aberto');
  await page.waitForTimeout(100);
  r.fechou = !(await visivel('#conferenciaSaidaModal'));
  r.selos = await page.evaluate(() => ['PENDENTE|sistema|x|y', 'ABERTO|ANA|26/10/2026 14:00|z', 'FATURADO|ANA|x|y', ''].map(z => _seloConferenciaSaida({ CONFERENCIA_SAIDA: z })));

  await page.evaluate(l => { window.ACCESS_NIVEL = 'PARCIAL'; _pendentesSaidaApresentados.clear(); atualizarPendentesSaida(l); }, LISTA);
  r.parcialAbre = await visivel('#conferenciaSaidaModal');
  await page.evaluate(() => abrirConferenciaSaida());
  r.parcialAbreManual = await visivel('#conferenciaSaidaModal');
  await page.evaluate(l => { window.ACCESS_NIVEL = 'TOTAL'; atualizarPendentesSaida(l); }, LISTA);
  r.totalAbre = await visivel('#conferenciaSaidaModal');
  await page.evaluate(l => { fecharConferenciaSaida(); atualizarPendentesSaida(l); }, LISTA);
  r.naoReabre = !(await visivel('#conferenciaSaidaModal'));
  await browser.close();

  R.t('nível TOTAL: a janela abre sozinha com um card por item e o contador no cabeçalho', () => {
    assert.strictEqual(r.abriu, true); assert.strictEqual(r.cards, 2); assert.match(r.pill, /2 itens saíram/);
  });
  R.t('o botão Duplicata só existe quando há linha gêmea', () => assert.strictEqual(r.duplicata, '0/1'));
  R.t('texto vindo da planilha é escapado (sem HTML injetado)', () => assert.ok(!r.dados1.includes('<b>5MM</b>')));
  R.t('o motivo aparece em português e menciona a baixa registrada', () => {
    assert.ok(r.dados2.includes('menos linhas')); assert.ok(r.dados2.includes('com baixa registrada'));
  });
  R.t('clicar em Faturado chama confirmarSaidaFonte(id, linha, decisão, usuário da sessão)', () => assert.deepStrictEqual(r.chamadas[0], ['ID-1', 5, 'FATURADO', 'ANA']));
  R.t('o card respondido some, o contador desce e a janela fecha ao acabar', () => {
    assert.strictEqual(r.cardsDepois, 1); assert.match(r.pillDepois, /1 item saiu/); assert.strictEqual(r.fechou, true);
  });
  R.t('selos da tabela: PENDENTE → conferir, ABERTO → conferido, FATURADO/vazio → nada', () => {
    assert.match(r.selos[0], /CONFERIR/); assert.match(r.selos[1], /conferido/); assert.strictEqual(r.selos[2], ''); assert.strictEqual(r.selos[3], '');
  });
  R.t('nível PARCIAL não vê nem abre a janela', () => { assert.strictEqual(r.parcialAbre, false); assert.strictEqual(r.parcialAbreManual, false); });
  R.t('nível TOTAL abre item novo uma vez e não reabre o já apresentado', () => { assert.strictEqual(r.totalAbre, true); assert.strictEqual(r.naoReabre, true); });
  R.t('a página não gera erro de JavaScript', () => assert.deepStrictEqual(errosDePagina, []));
  R.fim();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
