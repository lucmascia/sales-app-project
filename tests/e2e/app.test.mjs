// Drives the real app in a phone-sized browser against the real Code.gs
// running on a fake spreadsheet (see ../mock-server.mjs).
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startMockServer } from '../mock-server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
const START = new Date('2026-11-15T17:32:05Z'); // 14:32:05 at the fair
const UNDO_WINDOW_MS = 6000;

let browser, server, contexts;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });
beforeEach(async () => { server = await startMockServer(); contexts = []; });
afterEach(async () => { await Promise.all(contexts.map((c) => c.close())); await server.close(); });

async function openPhone({ seller = 'Lucas', configured = true, scriptUrl } = {}) {
  const context = await browser.newContext(PHONE);
  context.setDefaultTimeout(6000);
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => { throw error; });
  await page.clock.install({ time: START });
  await page.goto(server.appUrl);
  if (configured) {
    await page.getByLabel('Link do script').fill(scriptUrl || server.scriptUrl);
    await page.getByLabel('Seu nome').fill(seller);
    await page.getByRole('button', { name: 'Salvar e testar' }).click();
    await page.getByText('Conectado').waitFor();
    await page.getByRole('button', { name: 'Vender', exact: true }).click();
  }
  return page;
}
const product = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const pay = (page, name) => page.getByRole('group', { name: 'Forma de pagamento' }).getByRole('button', { name });
const passUndoWindow = (page) => page.clock.fastForward(UNDO_WINDOW_MS + 500);
async function waitForRows(count) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.appRows().length === count) return server.appRows();
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(server.appRows().length, count, 'rows in the app tab');
  return server.appRows();
}
const pendingBadge = (page) => page.locator('#sync-status');

test('a sale takes two taps and lands in the sheet shaped like Faturamento', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'Crédito').tap();
  await page.getByText('Venda registrada').waitFor();
  await passUndoWindow(page);
  const [row] = await waitForRows(1);
  assert.equal(row[2].toISOString(), '2026-11-15T03:00:00.000Z');
  assert.deepEqual(row.slice(0, 2), ['Manticello375Feiras', 11]);
  assert.deepEqual(row.slice(3, 18), ['Manticello', 375, 'Feiras', 69, 1, 0, 2.1321, 66.8679,
    'Não informado', 'Pago', 0, 'Mercado Pago - Crédito', '', '', '']);
  assert.equal(row[18], '14:32:05');
  assert.match(row[19], /^20261115-143205-[0-9a-z]{4}$/);
  assert.deepEqual(row.slice(20), ['Lucas', 'OK', 69]);
  await page.locator('#sync-status[data-pending="0"]').waitFor();
});

test('the browser never sends a preflight, which Apps Script cannot answer', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await passUndoWindow(page);
  await waitForRows(1);
  assert.deepEqual(server.state.requests.filter((r) => r.method === 'OPTIONS'), []);
});

test('a double tap on the payment method registers one sale', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').dblclick();
  await passUndoWindow(page);
  await waitForRows(1);
  await page.waitForTimeout(300);
  assert.equal(server.appRows().length, 1);
});

test('tapping a product again adds a unit, minus takes one away', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await product(page, 'Manticello 375').tap();
  await product(page, 'Marmelatta 120').tap();
  await page.getByText('R$ 167,00').waitFor();
  await page.getByRole('button', { name: 'Tirar 1 Marmelatta 120' }).tap();
  await page.getByText('R$ 138,00').first().waitFor();
  await pay(page, 'Dinheiro').tap();
  await passUndoWindow(page);
  const rows = await waitForRows(1);
  assert.deepEqual(rows[0].slice(6, 11), [69, 2, 0, 0, 138]);
});

test('a discount is typed as the final value and reaches the sheet in reais', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 750').tap();
  await product(page, 'Manticello 750').tap();
  await page.getByRole('button', { name: /Total/ }).tap();
  await page.getByLabel('Valor final').fill('250');
  await page.getByRole('button', { name: 'Aplicar' }).tap();
  await page.getByText('desconto de R$ 8,00').waitFor();
  await pay(page, 'PIX').tap();
  await passUndoWindow(page);
  const [row] = await waitForRows(1);
  assert.deepEqual(row.slice(6, 11), [129, 2, 8, 0, 250]);
  assert.equal(row[22], 250);
});

