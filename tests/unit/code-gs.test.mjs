import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSpreadsheet, loadScript } from '../fake-sheets.mjs';
import { CODE_GS, NOW, seedSheets, SALE_CREDITO, SALE_TWO_LINES } from '../fixtures.mjs';

function setup(mutate) {
  const sheets = seedSheets();
  if (mutate) mutate(sheets);
  const ss = createFakeSpreadsheet(sheets);
  return { ss, script: loadScript(CODE_GS, ss, { now: NOW }) };
}
const appRows = (ss) => ss.getSheetByName('app')._rows().slice(1);
const iso = (d) => d.toISOString();

test('config lists the eight fair products with the prices of the price table', () => {
  const { script } = setup();
  const config = script.get({ action: 'config' });
  assert.equal(config.ok, true);
  assert.deepEqual(config.products, [
    { produto: 'Manticello', tamanho: 375, canal: 'Feiras', preco: 69 },
    { produto: 'Manticello', tamanho: 750, canal: 'Feiras', preco: 129 },
    { produto: 'Camiseta', tamanho: 'Solto', canal: 'Varejo', preco: 149 },
    { produto: 'Camiseta', tamanho: 'Soltinho', canal: 'Varejo', preco: 149 },
    { produto: 'Camiseta', tamanho: 'Soltão', canal: 'Varejo', preco: 149 },
    { produto: 'Sacola Linho', tamanho: 'Unico', canal: 'Feiras', preco: 15 },
    { produto: 'Marmelatta', tamanho: 120, canal: 'Varejo', preco: 29 },
    { produto: 'Marmelatta', tamanho: 260, canal: 'Varejo', preco: 40 },
  ]);
  assert.deepEqual(config.warnings, []);
});

test('config lists the four payment methods with their fee rates', () => {
  const { script } = setup();
  assert.deepEqual(script.get({ action: 'config' }).fees, [
    { chave: 'Mercado Pago - Crédito', taxa: 0.0309 },
    { chave: 'Mercado Pago - Débito', taxa: 0.0089 },
    { chave: 'Dinheiro', taxa: 0 },
    { chave: 'PIX', taxa: 0 },
  ]);
});

test('the first call creates the app and app_produtos tabs with headers', () => {
  const { ss, script } = setup();
  script.get({ action: 'config' });
  const app = ss.getSheetByName('app');
  assert.deepEqual(app._rows()[0], ['produto', 'mes', 'Data', 'Produto', 'Tamanho', 'Canal', 'Valor Un', 'Unidade',
    'Descontos', 'Taxas', 'Total', 'Cliente', 'Status', 'Pendente', 'Forma Pgmt', 'Conta', 'Notas', 'Frete',
    'Hora', 'Venda', 'Vendedor', 'Situação', 'Cobrado']);
  assert.equal(app.frozenRows, 1);
  assert.deepEqual(ss.getSheetByName('app_produtos')._rows()[0], ['Produto', 'Tamanho', 'Canal', 'Ativo']);
  assert.equal(ss.getSheetByName('app_produtos')._rows().length, 9);
});

test('a product marked inactive disappears from the app', () => {
  const { ss, script } = setup();
  script.get({ action: 'config' });
  ss.getSheetByName('app_produtos').getRange(3, 4).setValue('Não');
  const produtos = script.get({ action: 'config' }).products;
  assert.equal(produtos.length, 7);
  assert.equal(produtos.some((p) => p.tamanho === 750), false);
});

test('a product without a price is left out and reported', () => {
  const { ss, script } = setup();
  script.get({ action: 'config' });
  ss.getSheetByName('app_produtos').appendRow(['Chapéu', 'Unico', 'Feiras', 'Sim']);
  const config = script.get({ action: 'config' });
  assert.equal(config.products.length, 8);
  assert.deepEqual(config.warnings, ['Sem preço na "Tabela de Preço": Chapéu Unico (Feiras)']);
});

test('when the current year has no price yet, the most recent year is used', () => {
  const sheets = seedSheets();
  const ss = createFakeSpreadsheet(sheets);
  const script = loadScript(CODE_GS, ss, { now: new Date('2027-01-10T15:00:00Z') });
  const m375 = script.get({ action: 'config' }).products[0];
  assert.deepEqual(m375, { produto: 'Manticello', tamanho: 375, canal: 'Feiras', preco: 69 });
});

