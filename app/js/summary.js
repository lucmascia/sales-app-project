// Day closing arithmetic. Works on flat rows (see saleToRows in calc.js), the
// same shape the spreadsheet script returns, so sales from both phones and
// unsent local ones can be added up together.
import { saleToRows } from './calc.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Joins what the sheet has with what this phone knows.
 * The sheet wins for sales it has already received (someone may have fixed a
 * row by hand); this phone wins for anything it has not finished sending and
 * for its own cancellations, which a stale copy of the sheet may not show yet.
 */
export function mergeRows(serverRows, localSales) {
  const onServer = new Set(serverRows.map((r) => r.id));
  const useLocal = localSales.filter((s) => s.sync === 'pending' || s.cancelSync === 'pending' || s.canceled || !onServer.has(s.id));
  const replaced = new Set(useLocal.map((s) => s.id));
  return [...serverRows.filter((r) => !replaced.has(r.id)), ...useLocal.flatMap(saleToRows)];
}

export function summarize(rows, { feePct, feeFixed }) {
  const salesById = new Map();
  const byPayment = new Map();
  const byProduct = new Map();
  const lastBySeller = {};
  let cobrado = 0, descontos = 0, taxas = 0, liquido = 0;

  for (const row of rows) {
    if (!salesById.has(row.id)) {
      salesById.set(row.id, {
        id: row.id, time: row.time, seller: row.seller, payment: row.payment, canceled: true,
        cobrado: 0, taxa: 0, liquido: 0, desconto: 0, items: [],
      });
    }
    const sale = salesById.get(row.id);
    sale.items.push({ produto: row.produto, tamanho: row.tamanho, unidade: row.unidade });
    if (!lastBySeller[row.seller] || row.time > lastBySeller[row.seller]) lastBySeller[row.seller] = row.time;
    if (row.situacao === 'Cancelada') continue;

    sale.canceled = false;
    sale.cobrado += row.cobrado;
    sale.taxa += row.taxa;
    sale.liquido += row.total;
    sale.desconto += row.desconto;
    cobrado += row.cobrado;
    descontos += row.desconto;
    taxas += row.taxa;
    liquido += row.total;

    const productKey = `${row.produto}|${row.tamanho}`;
    if (!byProduct.has(productKey)) byProduct.set(productKey, { produto: row.produto, tamanho: row.tamanho, unidades: 0, liquido: 0 });
    const product = byProduct.get(productKey);
    product.unidades += row.unidade;
    product.liquido += row.total;
  }

  const sales = [...salesById.values()];
  for (const sale of sales) {
    if (sale.canceled) continue;
    if (!byPayment.has(sale.payment)) byPayment.set(sale.payment, { chave: sale.payment, vendas: 0, cobrado: 0, taxa: 0, liquido: 0 });
    const payment = byPayment.get(sale.payment);
    payment.vendas += 1;
    payment.cobrado += sale.cobrado;
    payment.taxa += sale.taxa;
    payment.liquido += sale.liquido;
  }

  const money = (obj, keys) => { for (const k of keys) obj[k] = round2(obj[k]); return obj; };
  const bySize = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR'));

  return {
    salesCount: sales.filter((s) => !s.canceled).length,
    cobrado: round2(cobrado),
    descontos: round2(descontos),
    taxas: round2(taxas),
    liquido: round2(liquido),
    feiraCost: round2((liquido * feePct) / 100 + feeFixed),
    byPayment: [...byPayment.values()].sort((a, b) => b.cobrado - a.cobrado).map((p) => money(p, ['cobrado', 'taxa', 'liquido'])),
    byProduct: [...byProduct.values()]
      .sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR') || bySize(a.tamanho, b.tamanho))
      .map((p) => money(p, ['liquido'])),
    sales: sales.sort((a, b) => b.time.localeCompare(a.time)).map((s) => money(s, ['cobrado', 'taxa', 'liquido', 'desconto'])),
    lastBySeller,
  };
}
