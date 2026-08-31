import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../core/feedback.service';
import { FinanceStore } from '../../core/finance-store.service';
import { money, today } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
@Component({ selector: 'app-registers', imports: [FormsModule], templateUrl: './registers.html' })
export class RegistersPage {
  private sb = inject(SupabaseService).client;
  readonly store = inject(FinanceStore);
  private feedback = inject(FeedbackService);
  person = '';
  card = '';
  closing: number | null = null;
  due: number | null = null;
  category = '';
  categoryKind = 'both';
  color = '#0f766e';
  icon = '●';
  account = '';
  accountType = 'checking';
  initial = 0;
  from = '';
  to = '';
  transferAmount: number | null = null;
  transferDate = today();
  transferDescription = '';
  fmt = money.format;
  async insert(table: string, payload: any, message: string) {
    const { error } = await this.sb
      .from(table)
      .insert({ user_id: this.store.userId(), ...payload });
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show(message);
  }
  async addPerson() {
    if (!this.person.trim()) return;
    await this.insert('people', { name: this.person.trim() }, 'Pessoa adicionada.');
    this.person = '';
  }
  async addCard() {
    if (!this.card.trim()) return;
    await this.insert(
      'cards',
      { name: this.card.trim(), closing_day: this.closing, due_day: this.due },
      'Cartão adicionado.',
    );
    this.card = '';
    this.closing = this.due = null;
  }
  async addCategory() {
    if (!this.category.trim()) return;
    await this.insert(
      'categories',
      {
        name: this.category.trim(),
        kind: this.categoryKind,
        color: this.color,
        icon: this.icon || '●',
      },
      'Categoria adicionada.',
    );
    this.category = '';
  }
  async addAccount() {
    if (!this.account.trim()) return;
    await this.insert(
      'accounts',
      { name: this.account.trim(), type: this.accountType, initial_balance: this.initial },
      'Conta adicionada.',
    );
    this.account = '';
    this.initial = 0;
  }
  async archive(table: string, id: string, archived: any) {
    const { error } = await this.sb
      .from(table)
      .update({ archived_at: archived ? null : new Date().toISOString() })
      .eq('id', id);
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show(archived ? 'Cadastro reativado.' : 'Cadastro arquivado.');
  }
  async rename(table: string, id: string, current: string) {
    const name = prompt('Novo nome', current)?.trim();
    if (!name) return;
    const { error } = await this.sb.from(table).update({ name }).eq('id', id);
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show('Cadastro atualizado.');
  }
  async transfer() {
    if (!this.from || !this.to || this.from === this.to || !this.transferAmount)
      return this.feedback.show('Escolha contas diferentes e informe o valor.', 'error');
    await this.insert(
      'transfers',
      {
        from_account_id: this.from,
        to_account_id: this.to,
        amount: this.transferAmount,
        transfer_date: this.transferDate,
        description: this.transferDescription || null,
      },
      'Transferência registrada.',
    );
    this.transferAmount = null;
    this.transferDescription = '';
  }
  exportJson() {
    const backup = {
      version: 4,
      exportedAt: new Date().toISOString(),
      people: this.store.people(),
      cards: this.store.cards(),
      categories: this.store.categories(),
      accounts: this.store.accounts(),
      transactions: this.store.transactions(),
      settlements: this.store.settlements(),
      transfers: this.store.transfers(),
      budgets: this.store.budgets(),
      invoicePayments: this.store.invoicePayments(),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    );
    a.download = `controle-financeiro-angular-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.feedback.show('Backup exportado.');
  }
  async restore(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup.version !== 4 || !Array.isArray(backup.transactions))
        throw new Error('Este arquivo não é um backup válido da versão 4.');
      if (
        !confirm(
          `Restaurar ${backup.transactions.length} lançamentos? Registros com o mesmo ID serão atualizados.`,
        )
      )
        return;
      const user_id = this.store.userId(),
        upsert = async (table: string, rows: any[]) => {
          if (!rows?.length) return;
          const { error } = await this.sb
            .from(table)
            .upsert(rows.map((row) => ({ ...row, user_id })));
          if (error) throw error;
        };
      await upsert('people', backup.people);
      await upsert('cards', backup.cards);
      await upsert('categories', backup.categories);
      await upsert('accounts', backup.accounts);
      await upsert(
        'transactions',
        backup.transactions.map(({ people, cards, accounts, ...row }: any) => row),
      );
      await upsert('settlements', backup.settlements);
      await upsert('transfers', backup.transfers);
      await upsert('budgets', backup.budgets);
      await upsert('card_invoice_payments', backup.invoicePayments);
      await this.store.load();
      this.feedback.show('Backup restaurado com sucesso.');
    } catch (error: any) {
      this.feedback.show(error.message, 'error');
    } finally {
      input.value = '';
    }
  }
  async clearErrors() {
    const { error } = await this.sb.from('app_errors').delete().eq('user_id', this.store.userId());
    if (error) return this.feedback.show(error.message, 'error');
    await this.store.load();
    this.feedback.show('Diagnóstico limpo.');
  }
}
