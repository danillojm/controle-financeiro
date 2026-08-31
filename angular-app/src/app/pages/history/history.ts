import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FeedbackService } from '../../core/feedback.service';
import { FinanceStore } from '../../core/finance-store.service';
import { Transaction, currentMonth, money } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
@Component({ selector: 'app-history', imports: [FormsModule], templateUrl: './history.html' })
export class HistoryPage {
  private sb = inject(SupabaseService).client;
  readonly store = inject(FinanceStore);
  private feedback = inject(FeedbackService);
  private router = inject(Router);
  month = currentMonth();
  kind = '';
  search = '';
  responsibility = '';
  person = '';
  category = '';
  status = '';
  min: number | null = null;
  max: number | null = null;
  fmt = money.format;
  get rows() {
    return this.store
      .transactions()
      .filter(
        (x) =>
          (!this.month || x.invoice_month.slice(0, 7) === this.month) &&
          (!this.kind || x.kind === this.kind) &&
          (!this.search ||
            `${x.description} ${x.notes || ''}`
              .toLowerCase()
              .includes(this.search.toLowerCase())) &&
          (!this.responsibility || x.responsibility === this.responsibility) &&
          (!this.person || x.person_id === this.person) &&
          (!this.category || x.category_id === this.category) &&
          (!this.status ||
            (this.status === 'paid'
              ? this.store.remaining(x) <= 0.009
              : this.status === 'pending'
                ? this.store.settled(x.id) === 0
                : this.store.settled(x.id) > 0 && this.store.remaining(x) > 0.009)) &&
          (!this.min || Number(x.installment_amount) >= this.min) &&
          (!this.max || Number(x.installment_amount) <= this.max),
      );
  }
  clear() {
    this.month = currentMonth();
    this.kind = this.search = this.responsibility = this.person = this.category = this.status = '';
    this.min = this.max = null;
  }
  async remove(x: Transaction) {
    const series = this.store.transactions().filter((t) => t.series_id === x.series_id),
      scope =
        series.length > 1 ? prompt('Digite: parcela, futuras ou serie', 'parcela') : 'parcela';
    if (!scope) return;
    let query = this.sb.from('transactions').delete();
    if (scope === 'parcela') query = query.eq('id', x.id);
    else {
      query = query.eq('series_id', x.series_id);
      if (scope === 'futuras') query = query.gte('installment_number', x.installment_number);
    }
    const { error } = await query;
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show('Lançamento excluído.');
  }
  edit(x: Transaction) {
    sessionStorage.setItem('editTransaction', x.id);
    this.router.navigateByUrl('/lancamento');
  }
}
