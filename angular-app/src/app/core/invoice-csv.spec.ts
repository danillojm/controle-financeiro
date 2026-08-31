import { describe, expect, it } from 'vitest';
import {
  detectInvoiceColumns,
  invoiceFingerprint,
  parseInvoiceAmount,
  parseInvoiceCsv,
  parseInvoiceDate,
} from './invoice-csv';

describe('importação de fatura CSV', () => {
  it('lê CSV brasileiro com campos entre aspas', () => {
    const csv = parseInvoiceCsv('Data;Descrição;Valor\n31/08/2026;"Mercado, bairro";4.400,00\n');
    expect(csv.delimiter).toBe(';');
    expect(csv.records[0]).toEqual(['31/08/2026', 'Mercado, bairro', '4.400,00']);
    expect(detectInvoiceColumns(csv.headers)).toEqual({ date: 0, description: 1, amount: 2 });
  });

  it('lê o formato date,title,amount usado por bancos digitais', () => {
    const csv = parseInvoiceCsv('date,title,amount\n2026-08-20,Internet,119.90');
    expect(detectInvoiceColumns(csv.headers)).toEqual({ date: 0, description: 1, amount: 2 });
  });

  it('converte datas e valores brasileiros ou internacionais', () => {
    expect(parseInvoiceDate('31/08/2026')).toBe('2026-08-31');
    expect(parseInvoiceDate('2026-08-31 10:30')).toBe('2026-08-31');
    expect(parseInvoiceDate('31/02/2026')).toBe('');
    expect(parseInvoiceAmount('R$ 4.400,00')).toBe(4400);
    expect(parseInvoiceAmount('4,400.00')).toBe(4400);
    expect(parseInvoiceAmount('119.9')).toBe(119.9);
    expect(parseInvoiceAmount('-119,90')).toBe(-119.9);
  });

  it('diferencia a mesma compra em faturas mensais distintas', async () => {
    const august = await invoiceFingerprint('card', '2026-08', '2026-01-10', 'Moto 1/12', 500, 0),
      september = await invoiceFingerprint('card', '2026-09', '2026-01-10', 'Moto 1/12', 500, 0);
    expect(august).not.toBe(september);
  });
});
