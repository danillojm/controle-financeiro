import {
  addMonths,
  dueDateFor,
  formatBrazilianCurrencyTyping,
  invoiceMonthFor,
  parseBrazilianCurrency,
  splitAmount,
} from './models';
describe('finance helpers', () => {
  it('divide centavos sem perder valor', () => {
    expect(splitAmount(100, 3)).toEqual([33.34, 33.33, 33.33]);
  });
  it('avança meses entre anos', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });
  it('calcula fechamento e vencimento do cartão', () => {
    expect(invoiceMonthFor('2026-08-10', 10)).toBe('2026-09');
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28');
  });
  it('interpreta valores no formato brasileiro', () => {
    expect(parseBrazilianCurrency('4.400')).toBe(4400);
    expect(parseBrazilianCurrency('4.400,50')).toBe(4400.5);
    expect(parseBrazilianCurrency('4,40')).toBe(4.4);
    expect(parseBrazilianCurrency('4400')).toBe(4400);
  });
  it('formata milhares automaticamente durante a digitação', () => {
    expect(formatBrazilianCurrencyTyping('4400')).toEqual({ display: '4.400', value: 4400 });
    expect(formatBrazilianCurrencyTyping('4.4000')).toEqual({ display: '44.000', value: 44000 });
    expect(formatBrazilianCurrencyTyping('4400,5')).toEqual({ display: '4.400,5', value: 4400.5 });
  });
});
