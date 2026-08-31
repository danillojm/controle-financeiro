import { addMonths, dueDateFor, invoiceMonthFor, splitAmount } from './models';
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
});