test('a final value above the total is refused with an explanation', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await page.getByRole('button', { name: /Total/ }).tap();
  await page.getByLabel('Valor final').fill('70');
  await page.getByRole('button', { name: 'Aplicar' }).tap();
  await page.getByText('não pode ser maior').waitFor();
});

test('without signal sales pile up on the phone and are sent when it returns', async () => {
  const page = await openPhone();
  await page.context().setOffline(true);
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await product(page, 'Camiseta Soltinho').tap();
  await pay(page, 'Débito').tap();
  await passUndoWindow(page);
  await page.locator('#sync-status[data-pending="2"]').waitFor();
  assert.equal(server.appRows().length, 0);
  await page.context().setOffline(false);
  await waitForRows(2);
  await page.locator('#sync-status[data-pending="0"]').waitFor();
});

test('when the answer from the sheet is lost, the retry does not duplicate the sale', async () => {
  const page = await openPhone();
  server.state.dropNextPostResponse = true;
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await passUndoWindow(page);
  await waitForRows(1);
  await page.clock.fastForward(26000); // the app stops waiting after 25 s
  await page.locator('#sync-status[data-pending="1"]').waitFor();
  await pendingBadge(page).tap();
  await page.locator('#sync-status[data-pending="0"]').waitFor();
  assert.equal(server.appRows().length, 1);
});

test('undo right after the sale leaves nothing in the sheet', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.getByRole('button', { name: 'Desfazer' }).tap();
  await page.getByText('Venda desfeita').waitFor();
  await passUndoWindow(page);
  await page.waitForTimeout(300);
  assert.equal(server.appRows().length, 0);
  await page.locator('#sync-status[data-pending="0"]').waitFor();
});

test('a sent sale can be cancelled from the closing screen and is zeroed in the sheet', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'Crédito').tap();
  await passUndoWindow(page);
  await waitForRows(1);
  await page.getByRole('button', { name: 'Fechamento' }).tap();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancelar venda' }).tap();
  await page.getByText('Cancelada').first().waitFor();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && server.appRows()[0][21] !== 'Cancelada') await new Promise((r) => setTimeout(r, 25));
  const [row] = server.appRows();
  assert.deepEqual(row.slice(6, 11), [69, 0, 0, 0, 0]);
  assert.equal(row[16], 'Cancelada (era 2 un)');
  assert.equal(row[21], 'Cancelada');
  await page.locator('[data-total="cobrado"]', { hasText: 'R$ 0,00' }).waitFor();
});

test('the closing adds up both phones and shows what to check against the bank statement', async () => {
  const lucas = await openPhone({ seller: 'Lucas' });
  const ana = await openPhone({ seller: 'Ana' });
  await product(lucas, 'Manticello 375').tap();
  await pay(lucas, 'Crédito').tap();
  await product(ana, 'Manticello 750').tap();
  await product(ana, 'Manticello 750').tap();
  await ana.getByRole('button', { name: /Total/ }).tap();
  await ana.getByLabel('Valor final').fill('250');
  await ana.getByRole('button', { name: 'Aplicar' }).tap();
  await pay(ana, 'PIX').tap();
  await passUndoWindow(lucas);
  await passUndoWindow(ana);
  await waitForRows(2);

  await lucas.getByRole('button', { name: 'Fechamento' }).tap();
  await lucas.getByRole('button', { name: 'Atualizar' }).tap();
  const total = (name) => lucas.locator(`[data-total="${name}"]`);
  const shown = async (name) => (await total(name).innerText()).replace(/\u00a0/g, ' '); // pt-BR currency uses a no-break space
  await total('cobrado').filter({ hasText: 'R$ 319,00' }).waitFor();
  assert.equal(await shown('vendas'), '2');
  assert.equal(await shown('descontos'), 'R$ 8,00');
  assert.equal(await shown('taxas'), 'R$ 2,13');
  assert.equal(await shown('liquido'), 'R$ 316,87');
  assert.equal(await shown('feira'), 'R$ 76,69'); // 10% of 316.8679 + 45
  const closing = await lucas.locator('#view-closing').innerText();
  assert.match(closing, /Ana/);
  assert.match(closing, /Lucas/);
  assert.match(closing, /2× Manticello 750/);
  // only the phone that made a sale may cancel it
  assert.equal(await lucas.getByRole('button', { name: 'Cancelar venda' }).count(), 1);
});