test('the price of the current year wins over older years', () => {
  const { script } = setup((sheets) => {
    sheets['Tabela de Preço'].push(['Manticello375Feiras2027', 'Manticello', 'Licor', 375, 'Feiras', 2027, 79]);
  });
  assert.equal(script.get({ action: 'config' }).products[0].preco, 69);
});

test('sync writes a sale as a Faturamento-shaped row plus the extra columns', () => {
  const { ss, script } = setup();
  const result = script.post({ action: 'sync', sales: [SALE_CREDITO], cancels: [] });
  assert.deepEqual(result, { ok: true, saved: [SALE_CREDITO.id], duplicates: [], canceled: [], notFound: [] });
  const [row] = appRows(ss);
  assert.equal(iso(row[2]), '2026-11-15T03:00:00.000Z'); // midnight in the spreadsheet time zone
  row[2] = 'DATE';
  assert.deepEqual(row, ['Manticello375Feiras', 11, 'DATE', 'Manticello', 375, 'Feiras', 69, 1, 0, 2.1321, 66.8679,
    'Não informado', 'Pago', 0, 'Mercado Pago - Crédito', '', '', '', '14:32:05', '20261115-143205-aaaa', 'Lucas', 'OK', 69]);
});

test('a sale with two products becomes two rows sharing the sale code', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [SALE_TWO_LINES], cancels: [] });
  const rows = appRows(ss);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r[0], r[7], r[8], r[10], r[19], r[22]]), [
    ['Marmelatta260Varejo', 1, 3.3, 36.7, SALE_TWO_LINES.id, 36.7],
    ['CamisetaSoltinhoVarejo', 2, 0, 298, SALE_TWO_LINES.id, 298],
  ]);
});

test('sending the same sale again does not duplicate it', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [SALE_CREDITO], cancels: [] });
  const again = script.post({ action: 'sync', sales: [SALE_CREDITO, SALE_TWO_LINES], cancels: [] });
  assert.deepEqual(again.saved, [SALE_TWO_LINES.id]);
  assert.deepEqual(again.duplicates, [SALE_CREDITO.id]);
  assert.equal(appRows(ss).length, 3);
});

test('the same sale twice in one request is written once', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [SALE_CREDITO, SALE_CREDITO], cancels: [] });
  assert.equal(appRows(ss).length, 1);
});

test('cancelling zeroes the rows, marks them and keeps the original quantity in Notas', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [SALE_CREDITO, SALE_TWO_LINES], cancels: [] });
  const result = script.post({ action: 'sync', sales: [], cancels: [SALE_TWO_LINES.id] });
  assert.deepEqual(result.canceled, [SALE_TWO_LINES.id]);
  const rows = appRows(ss);
  assert.deepEqual(rows[2].slice(6, 11), [149, 0, 0, 0, 0]);
  assert.equal(rows[2][16], 'Cancelada (era 2 un)');
  assert.equal(rows[2][21], 'Cancelada');
  assert.equal(rows[2][22], 0);
  assert.equal(rows[1][21], 'Cancelada');
  assert.equal(rows[0][21], 'OK');
  assert.equal(rows[0][7], 1);
});

test('cancelling twice keeps the note about the original quantity', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [SALE_TWO_LINES], cancels: [SALE_TWO_LINES.id] });
  script.post({ action: 'sync', sales: [], cancels: [SALE_TWO_LINES.id] });
  assert.equal(appRows(ss)[1][16], 'Cancelada (era 2 un)');
});

test('cancelling an unknown sale is reported as not found', () => {
  const { script } = setup();
  const result = script.post({ action: 'sync', sales: [], cancels: ['nope'] });
  assert.deepEqual(result.notFound, ['nope']);
  assert.deepEqual(result.canceled, []);
});

test('a sale cancelled before it was ever sent arrives as cancelled rows', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [{ ...SALE_CREDITO, canceled: true }], cancels: [] });
  const [row] = appRows(ss);
  assert.deepEqual(row.slice(6, 11), [69, 0, 0, 0, 0]);
  assert.equal(row[16], 'Cancelada (era 1 un)');
  assert.equal(row[21], 'Cancelada');
});

