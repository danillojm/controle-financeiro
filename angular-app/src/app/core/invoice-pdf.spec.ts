import { describe, expect, it } from 'vitest';
import { parseInvoicePdfLines } from './invoice-pdf';

describe('extração de compras da fatura em PDF', () => {
  it('reconhece datas brasileiras, descrições e valores', () => {
    expect(
      parseInvoicePdfLines(
        ['02/08/2026 SUPERMERCADO CENTRAL R$ 1.234,56', '15/08/2026 INTERNET 119,90'],
        '2026-08',
      ),
    ).toEqual([
      ['2026-08-02', 'SUPERMERCADO CENTRAL', 'R$ 1.234,56'],
      ['2026-08-15', 'INTERNET', '119,90'],
    ]);
  });

  it('infere o ano em datas abreviadas e preserva parcelas', () => {
    expect(
      parseInvoicePdfLines(
        ['28 DEZ LOJA MOTO - PARCELA 02/12 500,00', '03 JAN PADARIA 20,50'],
        '2027-01',
      ),
    ).toEqual([
      ['2026-12-28', 'LOJA MOTO - PARCELA 02/12', '500,00'],
      ['2027-01-03', 'PADARIA', '20,50'],
    ]);
  });

  it('marca créditos e ignora cabeçalhos e totais sem data', () => {
    expect(
      parseInvoicePdfLines(
        ['DATA DESCRIÇÃO VALOR', '10/08/2026 ESTORNO COMPRA 45,00 CR', 'TOTAL 45,00'],
        '2026-08',
      ),
    ).toEqual([['2026-08-10', 'ESTORNO COMPRA', '-45,00']]);
  });
});
