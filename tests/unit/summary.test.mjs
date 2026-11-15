import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, mergeRows } from '../../app/js/summary.js';
import { saleToRows } from '../../app/js/calc.js';
import { SALE_CREDITO, SALE_TWO_LINES } from '../fixtures.mjs';

const SALE_DEBITO = {
  id: 's3', date: '2026-11-15', time: '09:10:00', seller: 'Lucas', payment: 'Mercado Pago - Débito', canceled: false,
  lines: [{ produto: 'Manticello', tamanho: 375, canal: 'Feiras', valorUn: 69, unidade: 2, desconto: 8, taxa: 1.157, total: 128.843, cobrado: 130 }],
};
const rowsOf = (...sales) => sales.flatMap(saleToRows);
const FEES = { feePct: 10, feeFixed: 45 };

test('totals add up what was charged, discounted, paid in fees and left over', () => {
  const s = summarize(rowsOf(SALE_CREDITO, SALE_TWO_LINES, SALE_DEBITO), FEES);
  assert.equal(s.salesCount, 3);
  assert.equal(s.cobrado, 533.7);      // 69 + 36.7 + 298 + 130
  assert.equal(s.descontos, 11.3);     // 3.3 + 8
  assert.equal(s.taxas, 3.29);         // 2.1321 + 1.157 = 3.2891
  assert.equal(s.liquido, 530.41);     // 533.7 − 3.2891
});

test('fair cost is the percentage of the net total plus the fixed amount', () => {
  const s = summarize(rowsOf(SALE_CREDITO, SALE_TWO_LINES, SALE_DEBITO), FEES);
  assert.equal(s.feiraCost, 98.04);    // 530.4109 × 10% + 45
  assert.equal(summarize([], FEES).feiraCost, 45);
  assert.equal(summarize(rowsOf(SALE_CREDITO), { feePct: 0, feeFixed: 0 }).feiraCost, 0);
});

test('by payment method: sales, charged, fee and net, biggest first', () => {
  const s = summarize(rowsOf(SALE_CREDITO, SALE_TWO_LINES, SALE_DEBITO), FEES);
  assert.deepEqual(s.byPayment, [
    { chave: 'PIX', vendas: 1, cobrado: 334.7, taxa: 0, liquido: 334.7 },
    { chave: 'Mercado Pago - Débito', vendas: 1, cobrado: 130, taxa: 1.16, liquido: 128.84 },
    { chave: 'Mercado Pago - Crédito', vendas: 1, cobrado: 69, taxa: 2.13, liquido: 66.87 },
  ]);
});

test('by product and size: units and net, like the fechamento tab', () => {
  const s = summarize(rowsOf(SALE_CREDITO, SALE_TWO_LINES, SALE_DEBITO), FEES);
  assert.deepEqual(s.byProduct, [
    { produto: 'Camiseta', tamanho: 'Soltinho', unidades: 2, liquido: 298 },
    { produto: 'Manticello', tamanho: 375, unidades: 3, liquido: 195.71 },
    { produto: 'Marmelatta', tamanho: 260, unidades: 1, liquido: 36.7 },
  ]);
});

test('sales are listed newest first with what the bank statement will show', () => {
  const s = summarize(rowsOf(SALE_CREDITO, SALE_TWO_LINES, SALE_DEBITO), FEES);
  assert.deepEqual(s.sales.map((v) => v.time), ['15:00:00', '14:32:05', '09:10:00']);
  assert.deepEqual(s.sales[0], {
    id: SALE_TWO_LINES.id, time: '15:00:00', seller: 'Ana', payment: 'PIX', canceled: false,
    cobrado: 334.7, taxa: 0, liquido: 334.7, desconto: 3.3,
    items: [{ produto: 'Marmelatta', tamanho: 260, unidade: 1 }, { produto: 'Camiseta', tamanho: 'Soltinho', unidade: 2 }],
  });
});

test('a cancelled sale stays in the list but out of every total', () => {
  const s = summarize(rowsOf(SALE_CREDITO, { ...SALE_TWO_LINES, canceled: true }), FEES);
  assert.equal(s.salesCount, 1);
  assert.equal(s.cobrado, 69);
  assert.deepEqual(s.byPayment.map((p) => p.chave), ['Mercado Pago - Crédito']);
  assert.deepEqual(s.byProduct.map((p) => p.produto), ['Manticello']);
  const canceled = s.sales.find((v) => v.id === SALE_TWO_LINES.id);
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.cobrado, 0);
});

test('the last sale time of each seller is reported', () => {
  const s = summarize(rowsOf(SALE_CREDITO, SALE_TWO_LINES, SALE_DEBITO), FEES);
  assert.deepEqual(s.lastBySeller, { Lucas: '14:32:05', Ana: '15:00:00' });
});

test('an empty day is all zeros', () => {
  const s = summarize([], FEES);
  assert.deepEqual([s.salesCount, s.cobrado, s.descontos, s.taxas, s.liquido], [0, 0, 0, 0, 0]);
  assert.deepEqual([s.byPayment, s.byProduct, s.sales, s.lastBySeller], [[], [], [], {}]);
});

test('merge: the other phone comes from the sheet, unsent sales from this phone', () => {
  const server = rowsOf(SALE_TWO_LINES);
  const local = [{ ...SALE_CREDITO, sync: 'pending', cancelSync: null }];
  const ids = mergeRows(server, local).map((r) => r.id);
  assert.deepEqual(ids.sort(), [SALE_CREDITO.id, SALE_TWO_LINES.id, SALE_TWO_LINES.id].sort());
});

test('merge: a sale present on both sides is counted once', () => {
  const merged = mergeRows(rowsOf(SALE_CREDITO), [{ ...SALE_CREDITO, sync: 'sent', cancelSync: null }]);
  assert.equal(merged.length, 1);
});

test('merge: a sent sale uses the sheet version, which may have been corrected by hand', () => {
  const corrected = rowsOf(SALE_CREDITO).map((r) => ({ ...r, payment: 'PIX' }));
  const merged = mergeRows(corrected, [{ ...SALE_CREDITO, sync: 'sent', cancelSync: null }]);
  assert.equal(merged[0].payment, 'PIX');
});

test('merge: a cancellation not yet sent already shows as cancelled', () => {
  const merged = mergeRows(rowsOf(SALE_CREDITO), [{ ...SALE_CREDITO, canceled: true, sync: 'sent', cancelSync: 'pending' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].situacao, 'Cancelada');
});

test('merge: with nothing from the sheet, this phone still shows its sent sales', () => {
  const merged = mergeRows([], [{ ...SALE_CREDITO, sync: 'sent', cancelSync: null }]);
  assert.equal(merged.length, 1);
});

test('merge: a cancellation already sent wins over an older copy of the sheet', () => {
  const stale = rowsOf(SALE_CREDITO); // read before the cancellation reached the sheet
  const merged = mergeRows(stale, [{ ...SALE_CREDITO, canceled: true, sync: 'sent', cancelSync: 'sent' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].situacao, 'Cancelada');
});
