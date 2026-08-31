import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../core/feedback.service';
import { FinanceStore } from '../../core/finance-store.service';
import { Kind, Responsibility, addMonths, monthStart, splitAmount, today } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
@Component({ selector: 'app-entry', imports: [FormsModule], templateUrl: './entry.html' })
export class EntryPage {
  private sb = inject(SupabaseService).client;
  readonly store = inject(FinanceStore);
  private feedback = inject(FeedbackService);
  saving = false;
  message = '';
  editingId = '';
  updateSeries = false;
  form = {
    kind: 'expense' as Kind,
    description: '',
    amount: null as number | null,
    purchase_date: today(),
    category_id: '',
    payment_method: 'Crédito',
    account_id: '',
    responsibility: 'own' as Responsibility,
    card_id: '',
    person_id: '',
    installments: 1,
    recurring: 1,
    invoice_month: today().slice(0, 7),
    due_date: '',
    notes: '',
  };
  categories() {
    return this.store
      .activeCategories()
      .filter((x) => x.kind === 'both' || x.kind === this.form.kind);
  }
  constructor() {
    const id = sessionStorage.getItem('editTransaction');
    if (id) {
      sessionStorage.removeItem('editTransaction');
      const x = this.store.transactions().find((item) => item.id === id);
      if (x) {
        this.editingId = x.id;
        this.form = {
          kind: x.kind,
          description: x.description,
          amount: Number(x.installment_amount),
          purchase_date: x.purchase_date,
          category_id: x.category_id || '',
          payment_method: x.payment_method,
          account_id: x.account_id || '',
          responsibility: x.responsibility,
          card_id: x.card_id || '',
          person_id: x.person_id || '',
          installments: x.installments_total,
          recurring: x.installments_total,
          invoice_month: x.invoice_month.slice(0, 7),
          due_date: x.due_date || '',
          notes: x.notes || '',
        };
      }
    }
  }
  setKind(kind: Kind) {
    this.form.kind = kind;
    if (kind === 'income') this.form.responsibility = 'own';
  }
  get showAccount() {
    return (
      this.form.kind === 'income' ||
      (this.form.responsibility !== 'payable' && this.form.payment_method !== 'Crédito')
    );
  }
  get showCard() {
    return (
      this.form.kind === 'expense' &&
      this.form.responsibility !== 'payable' &&
      this.form.payment_method === 'Crédito'
    );
  }
  async save() {
    if (!this.form.description.trim() || !this.form.amount || !this.form.purchase_date) {
      navigator.vibrate?.([30, 40, 30]);
      this.message = 'Preencha descrição, valor e data.';
      return;
    }
    if (this.form.responsibility !== 'own' && !this.form.person_id) {
      navigator.vibrate?.([30, 40, 30]);
      this.message = 'Selecione a pessoa desta dívida.';
      return;
    }
    this.saving = true;
    this.message = 'Salvando lançamento...';
    try {
      let count = 1;
      if (this.editingId) {
        const original = this.store.transactions().find((x) => x.id === this.editingId)!;
        if (this.updateSeries) {
          const { data, error } = await this.sb.rpc('update_transaction_series_v4', {
            p_series_id: original.series_id,
            p_description: this.form.description.trim(),
            p_category_id: this.form.category_id || null,
            p_payment_method: this.form.payment_method,
            p_card_id: this.showCard ? this.form.card_id || null : null,
            p_person_id: this.form.responsibility === 'own' ? null : this.form.person_id,
            p_responsibility: this.form.responsibility,
            p_amount_total: this.form.amount,
            p_purchase_date: this.form.purchase_date,
            p_first_invoice_month: monthStart(this.form.invoice_month),
            p_due_day: this.form.due_date ? Number(this.form.due_date.slice(8, 10)) : null,
            p_notes: this.form.notes || null,
            p_account_id: this.showAccount ? this.form.account_id || null : null,
          });
          if (error) throw error;
          count = Number(data || 1);
        } else {
          const { error } = await this.sb
            .from('transactions')
            .update({
              description: this.form.description.trim(),
              category_id: this.form.category_id || null,
              payment_method: this.form.payment_method,
              card_id: this.showCard ? this.form.card_id || null : null,
              account_id: this.showAccount ? this.form.account_id || null : null,
              person_id: this.form.responsibility === 'own' ? null : this.form.person_id,
              responsibility: this.form.responsibility,
              amount_total: this.form.amount,
              installment_amount: this.form.amount,
              purchase_date: this.form.purchase_date,
              invoice_month: monthStart(this.form.invoice_month),
              due_date: this.form.due_date || null,
              notes: this.form.notes || null,
            })
            .eq('id', this.editingId);
          if (error) throw error;
        }
      } else {
        count =
          this.form.kind === 'income'
            ? Math.max(1, this.form.recurring)
            : Math.max(1, this.form.installments);
        const amounts =
            this.form.kind === 'income'
              ? Array(count).fill(this.form.amount)
              : splitAmount(this.form.amount, count),
          series_id = crypto.randomUUID(),
          rows = amounts.map((amount, index) => {
            const month = addMonths(
                this.form.kind === 'income'
                  ? this.form.purchase_date.slice(0, 7)
                  : this.form.invoice_month,
                index,
              ),
              responsibility = this.form.kind === 'income' ? 'own' : this.form.responsibility;
            return {
              user_id: this.store.userId(),
              kind: this.form.kind,
              description: this.form.description.trim(),
              category_id: this.form.category_id || null,
              payment_method: this.form.payment_method,
              card_id: this.showCard ? this.form.card_id || null : null,
              account_id: this.showAccount ? this.form.account_id || null : null,
              person_id: responsibility === 'own' ? null : this.form.person_id,
              responsibility,
              amount_total: this.form.amount,
              installment_number: index + 1,
              installments_total: count,
              installment_amount: amount,
              purchase_date:
                this.form.kind === 'income' && index ? monthStart(month) : this.form.purchase_date,
              invoice_month: monthStart(month),
              due_date: index === 0 ? this.form.due_date || null : null,
              series_id,
              reimbursement_status: responsibility === 'own' ? null : 'pending',
              amount_received: 0,
              notes: this.form.notes || null,
            };
          });
        const { error } = await this.sb.from('transactions').insert(rows);
        if (error) throw error;
      }
      await this.store.load();
      this.reset();
      this.message = `${count} ${count === 1 ? 'lançamento salvo' : 'lançamentos salvos'} com sucesso. Você pode lançar o próximo.`;
      this.feedback.show(this.message);
      document.querySelector<HTMLInputElement>('#description')?.focus();
    } catch (error: any) {
      this.message = error.message;
      this.feedback.show(error.message, 'error');
    } finally {
      this.saving = false;
    }
  }
  reset() {
    const kind = this.form.kind;
    this.editingId = '';
    this.updateSeries = false;
    this.form = {
      kind,
      description: '',
      amount: null,
      purchase_date: today(),
      category_id: '',
      payment_method: 'Crédito',
      account_id: '',
      responsibility: 'own',
      card_id: '',
      person_id: '',
      installments: 1,
      recurring: 1,
      invoice_month: today().slice(0, 7),
      due_date: '',
      notes: '',
    };
  }
}
