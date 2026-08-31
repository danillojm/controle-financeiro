import { addMonths, splitAmount } from './models';
describe('finance helpers', () => {
  it('divide centavos sem perder valor', () => {
    expect(splitAmount(100, 3)).toEqual([33.34, 33.33, 33.33]);
  });
  it('avança meses entre anos', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });
});
