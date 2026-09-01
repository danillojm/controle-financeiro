import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../../core/feedback.service';
import { FinanceStore } from '../../core/finance-store.service';
import {
  detectInvoiceColumns,
  invoiceFingerprint,
  normalizeInvoiceDescription,
  parseInvoiceAmount,
  parseInvoiceCsv,
  parseInvoiceDate,
} from '../../core/invoice-csv';
import { extractInvoicePdf, parseInvoicePdfLines } from '../../core/invoice-pdf';
import { Transaction, currentMonth, dueDateFor, money, monthStart, today } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { CurrencyInputDirective } from '../../shared/currency-input.directive';

interface InvoiceImportRow {
  line: number;
  selected: boolean;
  date: string;
  description: string;
  amount: number;
  error: string;
  fingerprint: string;
  duplicate: '' | 'imported' | 'possible';
}

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
  importOpen = false;
  importCard = '';
  importMonth = currentMonth();
  importCategory = '';
  importFileName = '';
  importHeaders: string[] = [];
  importRecords: string[][] = [];
  importDateColumn = -1;
  importDescriptionColumn = -1;
  importAmountColumn = -1;
  importRows: InvoiceImportRow[] = [];
  importError = '';
  importNotice = '';
  importFileType: 'csv' | 'pdf' | '' = '';
  importPdfLines: string[] = [];
  readingFile = false;
  importing = false;
  checkingDuplicates = false;
  private duplicateRun = 0;
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
  get importSelected() {
    return this.importRows.filter(
      (row) => row.selected && !row.error && row.duplicate !== 'imported',
    );
  }
  get importTotal() {
    return this.importSelected.reduce((sum, row) => sum + row.amount, 0);
  }
  get importInvalidCount() {
    return this.importRows.filter((row) => row.error).length;
  }
  get importDuplicateCount() {
    return this.importRows.filter((row) => row.duplicate).length;
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
  openImporter() {
    this.importOpen = !this.importOpen;
    this.importMonth = this.month;
    if (!this.importCard && this.store.activeCards().length === 1)
      this.importCard = this.store.activeCards()[0].id;
  }
  async readInvoiceFile(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    this.importError = '';
    this.importNotice = '';
    this.importFileName = file.name;
    this.readingFile = true;
    try {
      const buffer = await file.arrayBuffer();
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdf = await extractInvoicePdf(buffer, this.importMonth, () =>
          prompt('Este PDF é protegido. Informe a senha da fatura:'),
        );
        this.importFileType = 'pdf';
        this.importPdfLines = pdf.sourceLines;
        this.setImportDocument(pdf.headers, pdf.records, { date: 0, description: 1, amount: 2 });
        this.importNotice = `${pdf.records.length} compras encontradas em ${pdf.pages} ${pdf.pages === 1 ? 'página' : 'páginas'}. Revise a prévia antes de importar.`;
      } else {
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
          text = new TextDecoder('windows-1252').decode(buffer);
        }
        const csv = parseInvoiceCsv(text),
          mapping = detectInvoiceColumns(csv.headers);
        this.importFileType = 'csv';
        this.importPdfLines = [];
        this.setImportDocument(csv.headers, csv.records, mapping);
        if (Object.values(mapping).some((index) => index < 0))
          this.importError = 'Confira abaixo quais colunas representam data, descrição e valor.';
      }
    } catch (error: any) {
      this.importHeaders = [];
      this.importRows = [];
      this.importPdfLines = [];
      const message = String(error.message || error);
      this.importError = /password|senha/i.test(message)
        ? 'Não foi possível abrir o PDF. Confira a senha informada.'
        : message;
    } finally {
      this.readingFile = false;
      input.value = '';
    }
  }
  private setImportDocument(
    headers: string[],
    records: string[][],
    mapping: { date: number; description: number; amount: number },
  ) {
    this.importHeaders = headers;
    this.importRecords = records;
    this.importDateColumn = mapping.date;
    this.importDescriptionColumn = mapping.description;
    this.importAmountColumn = mapping.amount;
    this.rebuildImportPreview();
  }
  updateImportMonth() {
    if (this.importFileType === 'pdf' && this.importPdfLines.length) {
      const records = parseInvoicePdfLines(this.importPdfLines, this.importMonth);
      this.setImportDocument(['Data', 'Descrição', 'Valor'], records, {
        date: 0,
        description: 1,
        amount: 2,
      });
    } else void this.refreshImportDuplicates();
  }
  rebuildImportPreview() {
    if (
      this.importDateColumn < 0 ||
      this.importDescriptionColumn < 0 ||
      this.importAmountColumn < 0
    ) {
      this.importRows = [];
      return;
    }
    const parsed = this.importRecords.map((record, index) => ({
        line: index + 2,
        date: parseInvoiceDate(record[this.importDateColumn] || ''),
        description: normalizeInvoiceDescription(record[this.importDescriptionColumn] || ''),
        rawAmount: parseInvoiceAmount(record[this.importAmountColumn] || ''),
      })),
      amounts = parsed
        .map((row) => row.rawAmount)
        .filter((amount): amount is number => amount !== null && amount !== 0),
      purchasesAreNegative = amounts.length > 0 && amounts.every((amount) => amount < 0);
    this.importRows = parsed.map((row) => {
      const amount =
        row.rawAmount === null ? 0 : purchasesAreNegative ? Math.abs(row.rawAmount) : row.rawAmount;
      let error = '';
      if (!row.date) error = 'Data inválida';
      else if (!row.description) error = 'Descrição vazia';
      else if (amount <= 0) error = 'Estorno ou valor inválido';
      return {
        line: row.line,
        selected: !error,
        date: row.date,
        description: row.description,
        amount,
        error,
        fingerprint: '',
        duplicate: '',
      };
    });
    this.importError = '';
    void this.refreshImportDuplicates();
  }
  async refreshImportDuplicates() {
    const run = ++this.duplicateRun;
    this.checkingDuplicates = true;
    this.importRows.forEach((row) => {
      row.fingerprint = '';
      row.duplicate = '';
      row.selected = !row.error;
    });
    if (!this.importCard) {
      this.checkingDuplicates = false;
      return;
    }
    const occurrences = new Map<string, number>();
    for (const row of this.importRows.filter((item) => !item.error)) {
      const key = `${row.date}|${normalizeInvoiceDescription(row.description).toLowerCase()}|${Math.round(row.amount * 100)}`,
        occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      row.fingerprint = await invoiceFingerprint(
        this.importCard,
        this.importMonth,
        row.date,
        row.description,
        row.amount,
        occurrence,
      );
    }
    if (run !== this.duplicateRun) return;
    const imported = new Set(
      this.store
        .transactions()
        .map((transaction) => transaction.import_fingerprint)
        .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
    );
    for (const row of this.importRows.filter((item) => !item.error)) {
      if (imported.has(row.fingerprint)) {
        row.duplicate = 'imported';
        row.selected = false;
      } else {
        const possible = this.store
          .transactions()
          .some(
            (transaction) =>
              transaction.card_id === this.importCard &&
              transaction.invoice_month.slice(0, 7) === this.importMonth &&
              transaction.purchase_date === row.date &&
              normalizeInvoiceDescription(transaction.description).toLowerCase() ===
                normalizeInvoiceDescription(row.description).toLowerCase() &&
              Math.round(Number(transaction.installment_amount) * 100) ===
                Math.round(row.amount * 100),
          );
        if (possible) {
          row.duplicate = 'possible';
          row.selected = false;
        }
      }
    }
    this.checkingDuplicates = false;
  }
  toggleImportRows(checked: boolean) {
    this.importRows.forEach(
      (row) => (row.selected = checked && !row.error && row.duplicate === ''),
    );
  }
  async importInvoice() {
    if (!this.importCard || !this.importMonth)
      return this.feedback.show('Selecione o cartão e o mês da fatura.', 'error');
    const selected = this.importSelected;
    if (this.checkingDuplicates || selected.some((row) => !row.fingerprint))
      return this.feedback.show('Aguarde a verificação de compras duplicadas.', 'error');
    if (!selected.length)
      return this.feedback.show('Selecione pelo menos uma compra válida.', 'error');
    this.importing = true;
    try {
      const card = this.store.cards().find((item) => item.id === this.importCard),
        rows = selected.map((row) => ({
          user_id: this.store.userId(),
          kind: 'expense',
          description: row.description,
          category_id: this.importCategory || null,
          payment_method: 'Crédito',
          card_id: this.importCard,
          account_id: null,
          person_id: null,
          responsibility: 'own',
          amount_total: row.amount,
          installment_number: 1,
          installments_total: 1,
          installment_amount: row.amount,
          purchase_date: row.date,
          invoice_month: monthStart(this.importMonth),
          due_date: dueDateFor(this.importMonth, card?.due_day) || null,
          series_id: crypto.randomUUID(),
          recurrence_type: 'installment',
          reimbursement_status: null,
          amount_received: 0,
          notes: `Importado da fatura ${this.importFileName}`,
          import_fingerprint: row.fingerprint,
        }));
      const { data, error } = await this.sb
        .from('transactions')
        .upsert(rows, { onConflict: 'user_id,import_fingerprint', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      const count = data?.length || 0;
      await this.store.load();
      this.month = this.importMonth;
      this.importRows = [];
      this.importHeaders = [];
      this.importRecords = [];
      this.importFileName = '';
      this.importFileType = '';
      this.importPdfLines = [];
      this.importNotice = '';
      this.importOpen = false;
      navigator.vibrate?.(40);
      this.feedback.show(
        `${count} ${count === 1 ? 'compra importada' : 'compras importadas'} com sucesso.`,
      );
    } catch (error: any) {
      const message = String(error.message || error);
      this.feedback.show(
        message.includes('import_fingerprint') || message.includes('schema cache')
          ? 'Execute a migration_v7.sql no Supabase antes de importar a fatura.'
          : message,
        'error',
      );
    } finally {
      this.importing = false;
    }
  }
}