test('day returns only the rows of the requested date', () => {
  const { script } = setup();
  script.post({ action: 'sync', sales: [SALE_CREDITO, { ...SALE_TWO_LINES, date: '2026-11-14' }], cancels: [] });
  const day = script.get({ action: 'day', date: '2026-11-15' });
  assert.deepEqual(day, { ok: true, rows: [{
    id: SALE_CREDITO.id, date: '2026-11-15', time: '14:32:05', seller: 'Lucas', payment: 'Mercado Pago - Crédito',
    situacao: 'OK', produto: 'Manticello', tamanho: 375, canal: 'Feiras', valorUn: 69, unidade: 1,
    desconto: 0, taxa: 2.1321, total: 66.8679, cobrado: 69, notas: '',
  }] });
});

test('day tolerates blank rows and rows typed by hand in the app tab', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [SALE_CREDITO], cancels: [] });
  const app = ss.getSheetByName('app');
  app.getRange(4, 4).setValue('anotação solta');
  assert.equal(script.get({ action: 'day', date: '2026-11-15' }).rows.length, 1);
});

test('day on an empty app tab returns no rows', () => {
  const { script } = setup();
  assert.deepEqual(script.get({ action: 'day', date: '2026-11-15' }), { ok: true, rows: [] });
});

test('writes go through the script lock and release it', () => {
  const { script } = setup();
  script.post({ action: 'sync', sales: [SALE_CREDITO], cancels: [] });
  assert.equal(script.lock.waits, 1);
  assert.equal(script.lock.releases, 1);
});

test('text that would become a spreadsheet formula is defused', () => {
  const { ss, script } = setup();
  script.post({ action: 'sync', sales: [{ ...SALE_CREDITO, seller: '=IMPORTRANGE("x","y")' }], cancels: [] });
  assert.equal(appRows(ss)[0][20], 'IMPORTRANGE("x","y")');
});

test('a malformed request is answered with ok false and writes nothing', () => {
  const { ss, script } = setup();
  assert.equal(script.post('not json').ok, false);
  assert.equal(script.post({ action: 'sync', sales: [{ id: 'x', date: '15/11/2026', lines: [] }], cancels: [] }).ok, false);
  assert.equal(script.post({ action: 'sync', sales: [{ ...SALE_CREDITO, lines: [{ ...SALE_CREDITO.lines[0], total: 'abc' }] }] }).ok, false);
  assert.equal(script.post({ action: 'whatever' }).ok, false);
  assert.equal(script.get({ action: 'day', date: 'ontem' }).ok, false);
  assert.equal(ss.getSheetByName('app') ? appRows(ss).length : 0, 0);
});

test('writing past the last grid row of the tab grows the tab first', () => {
  const { ss, script } = setup();
  script.get({ action: 'config' });
  ss.getSheetByName('app')._setMaxRows(2);
  script.post({ action: 'sync', sales: [SALE_CREDITO, SALE_TWO_LINES], cancels: [] });
  assert.equal(appRows(ss).length, 3);
});

test('a missing Taxas tab is explained instead of crashing', () => {
  const { script } = setup((sheets) => { delete sheets.Taxas; });
  const result = script.get({ action: 'config' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Taxas/);
});

test('Faturamento, Tabela de Preço and Taxas are never written', () => {
  const { ss, script } = setup();
  const before = JSON.stringify(['Faturamento', 'Tabela de Preço', 'Taxas'].map((n) => ss.getSheetByName(n)._rows()));
  script.get({ action: 'config' });
  script.post({ action: 'sync', sales: [SALE_CREDITO, SALE_TWO_LINES], cancels: [] });
  script.post({ action: 'sync', sales: [], cancels: [SALE_CREDITO.id] });
  script.get({ action: 'day', date: '2026-11-15' });
  const after = JSON.stringify(['Faturamento', 'Tabela de Preço', 'Taxas'].map((n) => ss.getSheetByName(n)._rows()));
  assert.equal(after, before);
  assert.deepEqual(ss._sheetNames().sort(), ['Faturamento', 'Tabela de Preço', 'Taxas', 'app', 'app_produtos'].sort());
});
