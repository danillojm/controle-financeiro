import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Account,
  AppError,
  Budget,
  Card,
  Category,
  InvoicePayment,
  Person,
  Settlement,
  Transaction,
  Transfer,
  today,
} from './models';
import { SupabaseService } from './supabase.service';
@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly sb = inject(SupabaseService).client;
  readonly loading = signal(false);
  readonly userId = signal('');
  readonly people = signal<Person[]>([]);
  readonly cards = signal<Card[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly transactions = signal<Transaction[]>([]);
  readonly settlements = signal<Settlement[]>([]);
  readonly transfers = signal<Transfer[]>([]);
  readonly invoicePayments = signal<InvoicePayment[]>([]);
  readonly budgets = signal<Budget[]>([]);
  readonly errors = signal<AppError[]>([]);
  readonly activePeople = computed(() => this.people().filter((x) => !x.is_self && !x.archived_at));
  readonly activeCards = computed(() => this.cards().filter((x) => !x.archived_at));
  readonly activeCategories = computed(() => this.categories().filter((x) => !x.archived_at));
  readonly activeAccounts = computed(() => this.accounts().filter((x) => !x.archived_at));
  async initialize(userId: string) {
    this.userId.set(userId);
    await this.ensureSeed();
    await this.load();
  }
  private async ensureSeed() {
    const user_id = this.userId(),
      { data } = await this.sb
        .from('people')
        .select('id')
        .eq('user_id', user_id)
        .eq('is_self', true)
        .limit(1);
    if (!data?.length) {
      const { error } = await this.sb
        .from('people')
        .upsert({ user_id, name: 'Eu', is_self: true }, { onConflict: 'user_id,name' });
      if (error) throw error;
    }
  }
  async load() {
    this.loading.set(true);
    const id = this.userId();
    try {
      const q = await Promise.all([
        this.sb.from('people').select('*').eq('user_id', id).order('name'),
        this.sb.from('cards').select('*').eq('user_id', id).order('name'),
        this.sb.from('categories').select('*').eq('user_id', id).order('name'),
        this.sb.from('accounts').select('*').eq('user_id', id).order('name'),
        this.sb
          .from('transactions')
          .select('*,people(name,is_self),cards(name),accounts(name)')
          .eq('user_id', id)
          .order('invoice_month', { ascending: false }),
        this.sb
          .from('settlements')
          .select('*')
          .eq('user_id', id)
          .order('settled_at', { ascending: false }),
        this.sb
          .from('transfers')
          .select('*')
          .eq('user_id', id)
          .order('transfer_date', { ascending: false }),
        this.sb
          .from('card_invoice_payments')
          .select('*')
          .eq('user_id', id)
          .order('paid_at', { ascending: false }),
        this.sb.from('budgets').select('*').eq('user_id', id),
        this.sb
          .from('app_errors')
          .select('id,context,message,created_at')
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      const failed = q.find((x) => x.error);
      if (failed?.error) throw failed.error;
      this.people.set((q[0].data || []) as Person[]);
      this.cards.set((q[1].data || []) as Card[]);
      this.categories.set((q[2].data || []) as Category[]);
      this.accounts.set((q[3].data || []) as Account[]);
      this.transactions.set((q[4].data || []) as Transaction[]);
      this.settlements.set((q[5].data || []) as Settlement[]);
      this.transfers.set((q[6].data || []) as Transfer[]);
      this.invoicePayments.set((q[7].data || []) as InvoicePayment[]);
      this.budgets.set((q[8].data || []) as Budget[]);
      this.errors.set((q[9].data || []) as AppError[]);
    } finally {
      this.loading.set(false);
    }
  }
  settled(id: string) {
    return this.settlements()
      .filter((x) => x.transaction_id === id)
      .reduce((s, x) => s + Number(x.amount), 0);
  }
  remaining(x: Transaction) {
    return Math.max(0, Number(x.installment_amount) - this.settled(x.id));
  }
  accountBalance(id: string) {
    const a = this.accounts().find((x) => x.id === id);
    const currentDate = today();
    let v = Number(a?.initial_balance || 0);
    this.transactions()
      .filter((x) => x.account_id === id && x.purchase_date <= currentDate)
      .forEach(
        (x) =>
          (v += x.kind === 'income' ? Number(x.installment_amount) : -Number(x.installment_amount)),
      );
    this.settlements()
      .filter((x) => x.account_id === id && x.settled_at <= currentDate)
      .forEach((x) => (v += x.direction === 'received' ? Number(x.amount) : -Number(x.amount)));
    this.transfers()
      .filter((x) => x.transfer_date <= currentDate)
      .forEach((x) => {
        if (x.from_account_id === id) v -= Number(x.amount);
        if (x.to_account_id === id) v += Number(x.amount);
      });
    this.invoicePayments()
      .filter((x) => x.account_id === id && x.paid_at <= currentDate)
      .forEach((x) => (v -= Number(x.amount)));
    return v;
  }
}
