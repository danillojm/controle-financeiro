(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinanceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const pad = value => String(value).padStart(2, '0');

  function addMonths(month, offset) {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(year, monthNumber - 1 + offset, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function calculateInvoiceMonth(purchaseDate, closingDay) {
    const month = purchaseDate.slice(0, 7);
    if (!closingDay) return month;
    const purchaseDay = Number(purchaseDate.slice(8, 10));
    return purchaseDay >= Number(closingDay) ? addMonths(month, 1) : month;
  }

  function calculateDueDate(invoiceMonth, dueDay) {
    if (!invoiceMonth || !dueDay) return '';
    const [year, month] = invoiceMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return `${invoiceMonth}-${pad(Math.min(Number(dueDay), lastDay))}`;
  }

  function splitAmount(total, installments) {
    const count = Math.max(1, Number(installments));
    const cents = Math.round(Number(total) * 100);
    const base = Math.floor(cents / count);
    const remainder = cents - base * count;
    return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
  }

  function netBalance(receivable, payable) {
    return Number(receivable || 0) - Number(payable || 0);
  }

  return { addMonths, calculateInvoiceMonth, calculateDueDate, splitAmount, netBalance };
});
