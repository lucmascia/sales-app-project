// Sale arithmetic. Pure functions, no browser APIs, so the same numbers can be
// checked against real rows of the "Faturamento" tab in the unit tests.
//
// Per line, exactly as the spreadsheet formulas do it:
//   taxa  = taxa% × (valorUn × unidade − desconto)   (not rounded to cents)
//   total = valorUn × unidade − desconto − taxa

const pad = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round(n * 100) / 100;
// Fee rates have 4 decimals and amounts 2, so 6 decimals hold every exact
// value; rounding there only removes binary floating-point noise.
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Reads an amount as typed by a seller ("250", "250,50", "R$ 1.250,00"). Returns null if it is not one. */
export function parseMoney(text) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/R\$/i, '').replace(/\s/g, '');
  let normalized;
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})?$/.test(s)) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    normalized = s;
  } else {
    return null;
  }
  return Number(normalized);
}

/** Splits a discount across lines in proportion to their gross value; the parts add up exactly. */
export function allocateDiscount(grossList, discount) {
  const totalCents = Math.round(discount * 100);
  const grossTotal = grossList.reduce((a, b) => a + b, 0);
  if (totalCents === 0 || grossTotal === 0) return grossList.map(() => 0);
  const exact = grossList.map((g) => (totalCents * g) / grossTotal);
  const cents = exact.map(Math.floor);
  let left = totalCents - cents.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, rest: e - cents[i] }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    cents[i] += 1;
    left -= 1;
  }
  return cents.map((c) => c / 100);
}

export function newSaleId(now, rand = Math.random) {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const tail = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0');
  return `${stamp}-${tail}`;
}

/**
 * Turns a cart into a sale.
 * cart: [{produto, tamanho, canal, preco, qty}] · payment: {chave, taxa}
 * finalTotal: what the customer actually pays when a discount was given, else null.
 */
export function buildSale({ cart, payment, finalTotal, seller, now, id }) {
  const items = cart.filter((item) => item.qty > 0);
  if (items.length === 0) throw new Error('Carrinho vazio.');
  const gross = items.map((item) => round2(item.preco * item.qty));
  const grossTotal = round2(gross.reduce((a, b) => a + b, 0));
  let discount = 0;
  if (finalTotal !== null && finalTotal !== undefined) {
    if (!(finalTotal >= 0)) throw new Error('O valor final não pode ser negativo.');
    if (finalTotal > grossTotal) throw new Error('O valor final não pode ser maior que o total.');
    discount = round2(grossTotal - finalTotal);
  }
  const discounts = allocateDiscount(gross, discount);
  const lines = items.map((item, i) => {
    const cobrado = round2(gross[i] - discounts[i]);
    const taxa = round6(payment.taxa * cobrado);
    return {
      produto: item.produto,
      tamanho: item.tamanho,
      canal: item.canal,
      valorUn: item.preco,
      unidade: item.qty,
      desconto: discounts[i],
      taxa,
      total: round6(cobrado - taxa),
      cobrado,
    };
  });
  return {
    id,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    seller,
    payment: payment.chave,
    canceled: false,
    lines,
  };
}

/** One flat row per line, in the shape the closing screen and the spreadsheet share. */
export function saleToRows(sale) {
  return sale.lines.map((line) => {
    const base = {
      id: sale.id, date: sale.date, time: sale.time, seller: sale.seller, payment: sale.payment,
      situacao: sale.canceled ? 'Cancelada' : 'OK',
      produto: line.produto, tamanho: line.tamanho, canal: line.canal, valorUn: line.valorUn,
    };
    if (sale.canceled) {
      return { ...base, unidade: 0, desconto: 0, taxa: 0, total: 0, cobrado: 0, notas: `Cancelada (era ${line.unidade} un)` };
    }
    return { ...base, unidade: line.unidade, desconto: line.desconto, taxa: line.taxa, total: line.total, cobrado: line.cobrado, notas: '' };
  });
}
