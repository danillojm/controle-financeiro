import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FinanceStore } from '../../core/finance-store.service';
import { currentMonth, money } from '../../core/models';
@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, RouterLink],
  template: `<section class="stack">
    <div class="toolbar">
      <div>
        <h1>Visão geral</h1>
        <p class="muted">Resumo do mês selecionado.</p>
      </div>
      <input type="month" [(ngModel)]="month" />
    </div>
    <div class="kpis">
      <div class="card kpi">
        Receitas<strong class="positive">{{ fmt(income) }}</strong>
      </div>
      <div class="card kpi">
        Despesas<strong class="negative">{{ fmt(expenses) }}</strong>
      </div>
      <div class="card kpi">
        A receber<strong>{{ fmt(receivable) }}</strong>
      </div>
      <div class="card kpi">
        A pagar<strong>{{ fmt(payable) }}</strong>
      </div>
      <div class="card kpi">
        Saldo entre pessoas<strong [class.negative]="net < 0">{{ fmt(net) }}</strong>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <h2>Contas</h2>
        <a routerLink="/cadastros" class="btn secondary">Gerenciar</a>
      </div>
      <div class="grid">
        @for (x of store.accounts(); track x.id) {
          <div>
            <span>{{ x.name }}</span
            ><strong style="display:block">{{ fmt(store.accountBalance(x.id)) }}</strong>
          </div>
        } @empty {
          <p class="empty">Cadastre uma conta para acompanhar o saldo.</p>
        }
      </div>
    </div>
    <a routerLink="/lancamento" class="btn primary">＋ Novo lançamento</a>
  </section>`,
})
export class DashboardPage {
  readonly store = inject(FinanceStore);
  month = currentMonth();
  fmt = money.format;
  get rows() {
    return this.store.transactions().filter((x) => x.invoice_month.slice(0, 7) === this.month);
  }
  get income() {
    return this.rows
      .filter((x) => x.kind === 'income')
      .reduce((s, x) => s + Number(x.installment_amount), 0);
  }
  get expenses() {
    return this.rows
      .filter((x) => x.kind === 'expense' && x.responsibility !== 'receivable')
      .reduce((s, x) => s + Number(x.installment_amount), 0);
  }
  get receivable() {
    return this.rows
      .filter((x) => x.responsibility === 'receivable')
      .reduce((s, x) => s + this.store.remaining(x), 0);
  }
  get payable() {
    return this.rows
      .filter((x) => x.responsibility === 'payable')
      .reduce((s, x) => s + this.store.remaining(x), 0);
  }
  get net() {
    return this.receivable - this.payable;
  }
}
