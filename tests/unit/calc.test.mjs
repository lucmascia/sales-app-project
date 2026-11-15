import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, allocateDiscount, buildSale, saleToRows, newSaleId } from '../../app/js/calc.js';

const CREDITO = { chave: 'Mercado Pago - Crédito', taxa: 0.0309 };
const DEBITO = { chave: 'Mercado Pago - Débito', taxa: 0.0089 };
const PIX = { chave: 'PIX', taxa: 0 };
const M375 = { produto: 'Manticello', tamanho: 375, canal: 'Feiras', preco: 69 };
const M750 = { produto: 'Manticello', tamanho: 750, canal: 'Feiras', preco: 129 };
const CAMISETA = { produto: 'Camiseta', tamanho: 'Soltinho', canal: 'Varejo', preco: 149 };
const MARM260 = { produto: 'Marmelatta', tamanho: 260, canal: 'Varejo', preco: 40 };
const NOW = new Date(2026, 10, 15, 14, 32, 5);

const sale = (cart, payment, finalTotal = null) =>
  buildSale({ cart, payment, finalTotal, seller: 'Lucas', now: NOW, id: 'v1' });

// Expected values below are copied from real rows of the "Faturamento" tab.
test('one Manticello 375 on credit: fee 2.1321, net 66.8679', () => {
  const [line] = sale([{ ...M375, qty: 1 }], CREDITO).lines;
  assert.deepEqual(line, {
    produto: 'Manticello', tamanho: 375, canal: 'Feiras', valorUn: 69, unidade: 1,
    desconto: 0, taxa: 2.1321, total: 66.8679, cobrado: 69,
  });
});

test('eleven Manticello 375 on credit: fee 23.4531, net 735.5469', () => {
  const [line] = sale([{ ...M375, qty: 11 }], CREDITO).lines;
  assert.equal(line.taxa, 23.4531);
  assert.equal(line.total, 735.5469);
  assert.equal(line.cobrado, 759);
});

test('camiseta on credit: fee 4.6041, net 144.3959', () => {
  const [line] = sale([{ ...CAMISETA, qty: 1 }], CREDITO).lines;
  assert.equal(line.taxa, 4.6041);
  assert.equal(line.total, 144.3959);
});

test('one Manticello 375 on debit: fee 0.6141, net 68.3859', () => {
  const [line] = sale([{ ...M375, qty: 1 }], DEBITO).lines;
  assert.equal(line.taxa, 0.6141);
  assert.equal(line.total, 68.3859);
});

test('two Manticello 375 by PIX rounded down to 129: discount 9, net 129', () => {
  const [line] = sale([{ ...M375, qty: 2 }], PIX, 129).lines;
  assert.equal(line.desconto, 9);
  assert.equal(line.taxa, 0);
  assert.equal(line.total, 129);
  assert.equal(line.cobrado, 129);
});

test('258 rounded down to 250: discount 8, and the fee is charged on what was paid', () => {
  const [line] = sale([{ ...M750, qty: 2 }], CREDITO, 250).lines;
  assert.equal(line.desconto, 8);
  assert.equal(line.cobrado, 250);
  assert.equal(line.taxa, 7.725);
  assert.equal(line.total, 242.275);
});

test('discount is split across lines in proportion to their value and adds up exactly', () => {
  const s = sale([{ ...MARM260, qty: 1 }, { ...M375, qty: 1 }], PIX, 100);
  assert.deepEqual(s.lines.map((l) => l.desconto), [3.3, 5.7]);
  assert.deepEqual(s.lines.map((l) => l.cobrado), [36.7, 63.3]);
});

test('allocateDiscount hands leftover cents to the largest remainders', () => {
  assert.deepEqual(allocateDiscount([10, 10, 10], 1), [0.34, 0.33, 0.33]);
  assert.deepEqual(allocateDiscount([69], 0), [0]);
});

test('a final value of zero is accepted (gift)', () => {
  const [line] = sale([{ ...M375, qty: 1 }], PIX, 0).lines;
  assert.equal(line.desconto, 69);
  assert.equal(line.total, 0);
});

test('a final value above the gross total, a negative one, or an empty cart is refused', () => {
  assert.throws(() => sale([{ ...M750, qty: 2 }], PIX, 300), /maior/);
  assert.throws(() => sale([{ ...M750, qty: 2 }], PIX, -1), /negativo/);
  assert.throws(() => sale([], PIX), /vazio/);
  assert.throws(() => sale([{ ...M750, qty: 0 }], PIX), /vazio/);
});

test('the sale carries id, seller, payment key and the phone clock date and time', () => {
  const s = buildSale({ cart: [{ ...M375, qty: 1 }], payment: PIX, finalTotal: null, seller: 'Lucas',
    now: new Date(2026, 10, 15, 23, 59, 5), id: 'abc' });
  assert.equal(s.id, 'abc');
  assert.equal(s.seller, 'Lucas');
  assert.equal(s.payment, 'PIX');
  assert.equal(s.date, '2026-11-15');
  assert.equal(s.time, '23:59:05');
  assert.equal(s.canceled, false);
});

test('the sale keeps the price it was sold at, whatever the catalogue says later', () => {
  const product = { ...M375 };
  const s = sale([{ ...product, qty: 1 }], PIX);
  product.preco = 75;
  assert.equal(s.lines[0].valorUn, 69);
  assert.equal(saleToRows(s)[0].valorUn, 69);
});

test('saleToRows gives one row per line with the sale data repeated', () => {
  const rows = saleToRows(sale([{ ...M375, qty: 2 }, { ...CAMISETA, qty: 1 }], CREDITO));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    id: 'v1', date: '2026-11-15', time: '14:32:05', seller: 'Lucas', payment: 'Mercado Pago - Crédito',
    situacao: 'OK', produto: 'Camiseta', tamanho: 'Soltinho', canal: 'Varejo', valorUn: 149, unidade: 1,
    desconto: 0, taxa: 4.6041, total: 144.3959, cobrado: 149, notas: '',
  });
});

test('a cancelled sale turns into zeroed rows that remember the original quantity', () => {
  const s = sale([{ ...M375, qty: 2 }], CREDITO);
  const [row] = saleToRows({ ...s, canceled: true });
  assert.equal(row.situacao, 'Cancelada');
  assert.deepEqual([row.unidade, row.desconto, row.taxa, row.total, row.cobrado], [0, 0, 0, 0, 0]);
  assert.equal(row.valorUn, 69);
  assert.equal(row.notas, 'Cancelada (era 2 un)');
});

test('parseMoney reads what a seller types', () => {
  assert.equal(parseMoney('250'), 250);
  assert.equal(parseMoney('250,50'), 250.5);
  assert.equal(parseMoney('250.50'), 250.5);
  assert.equal(parseMoney(' R$ 1.250,00 '), 1250);
  assert.equal(parseMoney('0'), 0);
});

test('parseMoney refuses what is not an amount', () => {
  for (const bad of ['', '   ', 'abc', '12,345', '-5', '1,2,3', null, undefined]) {
    assert.equal(parseMoney(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('newSaleId is date, time and a random tail', () => {
  assert.equal(newSaleId(NOW, () => 0.5), '20261115-143205-i000');
  assert.notEqual(newSaleId(NOW), newSaleId(NOW));
});
