import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../core/feedback.service';
import { FinanceStore } from '../../core/finance-store.service';
import { Transaction, currentMonth, money, monthStart, today } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { CurrencyInputDirective } from '../../shared/currency-input.directive';
@Component({
  selector: 'app-debts',
  imports: [FormsModule, CurrencyInputDirective],
  templateUrl: './debts.html',
})
export class DebtsPage {
  private sb = inject(SupabaseService).client;
  readonly store = inject(FinanceStore);
  private feedback = inject(FeedbackService);
  month = currentMonth();
  person = '';
  selected?: Transaction;
  amount = 0;
  date = today();
  account = '';
  notes = '';
  invoiceCard = '';
  invoiceAmount = 0;
  invoiceAccount = '';
  fmt = money.format;
  get rows() {
    return this.store
      .transactions()
      .filter(
        (x) =>
          x.kind === 'expense' &&
          ['receivable', 'payable'].includes(x.responsibility) &&
          x.invoice_month.slice(0, 7) === this.month &&
          (!this.person || x.person_id === this.person),
      );
  }
  get receive() {
    return this.rows
      .filter((x) => x.responsibility === 'receivable')
      .reduce((s, x) => s + this.store.remaining(x), 0);
  }
  get pay() {
    return this.rows
      .filter((x) => x.responsibility === 'payable')
      .reduce((s, x) => s + this.store.remaining(x), 0);
  }
  name(x: Transaction) {
    return this.store.people().find((p) => p.id === x.person_id)?.name || x.people?.name || '';
  }
  get invoices() {
    return this.store
      .cards()
      .map((card) => {
        const total = this.store
            .transactions()
            .filter((x) => x.card_id === card.id && x.invoice_month.slice(0, 7) === this.month)
            .reduce((s, x) => s + Number(x.installment_amount), 0),
          paid = this.store
            .invoicePayments()
            .filter((x) => x.card_id === card.id && x.invoice_month.slice(0, 7) === this.month)
            .reduce((s, x) => s + Number(x.amount), 0);
        return { card, total, paid, remaining: Math.max(0, total - paid) };
      })
      .filter((x) => x.total || x.paid);
  }
  open(x: Transaction) {
    this.selected = x;
    this.amount = this.store.remaining(x);
    this.date = today();
    this.account = '';
    this.notes = '';
  }
  async settle() {
    if (!this.selected || this.amount <= 0 || this.amount > this.store.remaining(this.selected))
      return this.feedback.show('Informe um valor válido.', 'error');
    const { error } = await this.sb.from('settlements').insert({
      user_id: this.store.userId(),
      transaction_id: this.selected.id,
      account_id: this.account || null,
      direction: this.selected.responsibility === 'payable' ? 'paid' : 'received',
      amount: this.amount,
      settled_at: this.date,
      notes: this.notes || null,
    });
    if (error) return this.feedback.show(error.message, 'error');
    this.selected = undefined;
    await this.store.load();
    this.feedback.show('Pagamento registrado.');
  }
  async reopen(x: Transaction) {
    if (!confirm('Remover os pagamentos e reabrir esta dívida?')) return;
    const { error } = await this.sb.from('settlements').delete().eq('transaction_id', x.id);
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show('Dívida reaberta.');
  }
  openInvoice(cardId: string, remaining: number) {
    this.invoiceCard = cardId;
    this.invoiceAmount = remaining;
    this.invoiceAccount = '';
  }
  async payInvoice() {
    if (!this.invoiceCard || this.invoiceAmount <= 0) return;
    const { error } = await this.sb.from('card_invoice_payments').insert({
      user_id: this.store.userId(),
      card_id: this.invoiceCard,
      account_id: this.invoiceAccount || null,
      invoice_month: monthStart(this.month),
      amount: this.invoiceAmount,
      paid_at: today(),
    });
    if (error) return this.feedback.show(error.message, 'error');
    this.invoiceCard = '';
    await this.store.load();
    this.feedback.show('Pagamento da fatura registrado.');
  }
  async reopenInvoice(cardId: string) {
    if (!confirm('Remover os pagamentos desta fatura?')) return;
    const { error } = await this.sb
      .from('card_invoice_payments')
      .delete()
      .eq('card_id', cardId)
      .eq('invoice_month', monthStart(this.month));
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show('Fatura reaberta.');
  }
}