test('the fair cost follows the percentage and fixed amount typed in', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.getByRole('button', { name: 'Fechamento' }).tap();
  await page.locator('[data-total="feira"]', { hasText: 'R$ 51,90' }).waitFor(); // 10% of 69 + 45
  await page.getByLabel('Percentual da feira').fill('15');
  await page.getByLabel('Valor fixo da feira').fill('0');
  await page.locator('[data-total="feira"]', { hasText: 'R$ 10,35' }).waitFor();
});

test('offline, the closing says it only has this phone and still adds up', async () => {
  const page = await openPhone();
  await page.context().setOffline(true);
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.getByRole('button', { name: 'Fechamento' }).tap();
  await page.getByText('Só as vendas deste celular').waitFor();
  await page.locator('[data-total="cobrado"]', { hasText: 'R$ 69,00' }).waitFor();
});

test('after the first visit the app opens and sells with no network at all', async () => {
  const page = await openPhone();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.context().setOffline(true);
  await page.reload();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.getByText('Venda registrada').waitFor();
  await page.locator('#sync-status[data-pending="1"]').waitFor();
});

test('sales made before a reload are still there after it', async () => {
  const page = await openPhone();
  await page.context().setOffline(true);
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await page.locator('#sync-status[data-pending="1"]').waitFor();
});

test('a setup link fills in the script link on a second phone', async () => {
  const page = await openPhone({ configured: false });
  await page.goto(`${server.appUrl}#setup=${encodeURIComponent(server.scriptUrl)}`);
  await page.reload();
  assert.equal(await page.getByLabel('Link do script').inputValue(), server.scriptUrl);
  assert.equal(new URL(page.url()).hash, '');
});

test('a link that answers with a Google page is explained, not silently accepted', async () => {
  const page = await openPhone({ configured: false });
  await page.getByLabel('Link do script').fill(server.htmlUrl);
  await page.getByLabel('Seu nome').fill('Lucas');
  await page.getByRole('button', { name: 'Salvar e testar' }).click();
  await page.getByText('Qualquer pessoa').waitFor();
});

test('a new phone is taken to the settings and cannot sell before connecting', async () => {
  const page = await openPhone({ configured: false });
  await page.getByLabel('Link do script').waitFor();
  await page.getByRole('button', { name: 'Vender', exact: true }).click();
  await page.getByText('Conecte o app à planilha').waitFor();
});

test('the next sale can start at once: the confirmation covers no product, payment or tab', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.getByText('Venda registrada').waitFor();
  await product(page, 'Manticello 375').tap();   // top-left tile, straight away
  await product(page, 'Manticello 750').tap();
  await pay(page, 'Crédito').tap();
  await page.getByRole('button', { name: 'Fechamento' }).tap();
  await page.locator('[data-total="vendas"]', { hasText: '2' }).waitFor();
  await passUndoWindow(page);
  await waitForRows(3);
});

test('undo is offered only for the sale just made, and goes away when the next one starts', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  await pay(page, 'PIX').tap();
  await page.getByRole('button', { name: 'Desfazer' }).waitFor();
  await product(page, 'Manticello 750').tap();
  assert.equal(await page.getByRole('button', { name: 'Desfazer' }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: /Total/ }).isVisible(), true);
});

test('pasting the whole setup link into the script field works too (iPhone home-screen apps start blank)', async () => {
  const page = await openPhone({ configured: false });
  await page.getByLabel('Link do script').fill(`https://vendas.example/app/#setup=${encodeURIComponent(server.scriptUrl)}`);
  await page.getByLabel('Seu nome').fill('Ana');
  await page.getByRole('button', { name: 'Salvar e testar' }).click();
  await page.getByText('Conectado').waitFor();
  assert.equal(await page.getByLabel('Link do script').inputValue(), server.scriptUrl);
});

test('prices are not refreshed under a half-built sale', async () => {
  const page = await openPhone();
  await product(page, 'Manticello 375').tap();
  const prices = server.spreadsheet.getSheetByName('Tabela de Preço');
  const row = prices._rows().findIndex((r) => r[0] === 'Manticello375Feiras2026') + 1;
  prices.getRange(row, 7).setValue(75);
  await page.clock.fastForward(11 * 60 * 1000); // the catalogue is now stale
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  await pay(page, 'PIX').tap();
  await passUndoWindow(page);
  const [sold] = await waitForRows(1);
  assert.equal(sold[6], 69);
  // with the cart empty again, the new price arrives
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('button', { name: /^Manticello 375, R\$\s75,00/ }).waitFor();
});
