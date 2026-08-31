import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FinanceStore } from '../../core/finance-store.service';
import { Transaction, currentMonth, money, today } from '../../core/models';

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './dashboard.html',
})
export class DashboardPage {
  readonly store = inject(FinanceStore);
  month = currentMonth();
  fmt = money.format;
  get rows() {
    return this.store
      .transactions()
      .filter((item) => item.invoice_month.slice(0, 7) === this.month);
  }
  get income() {
    return this.sum(this.rows.filter((item) => item.kind === 'income'));
  }
  get expenses() {
    return this.sum(
      this.rows.filter((item) => item.kind === 'expense' && item.responsibility !== 'receivable'),
    );
  }
  get balance() {
    return this.income - this.expenses;
  }
  get receivable() {
    return this.rows
      .filter((item) => item.responsibility === 'receivable')
      .reduce((sum, item) => sum + this.store.remaining(item), 0);
  }
  get payable() {
    return this.rows
      .filter((item) => item.responsibility === 'payable')
      .reduce((sum, item) => sum + this.store.remaining(item), 0);
  }
  get net() {
    return this.receivable - this.payable;
  }
  get personBalances() {
    return this.store
      .activePeople()
      .map((person) => {
        const rows = this.store.transactions().filter((item) => item.person_id === person.id);
        const receive = rows
          .filter((item) => item.responsibility === 'receivable')
          .reduce((sum, item) => sum + this.store.remaining(item), 0);
        const pay = rows
          .filter((item) => item.responsibility === 'payable')
          .reduce((sum, item) => sum + this.store.remaining(item), 0);
        return { person, receive, pay, net: receive - pay };
      })
      .filter((item) => item.receive || item.pay)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }
  get dueSoon() {
    const start = today(),
      end = new Date(`${start}T12:00:00`);
    end.setDate(end.getDate() + 7);
    const limit = end.toLocaleDateString('en-CA');
    return this.store
      .transactions()
      .filter((item) => item.due_date && item.due_date <= limit && this.store.remaining(item) > 0)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 6);
  }
  get recent() {
    return [...this.store.transactions()]
      .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))
      .slice(0, 6);
  }
  dueLabel(item: Transaction) {
    return item.due_date! < today()
      ? 'Atrasado'
      : item.due_date === today()
        ? 'Vence hoje'
        : item.due_date!;
  }
  private sum(rows: Transaction[]) {
    return rows.reduce((sum, item) => sum + Number(item.installment_amount), 0);
  }
}
