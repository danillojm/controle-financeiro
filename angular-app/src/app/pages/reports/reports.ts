import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../core/feedback.service';
import { FinanceStore } from '../../core/finance-store.service';
import { currentMonth, money, monthStart } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { CurrencyInputDirective } from '../../shared/currency-input.directive';
@Component({
  selector: 'app-reports',
  imports: [FormsModule, CurrencyInputDirective],
  template: `<section class="stack">
    <div class="toolbar">
      <div>
        <h1>Relatórios e orçamentos</h1>
        <p class="muted">Despesas pessoais por categoria.</p>
      </div>
      <input type="month" [(ngModel)]="month" />
    </div>
    <div class="card">
      <h2>Gastos por categoria</h2>
      @for (x of categories; track x.id) {
        <div style="margin:12px 0">
          <div class="toolbar">
            <span>{{ x.icon }} {{ x.name }}</span
            ><strong>{{ fmt(total(x.id)) }}</strong>
          </div>
          <div style="height:9px;background:#eef2f6;border-radius:9px">
            <div
              [style.width.%]="percent(x.id)"
              [style.background]="x.color"
              style="height:100%;border-radius:9px"
            ></div>
          </div>
        </div>
      } @empty {
        <p class="empty">Nenhuma despesa no mês.</p>
      }
    </div>
    <form class="card stack" (ngSubmit)="saveBudget()">
      <h2>Orçamento mensal</h2>
      <div class="form-grid">
        <label
          >Categoria<select name="category" [(ngModel)]="category">
            <option value="">Selecione</option>
            @for (x of store.activeCategories(); track x.id) {
              @if (x.kind !== 'income') {
                <option [value]="x.id">{{ x.name }}</option>
              }
            }
          </select></label
        ><label
          >Limite<input name="amount" appCurrency inputmode="decimal" [(ngModel)]="amount"
        /></label>
      </div>
      <button class="btn primary">Salvar orçamento</button>
      @for (x of budgets; track x.id) {
        <p>
          {{ name(x.category_id) }}: <strong>{{ fmt(x.amount) }}</strong> · usado
          {{ fmt(total(x.category_id)) }}
        </p>
      }
    </form>
  </section>`,
})
export class ReportsPage {
  private sb = inject(SupabaseService).client;
  readonly store = inject(FinanceStore);
  private feedback = inject(FeedbackService);
  month = currentMonth();
  category = '';
  amount: number | null = null;
  fmt = money.format;
  get rows() {
    return this.store
      .transactions()
      .filter(
        (x) =>
          x.invoice_month.slice(0, 7) === this.month &&
          x.kind === 'expense' &&
          x.responsibility !== 'receivable',
      );
  }
  get categories() {
    return this.store.categories().filter((c) => this.total(c.id) > 0);
  }
  get budgets() {
    return this.store.budgets().filter((x) => x.month.slice(0, 7) === this.month);
  }
  total(id: string) {
    return this.rows
      .filter((x) => x.category_id === id)
      .reduce((s, x) => s + Number(x.installment_amount), 0);
  }
  percent(id: string) {
    const max = Math.max(...this.categories.map((x) => this.total(x.id)), 1);
    return (this.total(id) / max) * 100;
  }
  name(id: string) {
    return this.store.categories().find((x) => x.id === id)?.name || '';
  }
  async saveBudget() {
    if (!this.category || !this.amount)
      return this.feedback.show('Informe categoria e limite.', 'error');
    const { error } = await this.sb.from('budgets').upsert(
      {
        user_id: this.store.userId(),
        category_id: this.category,
        month: monthStart(this.month),
        amount: this.amount,
      },
      { onConflict: 'user_id,category_id,month' },
    );
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show('Orçamento salvo.');
  }
}
