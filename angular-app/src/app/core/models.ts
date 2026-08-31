export type Kind = 'expense' | 'income';
export type Responsibility = 'own' | 'receivable' | 'payable';
export interface Person {
  id: string;
  name: string;
  is_self: boolean;
  archived_at?: string | null;
}
export interface Card {
  id: string;
  name: string;
  closing_day?: number | null;
  due_day?: number | null;
  archived_at?: string | null;
}
export interface Category {
  id: string;
  name: string;
  kind: Kind | 'both';
  color: string;
  icon: string;
  archived_at?: string | null;
}
export interface Account {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  color: string;
  archived_at?: string | null;
}
export interface Transaction {
  id: string;
  user_id: string;
  kind: Kind;
  description: string;
  category_id?: string | null;
  payment_method: string;
  card_id?: string | null;
  account_id?: string | null;
  person_id?: string | null;
  responsibility: Responsibility;
  amount_total: number;
  installment_number: number;
  installments_total: number;
  installment_amount: number;
  purchase_date: string;
  invoice_month: string;
  due_date?: string | null;
  series_id: string;
  reimbursement_status?: string | null;
  amount_received: number;
  notes?: string | null;
  people?: Pick<Person, 'name' | 'is_self'> | null;
  cards?: Pick<Card, 'name'> | null;
  accounts?: Pick<Account, 'name'> | null;
}
export interface Settlement {
  id: string;
  transaction_id: string;
  account_id?: string | null;
  direction: 'received' | 'paid';
  amount: number;
  settled_at: string;
  notes?: string | null;
  source?: string;
}
export interface Transfer {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transfer_date: string;
  description?: string | null;
}
export interface InvoicePayment {
  id: string;
  card_id: string;
  account_id?: string | null;
  invoice_month: string;
  amount: number;
  paid_at: string;
  notes?: string | null;
}
export interface Budget {
  id: string;
  category_id: string;
  month: string;
  amount: number;
}
export interface AppError {
  id: string;
  context?: string;
  message: string;
  created_at: string;
}
export const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const currencyInput = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const parseBrazilianCurrency = (raw: string | number | null | undefined) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const value = String(raw ?? '')
    .trim()
    .replace(/R\$|\s/g, '');
  if (!value) return null;
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^-/, '').replace(/[^\d.,]/g, '');
  let normalized: string;
  if (unsigned.includes(',')) {
    normalized = unsigned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(unsigned)) {
    normalized = unsigned.replace(/\./g, '');
  } else {
    const parts = unsigned.split('.');
    normalized = parts.length > 2 ? `${parts.slice(0, -1).join('')}.${parts.at(-1)}` : unsigned;
  }
  const parsed = Number(`${negative ? '-' : ''}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
};
export const formatBrazilianCurrencyTyping = (raw: string) => {
  const negative = raw.trim().startsWith('-');
  const clean = raw.replace(/[^\d,]/g, '');
  const [integerRaw = '', decimalRaw] = clean.split(',');
  const integerDigits = integerRaw.replace(/^0+(?=\d)/, '') || '0';
  const grouped = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
    Number(integerDigits),
  );
  const decimals = decimalRaw === undefined ? undefined : decimalRaw.slice(0, 2);
  const display = `${negative ? '-' : ''}${grouped}${decimals === undefined ? '' : `,${decimals}`}`;
  const value = Number(`${negative ? '-' : ''}${integerDigits}.${decimals || '0'}`);
  return { display, value: Number.isFinite(value) ? value : null };
};
export const today = () => new Date().toLocaleDateString('en-CA');
export const currentMonth = () => today().slice(0, 7);
export const monthStart = (month: string) => `${month.slice(0, 7)}-01`;
export const addMonths = (month: string, count: number) => {
  const [year, value] = month.split('-').map(Number),
    date = new Date(year, value - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
export const invoiceMonthFor = (purchaseDate: string, closingDay?: number | null) => {
  const month = purchaseDate.slice(0, 7);
  return closingDay && Number(purchaseDate.slice(8, 10)) >= closingDay
    ? addMonths(month, 1)
    : month;
};
export const dueDateFor = (month: string, dueDay?: number | null) => {
  if (!month || !dueDay) return '';
  const [year, value] = month.split('-').map(Number);
  const lastDay = new Date(year, value, 0).getDate();
  return `${month}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}`;
};
export const splitAmount = (amount: number, count: number) => {
  const cents = Math.round(amount * 100),
    base = Math.floor(cents / count),
    remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
};
