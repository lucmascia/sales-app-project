// Data copied from the real "Manticello" spreadsheet (read on 2026-11-15).
import { fileURLToPath } from 'node:url';

export const CODE_GS = fileURLToPath(new URL('../apps-script/Code.gs', import.meta.url));
export const NOW = new Date('2026-11-15T17:32:05Z'); // 14:32:05 in São Paulo

const PRICE_HEADER = ['chaveVLOOKUP', 'Produto', 'Tipo', 'Tamanho', 'Canal', 'Ano efetivo', 'Valor Un'];
const PRICES = [
  ['Manticello', 'Licor', 375, 'Varejo', 2025, 49],
  ['Manticello', 'Licor', 375, 'Feiras', 2025, 69],
  ['Camiseta', 'Vestuário', 'Soltinho', 'Varejo', 2025, 149],
  ['Camiseta', 'Vestuário', 'Solto', 'Varejo', 2025, 149],
  ['Camiseta', 'Vestuário', 'Soltão', 'Varejo', 2025, 149],
  ['Manticello', 'Licor', 750, 'Varejo', 2025, 99],
  ['Manticello', 'Licor', 750, 'Varejo', 2026, 109],
  ['Manticello', 'Licor', 375, 'Varejo', 2026, 59],
  ['Manticello', 'Licor', 375, 'Feiras', 2026, 69],
  ['Camiseta', 'Vestuário', 'Solto', 'Varejo', 2026, 149],
  ['Camiseta', 'Vestuário', 'Soltinho', 'Varejo', 2026, 149],
  ['Camiseta', 'Vestuário', 'Soltão', 'Varejo', 2026, 149],
  ['Bolsa', 'Vestuário', 'Unico', 'Varejo', 2026, 89],
  ['Manticello', 'Licor', 750, 'Feiras', 2026, 129],
  ['Sacola Linho', 'Embalagem', 'Unico', 'Feiras', 2026, 15],
  ['Marmelatta', 'Geléia 120g', 120, 'Feiras', 2026, 25],
  ['Marmelatta', 'Geléia 120g', 120, 'Varejo', 2026, 29],
  ['Marmelatta', 'Geléia 260g', 260, 'Varejo', 2026, 40],
];

const FATURAMENTO = [
  ['produto', 'mes', 'Data', 'Produto', 'Tamanho', 'Canal', 'Valor Un', 'Unidade', 'Descontos', 'Taxas', 'Total'],
  ['Manticello375Feiras', 11, new Date('2026-11-07T03:00:00Z'), 'Manticello', 375, 'Feiras', 69, 1, 0, 2.1321, 66.8679],
];

export function seedSheets() {
  return {
    Faturamento: FATURAMENTO.map((r) => r.slice()),
    'Tabela de Preço': [PRICE_HEADER, ...PRICES.map((p) => [`${p[0]}${p[2]}${p[3]}${p[4]}`, ...p])],
    Taxas: [
      ['Chave', 'Maquininha', 'Operação', 'Taxa %'],
      ['Mercado Pago - Crédito', 'Mercado Pago', 'Crédito', 0.0309],
      ['Mercado Pago - Débito', 'Mercado Pago', 'Débito', 0.0089],
      ['Dinheiro', '', 'Dinheiro', 0],
      ['PIX', '', 'PIX', 0],
    ],
  };
}

export const SALE_CREDITO = {
  id: '20261115-143205-aaaa', date: '2026-11-15', time: '14:32:05', seller: 'Lucas',
  payment: 'Mercado Pago - Crédito', canceled: false,
  lines: [{ produto: 'Manticello', tamanho: 375, canal: 'Feiras', valorUn: 69, unidade: 1, desconto: 0, taxa: 2.1321, total: 66.8679, cobrado: 69 }],
};

export const SALE_TWO_LINES = {
  id: '20261115-150000-bbbb', date: '2026-11-15', time: '15:00:00', seller: 'Ana',
  payment: 'PIX', canceled: false,
  lines: [
    { produto: 'Marmelatta', tamanho: 260, canal: 'Varejo', valorUn: 40, unidade: 1, desconto: 3.3, taxa: 0, total: 36.7, cobrado: 36.7 },
    { produto: 'Camiseta', tamanho: 'Soltinho', canal: 'Varejo', valorUn: 149, unidade: 2, desconto: 0, taxa: 0, total: 298, cobrado: 298 },
  ],
};
