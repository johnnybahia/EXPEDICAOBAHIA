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
      return (...args) => { window.__chamadas.push({ nome, args }); setTimeout(() => { if (ok) ok((nome === 'confirmarSaidaFonte' || nome === 'marcarParaFaturar') ? { success: true } : null); }, 5); };
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

  // Marcar item com baixa parcial: janela com TOTAL / PARCIAL / CANCELAR (o confirm() antigo marcava no "Cancelar")
  await page.evaluate(() => {
    fecharConferenciaSaida();
    document.body.insertAdjacentHTML('beforeend', '<table><tbody><tr id="item-linha-77" data-item-qtd="12" data-item-qtd-original="323"><td><input type="checkbox" class="checkbox-faturar" checked></td></tr></tbody></table>');
    window.__chamadas = [];
    handleMarcarFaturar('ID-P', 77, true);
  });
  r.parcialJanela = await visivel('#baixaConfirmacaoModal');
  r.parcialTexto = await page.textContent('#baixa-confirmacao-msg');
  r.parcialCancelarVisivel = await visivel('#baixa-confirmacao-cancelar-btn');
  await page.click('#baixa-confirmacao-cancelar-btn', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(50);
  r.cancelou = await page.evaluate(() => ({ marcou: window.__chamadas.some(c => c.nome === 'marcarParaFaturar'), checkbox: document.querySelector('#item-linha-77 .checkbox-faturar').checked }));
  await page.evaluate(() => { document.querySelector('#item-linha-77 .checkbox-faturar').checked = true; handleMarcarFaturar('ID-P', 77, true); });
  await page.click('#baixa-confirmacao-parcial-btn', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(50);
  r.parcialChamada = await page.evaluate(() => (window.__chamadas.find(c => c.nome === 'marcarParaFaturar') || {}).args);
  await page.evaluate(() => showBaixaConfirmacaoModal('x', () => {}, () => {}));
  r.posBaixaSemCancelar = !(await visivel('#baixa-confirmacao-cancelar-btn'));
  await page.evaluate(() => hideBaixaConfirmacaoModal());
  // Atualização automática (antes: canAutoRefresh dava erro — $confirmModal não existe — e o refresh morria)
  r.refresh = await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    $loader.classList.add('hidden');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const out = { intervalo: AUTO_REFRESH_INTERVAL };
    try { out.livre = canAutoRefresh(); } catch (e) { out.erro = e.message; }
    document.getElementById('successModal').classList.remove('hidden');
    try { out.comJanela = canAutoRefresh(); } catch (e) { out.erro = e.message; }
    document.getElementById('successModal').classList.add('hidden');
    const busca = document.createElement('input'); document.body.appendChild(busca); busca.focus();
    try { out.digitando = canAutoRefresh(); } catch (e) { out.erro = e.message; }
    busca.remove();
    // dispara na hora o temporizador do refresh e confere que ele busca os dados no servidor
    const st = window.setTimeout, capturados = [];
    window.setTimeout = (fn, ms, ...a) => { if (ms === AUTO_REFRESH_INTERVAL) { capturados.push(fn); return 0; } return st(fn, ms, ...a); };
    try { scheduleAutoRefresh(); } finally { window.setTimeout = st; }
    const antes = window.__chamadas.filter(c => c.nome === 'fetchAllDataUnified').length;
    try { capturados.forEach(fn => fn()); } catch (e) { out.erro = e.message; }
    out.agendou = capturados.length;
    out.buscou = window.__chamadas.filter(c => c.nome === 'fetchAllDataUnified').length - antes;
    return out;
  });
  // Teclado: atalhos de linha desligados — nenhuma tecla marca nada nem dá erro
  const marcacoesAntesTeclas = await page.evaluate(() => window.__chamadas.filter(c => c.nome === 'marcarParaFaturar').length);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press(' '); await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  r.teclasMarcaram = (await page.evaluate(() => window.__chamadas.filter(c => c.nome === 'marcarParaFaturar').length)) - marcacoesAntesTeclas;
  // Faixa de versão: visível na tela, some na impressão
  r.faixa = await visivel('#faixa-versao');
  await page.emulateMedia({ media: 'print' });
  r.faixaImpressao = await visivel('#faixa-versao');
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
  R.t('marcar item parcial abre TOTAL / PARCIAL / CANCELAR com o baixado e o saldo', () => {
    assert.strictEqual(r.parcialJanela, true); assert.strictEqual(r.parcialCancelarVisivel, true);
    assert.match(r.parcialTexto, /Baixado neste ciclo: 311/); assert.match(r.parcialTexto, /Saldo em aberto: 12/);
  });
  R.t('CANCELAR não marca e desmarca a caixa', () => assert.deepStrictEqual(r.cancelou, { marcou: false, checkbox: false }));
  R.t('PARCIAL marca só o baixado: marcarParaFaturar(id, linha, true, usuário, perfil)', () => assert.deepStrictEqual(r.parcialChamada, ['ID-P', 77, true, 'ANA', 'BAIXA1']));
  R.t('a janela depois da baixa continua só com TOTAL e PARCIAL', () => assert.strictEqual(r.posBaixaSemCancelar, true));
  R.t('atualização automática: sem erro; adia com janela aberta ou com alguém digitando', () => {
    assert.strictEqual(r.refresh.erro, undefined, r.refresh.erro);
    assert.deepStrictEqual([r.refresh.livre, r.refresh.comJanela, r.refresh.digitando], [true, false, false]);
  });
  R.t('atualização automática a cada 2 min dispara e busca os dados no servidor', () => {
    assert.strictEqual(r.refresh.intervalo, 120000); assert.strictEqual(r.refresh.agendou, 1); assert.strictEqual(r.refresh.buscou, 1);
  });
  R.t('teclado: atalhos de linha desligados (nenhuma tecla marca para faturar)', () => assert.strictEqual(r.teclasMarcaram, 0));
  R.t('faixa de versão aparece na tela e some na impressão', () => { assert.strictEqual(r.faixa, true); assert.strictEqual(r.faixaImpressao, false); });
  R.t('a página não gera erro de JavaScript', () => assert.deepStrictEqual(errosDePagina, []));
  R.fim();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
