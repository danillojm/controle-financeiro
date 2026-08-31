(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const core = window.FinanceCore;
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateFmt = new Intl.DateTimeFormat('pt-BR');
  const PAGE_SIZE = 20;
  const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const yyyyMm = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthStart = month => `${month}-01`;
  const createUuid = () => crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, character => (character ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> character / 4).toString(16));
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

  const configOK = window.SUPABASE_URL && !window.SUPABASE_URL.includes('COLE_') && window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes('COLE_');
  if (!configOK) { $('#setupScreen').classList.remove('hidden'); return; }
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  const state = { user: null, people: [], cards: [], categories: [], accounts: [], transfers: [], invoicePayments: [], notificationPreferences: [], appErrors: [], importRows: [], restoreData: null, deleteTarget: null, transactions: [], settlements: [], settlementsByTransaction: new Map(), budgets: [], historyPage: 1, invoiceMonthTouched: false };
  const defaultCategories = ['Alimentação', 'Mercado', 'Moradia', 'Transporte', 'Combustível', 'Saúde', 'Farmácia', 'Lazer', 'Compras', 'Assinaturas', 'Cuidados pessoais', 'Outros'];
  const pageTitles = { dashboard: 'Início', entry: 'Novo lançamento', debts: 'Dívidas', history: 'Histórico', reports: 'Relatórios', registers: 'Cadastros' };

  const responsibilityOf = transaction => transaction.responsibility || (transaction.kind === 'expense' && transaction.people && !transaction.people.is_self ? 'receivable' : 'own');
  const directionLabel = responsibility => responsibility === 'payable' ? 'Eu devo' : responsibility === 'receivable' ? 'Me deve' : 'Meu gasto';
  const settlementsFor = transactionId => state.settlementsByTransaction.get(transactionId) || [];
  const settledAmount = transaction => settlementsFor(transaction.id).reduce((sum, settlement) => sum + Number(settlement.amount), 0);
  const remainingOf = transaction => Math.max(0, Number(transaction.installment_amount) - settledAmount(transaction));
  const settlementStatus = transaction => settledAmount(transaction) <= 0 ? 'pending' : remainingOf(transaction) <= 0.009 ? 'paid' : 'partial';

  function show(screen) {
    ['setupScreen', 'authScreen', 'mainScreen'].forEach(id => $(`#${id}`).classList.add('hidden'));
    $(`#${screen}`).classList.remove('hidden');
  }
  function setMessage(element, message, error = false) { element.textContent = message; element.style.color = error ? '#b42318' : '#067647'; }
  function haptic(pattern = 12) { if ('vibrate' in navigator) navigator.vibrate(pattern); }
  let toastTimer;
  function toast(message, type = 'success') {
    const element = $('#toast'); clearTimeout(toastTimer); element.textContent = message; element.className = `toast ${type}`;
    haptic(type === 'error' ? [30, 40, 30] : 18);
    toastTimer = setTimeout(() => element.classList.add('hidden'), 4200);
  }
  function setLoading(loading, message = 'Carregando...') { $('#loadingOverlay span').textContent = message; $('#loadingOverlay').classList.toggle('hidden', !loading); }
  function setSaveLoading(loading, label = 'Salvar lançamento') {
    const button = $('#saveTransactionBtn'); button.disabled = loading;
    button.querySelector('.button-label').textContent = loading ? 'Salvando...' : label;
    button.querySelector('.button-spinner').classList.toggle('hidden', !loading);
  }
  function humanError(error) {
    const message = error?.message || String(error);
    if (/accounts|transfers|invoice_payments|notification_preferences|app_errors|archived_at|update_transaction_series_v4/i.test(message)) return 'O banco ainda não está na versão 4. Execute supabase/migration_v4.sql no SQL Editor.';
    if (/settlements|budgets|due_date|series_id|update_transaction_series/i.test(message)) return 'O banco ainda não está na versão 3. Execute supabase/migration_v3.sql no SQL Editor.';
    if (/responsibility/i.test(message)) return 'O banco ainda não está na versão 2. Execute as migrações v2 e v3.';
    return message;
  }
  async function recordError(error, context = 'aplicativo') {
    if (!state.user) return;
    try { await sb.from('app_errors').insert({ user_id: state.user.id, message: error?.message || String(error), context, details: { stack: error?.stack || null, url: location.href, userAgent: navigator.userAgent }, app_version: 'v4' }); } catch (_) { /* diagnóstico nunca interrompe o fluxo principal */ }
  }
  function handleError(error, context) { recordError(error, context); toast(humanError(error), 'error'); }
  function renderErrors() { $('#errorsList').innerHTML = state.appErrors.slice(0,10).map(item => `<div class="summary-row"><span><strong>${escapeHtml(item.context || 'Aplicativo')}</strong><br><small>${dateFmt.format(new Date(item.created_at))}</small></span><span>${escapeHtml(item.message)}</span></div>`).join('') || '<div class="list-empty">Nenhum erro registrado.</div>'; }
  function nav(name) {
    $$('.view').forEach(view => view.classList.remove('active')); $(`#view-${name}`).classList.add('active');
    $$('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.nav === name)); $('#pageTitle').textContent = pageTitles[name];
    if (name === 'dashboard') renderDashboard(); if (name === 'debts') renderDebts(); if (name === 'history') renderHistory(); if (name === 'reports') renderReports(); if (name === 'registers') renderRegisters();
  }

  async function ensureSeed() {
    const userId = state.user.id;
    const [selfResult, categoryResult] = await Promise.all([
      sb.from('people').select('id').eq('user_id', userId).eq('is_self', true).limit(1), sb.from('categories').select('id').eq('user_id', userId).limit(1)
    ]);
    if (selfResult.error || categoryResult.error) throw selfResult.error || categoryResult.error;
    if (!selfResult.data?.length) {
      const { error } = await sb.from('people').upsert(
        { user_id: userId, name: 'Eu', is_self: true },
        { onConflict: 'user_id,name' }
      );
      if (error) throw error;
    }
    if (!categoryResult.data?.length) {
      const { error } = await sb.from('categories').upsert(
        defaultCategories.map(name => ({ user_id: userId, name })),
        { onConflict: 'user_id,name', ignoreDuplicates: true }
      );
      if (error) throw error;
    }
  }
  async function fetchAll(table, select, orderColumn) {
    const result = [], batchSize = 1000;
    for (let from = 0; ; from += batchSize) {
      const { data, error } = await sb.from(table).select(select).eq('user_id', state.user.id).order(orderColumn, { ascending: false }).range(from, from + batchSize - 1);
      if (error) throw error; result.push(...data); if (data.length < batchSize) return result;
    }
  }
  async function loadData({ quiet = false } = {}) {
    if (!quiet) setLoading(true, 'Atualizando seus dados...');
    try {
      const userId = state.user.id;
      const [people, cards, categories, transactions, settlements, budgets, accounts, transfers, invoicePayments, notificationPreferences, appErrors] = await Promise.all([
        sb.from('people').select('*').eq('user_id', userId).order('is_self', { ascending: false }).order('name'),
        sb.from('cards').select('*').eq('user_id', userId).order('name'), sb.from('categories').select('*').eq('user_id', userId).order('name'),
        fetchAll('transactions', '*,people(name,is_self),cards(name),accounts(name)', 'invoice_month'), fetchAll('settlements', '*', 'settled_at'), fetchAll('budgets', '*', 'month'),
        fetchAll('accounts', '*', 'created_at'), fetchAll('transfers', '*', 'transfer_date'), fetchAll('card_invoice_payments', '*', 'paid_at'), fetchAll('notification_preferences', '*', 'updated_at'), fetchAll('app_errors', '*', 'created_at')
      ]);
      const firstError = people.error || cards.error || categories.error; if (firstError) throw firstError;
      const settlementsByTransaction = new Map();
      settlements.forEach(settlement => settlementsByTransaction.set(settlement.transaction_id, [...(settlementsByTransaction.get(settlement.transaction_id) || []), settlement]));
      Object.assign(state, { people: people.data, cards: cards.data, categories: categories.data, transactions, settlements, settlementsByTransaction, budgets, accounts, transfers, invoicePayments, notificationPreferences, appErrors });
      populateSelects(); renderDashboard();
    } finally { if (!quiet) setLoading(false); }
  }
  function populateSelects() {
    const values = { category: $('#category').value, card: $('#card').value, person: $('#person').value, account: $('#account').value, filter: $('#invoicePersonFilter').value, budget: $('#budgetCategory').value };
    const activeCategories = state.categories.filter(item => !item.archived_at), activeCards = state.cards.filter(item => !item.archived_at), activeAccounts = state.accounts.filter(item => !item.archived_at);
    updateCategorySelect(values.category);
    $('#budgetCategory').innerHTML = activeCategories.filter(item => item.kind !== 'income').map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#historyCategoryFilter').innerHTML = '<option value="">Todas</option>' + state.categories.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#card').innerHTML = '<option value="">Sem cartão</option>' + activeCards.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#historyCardFilter').innerHTML = '<option value="">Todos</option>' + state.cards.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#account').innerHTML = '<option value="">Sem conta</option>' + activeAccounts.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#settlementAccount').innerHTML = '<option value="">Não informar</option>' + activeAccounts.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#invoicePaymentAccount').innerHTML = '<option value="">Não informar</option>' + activeAccounts.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#transferFrom').innerHTML = activeAccounts.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join(''); $('#transferTo').innerHTML = $('#transferFrom').innerHTML;
    const others = state.people.filter(item => !item.is_self && !item.archived_at);
    $('#person').innerHTML = others.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#invoicePersonFilter').innerHTML = '<option value="">Todas</option>' + others.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $('#historyPersonFilter').innerHTML = '<option value="">Todas</option>' + state.people.filter(item => !item.is_self).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    if (state.categories.some(item => item.id === values.category)) $('#category').value = values.category;
    if (state.categories.some(item => item.id === values.budget)) $('#budgetCategory').value = values.budget;
    if (state.cards.some(item => item.id === values.card)) $('#card').value = values.card;
    if (state.accounts.some(item => item.id === values.account)) $('#account').value = values.account;
    if (others.some(item => item.id === values.person)) $('#person').value = values.person;
    if (others.some(item => item.id === values.filter)) $('#invoicePersonFilter').value = values.filter;
  }
  function updateCategorySelect(preferred = $('#category').value) { const kind=$('#transactionKind').value, options=state.categories.filter(item=>!item.archived_at&&(item.kind==='both'||item.kind===kind)); $('#category').innerHTML=options.map(item=>`<option value="${item.id}">${escapeHtml(item.icon||'●')} ${escapeHtml(item.name)}</option>`).join(''); if(options.some(item=>item.id===preferred))$('#category').value=preferred; }

  const currentMonthTransactions = month => state.transactions.filter(transaction => String(transaction.invoice_month || '').slice(0, 7) === month);
  const personalExpense = transaction => transaction.kind === 'expense' && ['own', 'payable'].includes(responsibilityOf(transaction));
  function peopleBalances(transactions = state.transactions) {
    const result = {};
    state.people.filter(item => !item.is_self).forEach(item => { result[item.id] = { id: item.id, name: item.name, receivable: 0, payable: 0 }; });
    transactions.filter(item => ['receivable', 'payable'].includes(responsibilityOf(item)) && item.person_id).forEach(item => {
      if (!result[item.person_id]) result[item.person_id] = { id: item.person_id, name: item.people?.name || 'Pessoa', receivable: 0, payable: 0 };
      result[item.person_id][responsibilityOf(item)] += remainingOf(item);
    });
    return result;
  }
  const balanceText = value => `${brl.format(Math.abs(value))} ${value > 0 ? 'a receber' : value < 0 ? 'a pagar' : 'quitado'}`;
  function renderPeopleBalances(transactions = state.transactions, interactive = false) {
    const balances = Object.values(peopleBalances(transactions)).filter(item => item.receivable || item.payable);
    if (!balances.length) return '<div class="list-empty">Nenhum saldo pendente.</div>';
    return balances.sort((a, b) => Math.abs(b.receivable - b.payable) - Math.abs(a.receivable - a.payable)).map(item => {
      const net = core.netBalance(item.receivable, item.payable);
      const compensate = interactive && item.receivable > 0 && item.payable > 0 ? `<button class="btn secondary" data-compensate="${item.id}">Compensar ${brl.format(Math.min(item.receivable, item.payable))}</button>` : '';
      return `<div class="summary-row"><span><strong>${escapeHtml(item.name)}</strong><br><small>Me deve: ${brl.format(item.receivable)} · Eu devo: ${brl.format(item.payable)}</small></span><span><strong>${balanceText(net)}</strong>${compensate}</span></div>`;
    }).join('');
  }
  function renderDashboard() {
    const month = $('#dashboardMonth').value || yyyyMm(), transactions = currentMonthTransactions(month);
    const income = transactions.filter(item => item.kind === 'income').reduce((sum, item) => sum + Number(item.installment_amount), 0);
    const expenses = transactions.filter(personalExpense).reduce((sum, item) => sum + Number(item.installment_amount), 0);
    const receivable = transactions.filter(item => responsibilityOf(item) === 'receivable').reduce((sum, item) => sum + remainingOf(item), 0);
    const payable = transactions.filter(item => responsibilityOf(item) === 'payable').reduce((sum, item) => sum + remainingOf(item), 0), peopleBalance = core.netBalance(receivable, payable);
    $('#kpiIncome').textContent = brl.format(income); $('#kpiOwnExpenses').textContent = brl.format(expenses); $('#kpiBalance').textContent = brl.format(income - expenses);
    $('#kpiReceivable').textContent = brl.format(receivable); $('#kpiPayable').textContent = brl.format(payable); $('#kpiPeopleBalance').textContent = brl.format(Math.abs(peopleBalance));
    $('#kpiPeopleBalanceHint').textContent = peopleBalance > 0 ? 'a receber' : peopleBalance < 0 ? 'a pagar' : 'quitado'; $('#familySummary').innerHTML = renderPeopleBalances(transactions);
    const categories = {};
    transactions.filter(personalExpense).forEach(item => { const name = state.categories.find(category => category.id === item.category_id)?.name || 'Outros'; categories[name] = (categories[name] || 0) + Number(item.installment_amount); });
    $('#categorySummary').innerHTML = Object.keys(categories).length ? Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => `<div class="summary-row"><span>${escapeHtml(name)}</span><strong>${brl.format(value)}</strong></div>`).join('') : 'Sem gastos neste mês.';
    renderDueAlerts();
    renderDashboardFromServer(month);
  }
  async function renderDashboardFromServer(month) { const { data, error } = await sb.rpc('get_dashboard_summary', { p_month: monthStart(month) }); if (error || !data?.[0] || ($('#dashboardMonth').value || yyyyMm()) !== month) return; const summary = data[0], peopleBalance = Number(summary.receivable) - Number(summary.payable); $('#kpiIncome').textContent = brl.format(summary.income); $('#kpiOwnExpenses').textContent = brl.format(summary.expenses); $('#kpiBalance').textContent = brl.format(Number(summary.income)-Number(summary.expenses)); $('#kpiReceivable').textContent = brl.format(summary.receivable); $('#kpiPayable').textContent = brl.format(summary.payable); $('#kpiPeopleBalance').textContent = brl.format(Math.abs(peopleBalance)); $('#kpiPeopleBalanceHint').textContent = peopleBalance > 0 ? 'a receber' : peopleBalance < 0 ? 'a pagar' : 'quitado'; }
  function renderDueAlerts() {
    const today = new Date(`${todayInput()}T12:00:00`), limit = new Date(today), daysBefore = Number(state.notificationPreferences[0]?.days_before || 7); limit.setDate(limit.getDate() + daysBefore);
    const rows = state.transactions.filter(item => item.due_date && remainingOf(item) > 0 && ['receivable', 'payable'].includes(responsibilityOf(item))).filter(item => new Date(`${item.due_date}T12:00:00`) <= limit).sort((a, b) => a.due_date.localeCompare(b.due_date));
    $('#dueAlertsCard').classList.toggle('hidden', !rows.length);
    $('#dueAlerts').innerHTML = rows.map(item => { const due = new Date(`${item.due_date}T12:00:00`), overdue = due < today; return `<div class="due-alert"><span>${escapeHtml(item.description)} · ${escapeHtml(item.people?.name || '')}</span><span class="${overdue ? 'overdue' : 'due-soon'}">${overdue ? 'Atrasado' : 'Vence'} ${dateFmt.format(due)} · ${brl.format(remainingOf(item))}</span></div>`; }).join('');
    if (rows.length) notifyDueRows(rows).catch(console.warn);
  }
  async function notifyDueRows(rows, force = false) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || (!force && localStorage.getItem('finance-notifications') !== 'enabled')) return;
    const notificationKey = `finance-notified-${todayInput()}`;
    if (!force && localStorage.getItem(notificationKey)) return;
    const overdue = rows.filter(item => item.due_date < todayInput()).length;
    const registration = await navigator.serviceWorker?.ready;
    if (registration) await registration.showNotification('Meu Controle Financeiro', { body: overdue ? `${overdue} dívida(s) atrasada(s) e ${rows.length - overdue} próxima(s) do vencimento.` : `${rows.length} dívida(s) vencem nos próximos 7 dias.`, icon: './icons/icon-192.png', tag: 'finance-due-alerts' });
    localStorage.setItem(notificationKey, '1');
  }
  async function enableNotifications() {
    if (!('Notification' in window)) return toast('Este navegador não oferece notificações.', 'error');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return toast('A permissão de notificações não foi concedida.', 'error');
    localStorage.setItem('finance-notifications', 'enabled');
    const { error } = await sb.from('notification_preferences').upsert({ user_id: state.user.id, enabled: true, days_before: 7, updated_at: new Date().toISOString() }); if (error) return handleError(error, 'ativar notificações');
    try { const registration = await navigator.serviceWorker.ready; if ('periodicSync' in registration) await registration.periodicSync.register('finance-reminder', { minInterval: 24 * 60 * 60 * 1000 }); } catch (error) { console.warn('Lembrete em segundo plano indisponível', error); }
    const rows = state.transactions.filter(item => item.due_date && remainingOf(item) > 0 && new Date(`${item.due_date}T12:00:00`) <= new Date(Date.now() + 7 * 86400000));
    await notifyDueRows(rows, true);
    toast('Alertas de vencimento ativados.');
  }
  function statusMarkup(transaction) {
    const status = settlementStatus(transaction), label = status === 'paid' ? 'Pago' : status === 'partial' ? `Parcial · falta ${brl.format(remainingOf(transaction))}` : transaction.due_date && transaction.due_date < todayInput() ? 'Atrasado' : 'Pendente';
    return `<span class="status ${status === 'paid' ? 'paid' : 'pending'}">${label}</span>`;
  }

  function renderDebts() {
    const month = $('#invoiceFilterMonth').value || yyyyMm(), personId = $('#invoicePersonFilter').value;
    let rows = state.transactions.filter(item => item.kind === 'expense' && String(item.invoice_month).slice(0, 7) === month && ['receivable', 'payable'].includes(responsibilityOf(item)));
    if (personId) rows = rows.filter(item => item.person_id === personId);
    const receivable = rows.filter(item => responsibilityOf(item) === 'receivable').reduce((sum, item) => sum + remainingOf(item), 0), payable = rows.filter(item => responsibilityOf(item) === 'payable').reduce((sum, item) => sum + remainingOf(item), 0);
    $('#invoiceSummary').innerHTML = `<div class="summary-row"><span>A receber</span><strong>${brl.format(receivable)}</strong></div><div class="summary-row"><span>A pagar</span><strong>${brl.format(payable)}</strong></div><div class="summary-row"><span>Saldo</span><strong>${balanceText(core.netBalance(receivable, payable))}</strong></div>`;
    $('#peopleBalanceSummary').innerHTML = renderPeopleBalances(state.transactions, true);
    $('#invoiceTable').innerHTML = rows.length ? rows.map(item => { const responsibility = responsibilityOf(item), paid = settlementStatus(item) === 'paid'; return `<tr><td>${String(item.invoice_month).slice(0, 7).split('-').reverse().join('/')}${item.due_date ? `<br><small>vence ${dateFmt.format(new Date(`${item.due_date}T12:00:00`))}</small>` : ''}</td><td><span class="direction ${responsibility}">${directionLabel(responsibility)}</span></td><td>${escapeHtml(item.people?.name || '')}</td><td>${escapeHtml(item.description)}</td><td>${item.installment_number}/${item.installments_total}</td><td>${brl.format(item.installment_amount)}</td><td>${statusMarkup(item)}</td><td>${paid ? `<button class="btn secondary" data-reopen="${item.id}">Reabrir</button>` : `<button class="btn primary" data-settle="${item.id}">Registrar pagamento</button>`}</td></tr>`; }).join('') : '<tr><td colspan="8">Nenhuma dívida neste mês.</td></tr>';
    renderSettlementHistory(month, personId);
    renderCardInvoices(month);
    $$('[data-settle]').forEach(button => button.onclick = () => openSettlement(button.dataset.settle)); $$('[data-reopen]').forEach(button => button.onclick = () => reopenTransaction(button.dataset.reopen)); $$('[data-compensate]').forEach(button => button.onclick = () => compensatePerson(button.dataset.compensate));
  }
  function renderCardInvoices(month) {
    const rows = state.cards.map(card => { const total = state.transactions.filter(item => item.card_id === card.id && item.kind === 'expense' && String(item.invoice_month).slice(0,7) === month).reduce((sum,item) => sum + Number(item.installment_amount),0), paid = state.invoicePayments.filter(item => item.card_id === card.id && String(item.invoice_month).slice(0,7) === month).reduce((sum,item) => sum + Number(item.amount),0); return { card, total, paid, remaining: Math.max(0,total-paid) }; }).filter(item => item.total || item.paid);
    $('#cardInvoiceSummary').innerHTML = rows.length ? rows.map(item => `<div class="summary-row"><span><strong>${escapeHtml(item.card.name)}</strong><br><small>Total ${brl.format(item.total)} · Pago ${brl.format(item.paid)}</small></span><span><strong>${item.remaining > .009 ? `${brl.format(item.remaining)} pendente` : 'Fatura paga'}</strong>${item.remaining > .009 ? `<button class="btn primary" data-pay-invoice="${item.card.id}" data-invoice-month="${month}" data-invoice-remaining="${item.remaining}">Registrar pagamento</button>` : ''}${item.paid > .009 ? `<button class="btn secondary" data-reopen-invoice="${item.card.id}" data-invoice-month="${month}">Reabrir</button>` : ''}</span></div>`).join('') : '<div class="list-empty">Nenhuma fatura neste mês.</div>';
    $$('[data-pay-invoice]').forEach(button => button.onclick = () => openInvoicePayment(button.dataset.payInvoice, button.dataset.invoiceMonth, Number(button.dataset.invoiceRemaining)));
    $$('[data-reopen-invoice]').forEach(button => button.onclick = async () => { if (!confirm('Remover os pagamentos registrados desta fatura?')) return; const { error } = await sb.from('card_invoice_payments').delete().eq('card_id',button.dataset.reopenInvoice).eq('invoice_month',monthStart(button.dataset.invoiceMonth)); if (error) return handleError(error,'reabrir fatura'); await loadData({quiet:true}); renderDebts(); toast('Fatura reaberta.'); });
  }
  function openInvoicePayment(cardId, month, remaining) { const card = state.cards.find(item => item.id === cardId); $('#invoicePaymentCardId').value = cardId; $('#invoicePaymentMonth').value = month; $('#invoicePaymentInfo').textContent = `${card?.name || 'Cartão'} · restante ${brl.format(remaining)}`; $('#invoicePaymentAmount').value = remaining.toFixed(2); $('#invoicePaymentAmount').max = remaining.toFixed(2); $('#invoicePaymentDate').value = todayInput(); $('#invoicePaymentNotes').value = ''; $('#invoicePaymentDialog').showModal(); }
  async function saveInvoicePayment(event) { event.preventDefault(); const amount = Number($('#invoicePaymentAmount').value), max = Number($('#invoicePaymentAmount').max); if (!amount || amount > max + .009) return toast('Informe um valor dentro do saldo da fatura.', 'error'); const payload = { user_id: state.user.id, card_id: $('#invoicePaymentCardId').value, invoice_month: monthStart($('#invoicePaymentMonth').value), account_id: $('#invoicePaymentAccount').value || null, amount, paid_at: $('#invoicePaymentDate').value, notes: $('#invoicePaymentNotes').value.trim() || null }, { error } = await sb.from('card_invoice_payments').insert(payload); if (error) return handleError(error, 'pagar fatura'); $('#invoicePaymentDialog').close(); await loadData({ quiet: true }); renderDebts(); toast('Pagamento da fatura registrado.'); }
  function renderSettlementHistory(month, personId) {
    let rows = state.settlements.filter(item => item.settled_at.slice(0, 7) === month);
    if (personId) rows = rows.filter(item => state.transactions.find(transaction => transaction.id === item.transaction_id)?.person_id === personId);
    $('#settlementTable').innerHTML = rows.length ? rows.map(item => { const transaction = state.transactions.find(transaction => transaction.id === item.transaction_id), account = state.accounts.find(entry => entry.id === item.account_id); return `<tr><td>${dateFmt.format(new Date(`${item.settled_at}T12:00:00`))}</td><td>${item.direction === 'paid' ? 'Pago' : 'Recebido'}</td><td>${escapeHtml(transaction?.people?.name || '')}</td><td>${escapeHtml(transaction?.description || 'Lançamento removido')}</td><td>${escapeHtml(account?.name || '—')}</td><td>${brl.format(item.amount)}</td><td>${escapeHtml(item.notes || '')}</td><td><button class="btn danger" data-delete-settlement="${item.id}">Excluir</button></td></tr>`; }).join('') : '<tr><td colspan="8">Nenhum pagamento registrado neste mês.</td></tr>';
    $$('[data-delete-settlement]').forEach(button => button.onclick = () => deleteSettlement(button.dataset.deleteSettlement));
  }
  function openSettlement(transactionId) {
    const transaction = state.transactions.find(item => item.id === transactionId); if (!transaction) return;
    $('#settlementTransactionId').value = transaction.id; $('#settlementTitle').textContent = responsibilityOf(transaction) === 'payable' ? 'Registrar valor pago' : 'Registrar valor recebido';
    $('#settlementRemaining').textContent = `Restante de ${brl.format(remainingOf(transaction))} — ${transaction.description}`; $('#settlementAmount').value = remainingOf(transaction).toFixed(2); $('#settlementAmount').max = remainingOf(transaction).toFixed(2); $('#settlementAccount').value = ''; $('#settlementDate').value = todayInput(); $('#settlementNotes').value = ''; $('#settlementDialog').showModal();
  }
  async function saveSettlement(event) {
    event.preventDefault(); const transaction = state.transactions.find(item => item.id === $('#settlementTransactionId').value), amount = Number($('#settlementAmount').value);
    if (!transaction || amount <= 0 || amount > remainingOf(transaction) + 0.009) return toast('Informe um valor válido, limitado ao saldo restante.', 'error');
    $('#saveSettlementBtn').disabled = true;
    try {
      const payload = { user_id: state.user.id, transaction_id: transaction.id, account_id: $('#settlementAccount').value || null, direction: responsibilityOf(transaction) === 'payable' ? 'paid' : 'received', amount, settled_at: $('#settlementDate').value, notes: $('#settlementNotes').value.trim() || null };
      const { error } = await sb.from('settlements').insert(payload); if (error) throw error;
      const total = settledAmount(transaction) + amount; await sb.from('transactions').update({ amount_received: total, reimbursement_status: total + 0.009 >= Number(transaction.installment_amount) ? 'paid' : 'pending' }).eq('id', transaction.id);
      $('#settlementDialog').close(); await loadData({ quiet: true }); renderDebts(); toast(total + 0.009 >= Number(transaction.installment_amount) ? 'Dívida marcada como paga.' : 'Pagamento parcial registrado.');
    } catch (error) { toast(humanError(error), 'error'); } finally { $('#saveSettlementBtn').disabled = false; }
  }
  async function deleteSettlement(settlementId) {
    const settlement = state.settlements.find(item => item.id === settlementId); if (!settlement || !confirm('Excluir este pagamento do histórico?')) return;
    const transaction = state.transactions.find(item => item.id === settlement.transaction_id), newTotal = Math.max(0, settledAmount(transaction) - Number(settlement.amount));
    const { error } = await sb.from('settlements').delete().eq('id', settlementId); if (error) return toast(humanError(error), 'error');
    await sb.from('transactions').update({ amount_received: newTotal, reimbursement_status: newTotal + 0.009 >= Number(transaction.installment_amount) ? 'paid' : 'pending' }).eq('id', transaction.id); await loadData({ quiet: true }); renderDebts(); toast('Pagamento removido e dívida reaberta.');
  }
  async function reopenTransaction(transactionId) {
    if (!confirm('Remover os pagamentos desta parcela e reabrir a dívida?')) return;
    const { error } = await sb.from('settlements').delete().eq('transaction_id', transactionId); if (error) return toast(humanError(error), 'error');
    await sb.from('transactions').update({ amount_received: 0, reimbursement_status: 'pending' }).eq('id', transactionId); await loadData({ quiet: true }); renderDebts(); toast('Dívida reaberta.');
  }
  function allocateSettlement(transactions, total) {
    let remaining = total;
    return transactions.filter(item => remainingOf(item) > 0).map(transaction => { const amount = Math.min(remaining, remainingOf(transaction)); remaining -= amount; return { transaction, amount }; }).filter(item => item.amount > 0);
  }
  async function compensatePerson(personId) {
    const balance = peopleBalances()[personId]; if (!balance) return; const total = Math.min(balance.receivable, balance.payable);
    if (!confirm(`Compensar ${brl.format(total)} entre os valores a receber e a pagar de ${balance.name}?`)) return;
    const receivables = state.transactions.filter(item => item.person_id === personId && responsibilityOf(item) === 'receivable'), payables = state.transactions.filter(item => item.person_id === personId && responsibilityOf(item) === 'payable'), allocations = [...allocateSettlement(receivables, total), ...allocateSettlement(payables, total)];
    const rows = allocations.map(({ transaction, amount }) => ({ user_id: state.user.id, transaction_id: transaction.id, direction: responsibilityOf(transaction) === 'payable' ? 'paid' : 'received', amount, settled_at: todayInput(), notes: `Compensação automática com ${balance.name}`, source: 'compensation' }));
    setLoading(true, 'Compensando saldos...');
    try {
      const { error } = await sb.from('settlements').insert(rows); if (error) throw error;
      await Promise.all(allocations.map(({ transaction, amount }) => { const newTotal = settledAmount(transaction) + amount; return sb.from('transactions').update({ amount_received: newTotal, reimbursement_status: newTotal + 0.009 >= Number(transaction.installment_amount) ? 'paid' : 'pending' }).eq('id', transaction.id); }));
      await loadData({ quiet: true }); renderDebts(); toast(`Compensação de ${brl.format(total)} concluída.`);
    } catch (error) { toast(humanError(error), 'error'); } finally { setLoading(false); }
  }

  function filteredHistory() {
    const month = $('#historyMonth').value, kind = $('#historyKind').value, search = $('#historySearch').value.trim().toLocaleLowerCase('pt-BR'), category = $('#historyCategoryFilter').value, card = $('#historyCardFilter').value, person = $('#historyPersonFilter').value, responsibility = $('#historyResponsibility').value, status = $('#historyStatus').value, from = $('#historyDateFrom').value, to = $('#historyDateTo').value, min = Number($('#historyMin').value || 0), max = Number($('#historyMax').value || 0);
    let rows = state.transactions.filter(item => !month || String(item.invoice_month).slice(0, 7) === month);
    if (kind) rows = rows.filter(item => item.kind === kind); if (search) rows = rows.filter(item => `${item.description} ${item.notes || ''}`.toLocaleLowerCase('pt-BR').includes(search)); if (category) rows = rows.filter(item => item.category_id === category); if (card) rows = rows.filter(item => item.card_id === card); if (person) rows = rows.filter(item => item.person_id === person); if (responsibility) rows = rows.filter(item => responsibilityOf(item) === responsibility); if (status) rows = rows.filter(item => settlementStatus(item) === status); if (from) rows = rows.filter(item => item.purchase_date >= from); if (to) rows = rows.filter(item => item.purchase_date <= to); if (min) rows = rows.filter(item => Number(item.installment_amount) >= min); if (max) rows = rows.filter(item => Number(item.installment_amount) <= max); return rows;
  }
  function renderHistory() {
    const rows = filteredHistory(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); state.historyPage = Math.min(state.historyPage, pages); const visible = rows.slice((state.historyPage - 1) * PAGE_SIZE, state.historyPage * PAGE_SIZE);
    $('#historyTable').innerHTML = visible.length ? visible.map(item => `<tr><td>${dateFmt.format(new Date(`${item.purchase_date}T12:00:00`))}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(directionLabel(responsibilityOf(item)))}</td><td>${escapeHtml(item.people?.name || '')}</td><td>${brl.format(item.installment_amount)}</td><td>${String(item.invoice_month).slice(0, 7).split('-').reverse().join('/')}</td><td><button class="btn secondary" data-edit="${item.id}">Editar</button> <button class="btn danger" data-delete="${item.id}">Excluir</button></td></tr>`).join('') : '<tr><td colspan="7">Nenhum lançamento.</td></tr>';
    $('#historyPageInfo').textContent = `Página ${state.historyPage} de ${pages} · ${rows.length} lançamentos`; $('#historyPrev').disabled = state.historyPage <= 1; $('#historyNext').disabled = state.historyPage >= pages;
    $$('[data-edit]').forEach(button => button.onclick = () => startEdit(button.dataset.edit)); $$('[data-delete]').forEach(button => button.onclick = () => deleteTransaction(button.dataset.delete));
  }
  async function deleteTransaction(transactionId) {
    const transaction = state.transactions.find(item => item.id === transactionId); if (!transaction) return; const seriesSize = state.transactions.filter(item => item.series_id === transaction.series_id).length;
    if (seriesSize <= 1) { if (confirm('Excluir este lançamento e seus pagamentos?')) executeDelete('one', transaction); return; }
    state.deleteTarget = transaction; $('#deleteDialog').showModal();
  }
  async function executeDelete(scope, transaction = state.deleteTarget) {
    if (!transaction) return; let query = sb.from('transactions').delete();
    if (scope === 'one') query = query.eq('id', transaction.id); else { query = query.eq('series_id', transaction.series_id); if (scope === 'future') query = query.gte('installment_number', transaction.installment_number); }
    const { error } = await query; if (error) return toast(humanError(error), 'error'); $('#deleteDialog').close(); state.deleteTarget = null; await loadData({ quiet: true }); renderHistory(); toast(scope === 'one' ? 'Parcela excluída.' : scope === 'future' ? 'Esta parcela e as próximas foram excluídas.' : 'Série excluída.');
  }
  function startEdit(transactionId) {
    const item = state.transactions.find(transaction => transaction.id === transactionId); if (!item) return; nav('entry');
    const seriesSize = state.transactions.filter(transaction => transaction.series_id === item.series_id).length;
    $('#editingTransactionId').value = item.id; $('#editingBanner').classList.remove('hidden'); $('#updateSeriesField').classList.toggle('hidden', seriesSize <= 1); $('#updateSeriesLabel').textContent = item.kind === 'income' ? 'Atualizar todas as ocorrências desta receita' : 'Atualizar todas as parcelas deste lançamento'; $('#updateSeries').checked = false;
    $('#transactionKind').value = item.kind; updateCategorySelect(item.category_id); $$('.seg').forEach(button => { button.classList.toggle('active', button.dataset.kind === item.kind); button.disabled = true; }); $('#description').value = item.description; $('#amount').value = Number(item.installment_amount).toFixed(2); $('#purchaseDate').value = item.purchase_date; $('#category').value = item.category_id || ''; $('#paymentMethod').value = item.payment_method || 'Pix'; $('#responsibility').value = responsibilityOf(item); $('#card').value = item.card_id || ''; $('#account').value = item.account_id || ''; $('#person').value = item.person_id || ''; $('#installments').value = item.installments_total; $('#invoiceMonth').value = String(item.invoice_month).slice(0, 7); $('#dueDate').value = item.due_date || ''; $('#notes').value = item.notes || ''; state.invoiceMonthTouched = true; updateKindUI(); $('#dueDate').value = item.due_date || ''; setSaveLoading(false, 'Salvar alterações'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() {
    $('#transactionForm').reset(); $('#editingTransactionId').value = ''; $('#editingBanner').classList.add('hidden'); $('#updateSeriesField').classList.add('hidden'); $('#transactionKind').value = 'expense'; updateCategorySelect(); $$('.seg').forEach(button => { button.classList.toggle('active', button.dataset.kind === 'expense'); button.disabled = false; }); setMessage($('#transactionMessage'), ''); setFormDefaults(); updateKindUI(); setSaveLoading(false);
  }

  function updateResponsibilityUI() {
    const responsibility = $('#responsibility').value, income = $('#transactionKind').value === 'income', hasPerson = !income && responsibility !== 'own';
    $('#personField').classList.toggle('hidden', !hasPerson); $('#personLabel').textContent = responsibility === 'payable' ? 'Para quem eu devo?' : 'Quem me deve?';
    $('#invoiceMonthLabel').textContent = responsibility === 'payable' ? '1º mês' : '1ª fatura';
    const credit = $('#paymentMethod').value === 'Crédito'; $('#cardField').classList.toggle('hidden', income || responsibility === 'payable' || !credit); $('#accountField').classList.toggle('hidden', !income && (credit || responsibility === 'payable')); updateAutoDates();
  }
  function updateKindUI() {
    const income = $('#transactionKind').value === 'income'; ['responsibilityField', 'personField', 'installmentsField', 'invoiceMonthField', 'dueDateField'].forEach(id => $(`#${id}`).classList.toggle('hidden', income)); $('#recurringField').classList.toggle('hidden', !income); if (!income) updateResponsibilityUI(); else $('#cardField').classList.add('hidden'); updatePreview();
  }
  const selectedCard = () => state.cards.find(card => card.id === $('#card').value);
  function updateAutoDates(force = false) {
    if ($('#transactionKind').value === 'income') return; const purchase = $('#purchaseDate').value; if (!purchase) return; const responsibility = $('#responsibility').value, card = selectedCard();
    if (!state.invoiceMonthTouched || force) $('#invoiceMonth').value = responsibility !== 'payable' && $('#paymentMethod').value === 'Crédito' ? core.calculateInvoiceMonth(purchase, card?.closing_day) : purchase.slice(0, 7);
    if (card?.due_day && responsibility !== 'payable' && $('#paymentMethod').value === 'Crédito') { $('#dueDate').value = core.calculateDueDate($('#invoiceMonth').value, card.due_day); $('#invoiceAutoHint').textContent = card.closing_day ? `Calculado pelo fechamento no dia ${card.closing_day}.` : 'Vencimento calculado pelo cartão.'; } else $('#invoiceAutoHint').textContent = 'Informe se quiser acompanhar vencimentos.';
    updatePreview();
  }
  function updatePreview() {
    if ($('#transactionKind').value === 'income') { const months = Number($('#recurringMonths').value || 1); $('#installmentPreview').textContent = months > 1 ? `Esta receita será criada por ${months} meses.` : ''; return; }
    const amount = Number($('#amount').value || 0), installments = Number($('#installments').value || 1), month = $('#invoiceMonth').value; if (!amount || !month) return void ($('#installmentPreview').textContent = ''); const parts = core.splitAmount(amount, installments);
    $('#installmentPreview').textContent = installments > 1 ? `${installments} parcelas entre ${brl.format(Math.min(...parts))} e ${brl.format(Math.max(...parts))}, de ${month.split('-').reverse().join('/')} até ${core.addMonths(month, installments - 1).split('-').reverse().join('/')}.` : `Lançamento em ${month.split('-').reverse().join('/')}.`;
  }
  function transactionCommonPayload(kind, description, amount, purchase) {
    const responsibility = kind === 'income' ? 'own' : $('#responsibility').value;
    return { user_id: state.user.id, kind, description, category_id: $('#category').value || null, payment_method: $('#paymentMethod').value, card_id: kind === 'expense' && responsibility !== 'payable' && $('#paymentMethod').value === 'Crédito' ? ($('#card').value || null) : null, account_id: kind === 'income' || (responsibility !== 'payable' && $('#paymentMethod').value !== 'Crédito') ? ($('#account').value || null) : null, person_id: kind === 'expense' && responsibility !== 'own' ? ($('#person').value || null) : null, responsibility, amount_total: amount, purchase_date: purchase, notes: $('#notes').value.trim() || null };
  }
  async function saveNewTransaction(common, amount) {
    const seriesId = createUuid(), inserts = [];
    if (common.kind === 'income') {
      const months = Math.max(1, Number($('#recurringMonths').value || 1));
      for (let index = 0; index < months; index++) { const month = core.addMonths(common.purchase_date.slice(0, 7), index); inserts.push({ ...common, series_id: seriesId, installment_number: index + 1, installments_total: months, installment_amount: amount, purchase_date: index ? monthStart(month) : common.purchase_date, invoice_month: monthStart(month), due_date: null, reimbursement_status: null, amount_received: 0 }); }
    } else {
      const count = Number($('#installments').value || 1), firstMonth = $('#invoiceMonth').value || common.purchase_date.slice(0, 7), amounts = core.splitAmount(amount, count), firstDue = $('#dueDate').value, dueDay = firstDue ? Number(firstDue.slice(8, 10)) : selectedCard()?.due_day;
      for (let index = 0; index < count; index++) { const month = core.addMonths(firstMonth, index); inserts.push({ ...common, series_id: seriesId, installment_number: index + 1, installments_total: count, installment_amount: amounts[index], invoice_month: monthStart(month), due_date: dueDay ? core.calculateDueDate(month, dueDay) : null, reimbursement_status: common.responsibility === 'own' ? null : 'pending', amount_received: 0 }); }
    }
    setMessage($('#transactionMessage'), `Salvando ${inserts.length} ${inserts.length === 1 ? 'lançamento' : 'lançamentos'}...`); const { error } = await sb.from('transactions').insert(inserts); if (error) throw error; return inserts.length;
  }
  async function saveEditedTransaction(original, common, amount) {
    const updateSeries = $('#updateSeries').checked, targets = updateSeries ? state.transactions.filter(item => item.series_id === original.series_id).sort((a, b) => a.installment_number - b.installment_number) : [original], firstMonth = $('#invoiceMonth').value, firstDue = $('#dueDate').value, dueDay = firstDue ? Number(firstDue.slice(8, 10)) : null;
    setMessage($('#transactionMessage'), updateSeries ? `Atualizando ${targets.length} parcelas...` : 'Atualizando lançamento...');
    if (updateSeries) {
      const { data, error } = await sb.rpc('update_transaction_series_v4', {
        p_series_id: original.series_id, p_description: common.description,
        p_category_id: common.category_id, p_payment_method: common.payment_method,
        p_card_id: common.card_id, p_person_id: common.person_id,
        p_responsibility: common.responsibility, p_amount_total: amount,
        p_purchase_date: common.purchase_date, p_first_invoice_month: monthStart(firstMonth),
        p_due_day: dueDay, p_notes: common.notes, p_account_id: common.account_id
      });
      if (error) throw error;
      return Number(data);
    }
    const payload = { ...common, amount_total: amount, installment_amount: amount, invoice_month: monthStart(firstMonth), due_date: dueDay ? core.calculateDueDate(firstMonth, dueDay) : null };
    const { error } = await sb.from('transactions').update(payload).eq('id', original.id);
    if (error) throw error;
    return 1;
  }
  async function saveTransaction(event) {
    event.preventDefault(); const message = $('#transactionMessage'), kind = $('#transactionKind').value, amount = Number($('#amount').value), purchase = $('#purchaseDate').value, description = $('#description').value.trim();
    if (!amount || !purchase || !description) { haptic([30, 40, 30]); return setMessage(message, 'Preencha descrição, valor e data.', true); } const responsibility = kind === 'income' ? 'own' : $('#responsibility').value; if (responsibility !== 'own' && !$('#person').value) { haptic([30, 40, 30]); return setMessage(message, 'Cadastre e selecione uma pessoa para esta dívida.', true); }
    const editingId = $('#editingTransactionId').value, original = state.transactions.find(item => item.id === editingId); let persistedCount = 0; setSaveLoading(true, original ? 'Salvar alterações' : 'Salvar lançamento'); setMessage(message, 'Validando os dados...');
    try { const common = transactionCommonPayload(kind, description, amount, purchase); persistedCount = original ? await saveEditedTransaction(original, common, amount) : await saveNewTransaction(common, amount); setMessage(message, 'Dados confirmados. Preparando o próximo lançamento...'); await loadData({ quiet: true }); cancelEdit(); const successText = `${persistedCount} ${persistedCount === 1 ? 'lançamento salvo' : 'lançamentos salvos'} com sucesso.`; setMessage(message, successText); toast(successText); $('#description').focus(); }
    catch (error) { const text = persistedCount ? 'O lançamento foi salvo, mas não foi possível atualizar a tela. Recarregue o aplicativo para visualizar os dados.' : humanError(error); if (persistedCount) cancelEdit(); setMessage(message, text, true); toast(text, 'error'); }
    finally { setSaveLoading(false, $('#editingTransactionId').value ? 'Salvar alterações' : 'Salvar lançamento'); }
  }
  function setFormDefaults() {
    $('#purchaseDate').value = todayInput(); $('#transferDate').value = todayInput(); $('#invoicePaymentDate').value = todayInput(); $('#dashboardMonth').value ||= yyyyMm(); $('#invoiceFilterMonth').value ||= yyyyMm(); $('#historyMonth').value ||= yyyyMm(); $('#reportMonth').value ||= yyyyMm(); $('#invoiceMonth').value = yyyyMm(); $('#responsibility').value = 'own'; $('#recurringMonths').value = '1'; state.invoiceMonthTouched = false; updateAutoDates(true);
  }

  function renderRegisters() {
    const balances = peopleBalances();
    $('#peopleList').innerHTML = state.people.map(person => { const item = balances[person.id] || { receivable: 0, payable: 0 }, net = core.netBalance(item.receivable, item.payable); return `<div class="person-register ${person.archived_at ? 'archived' : ''}"><span class="person-register-main"><strong>${escapeHtml(person.name)}${person.archived_at ? ' · arquivada' : ''}</strong>${person.is_self ? '<small class="person-register-balance">Você</small>' : `<small class="person-register-balance">Me deve: ${brl.format(item.receivable)} · Eu devo: ${brl.format(item.payable)} · Saldo: ${balanceText(net)}</small>`}</span>${person.is_self ? '' : `<span class="row-actions"><button data-edit-person="${person.id}" title="Editar">✎</button><button data-archive-person="${person.id}" title="${person.archived_at ? 'Reativar' : 'Arquivar'}">${person.archived_at ? '↶' : '○'}</button></span>`}</div>`; }).join('');
    $('#cardsList').innerHTML = state.cards.map(card => `<span class="chip ${card.archived_at ? 'archived' : ''}">${escapeHtml(card.name)}${card.closing_day ? ` · fecha ${card.closing_day}` : ''}${card.due_day ? ` · vence ${card.due_day}` : ''}${card.archived_at ? ' · arquivado' : ''}<button data-edit-card="${card.id}">✎</button><button data-archive-card="${card.id}">${card.archived_at ? '↶' : '○'}</button></span>`).join('');
    $('#categoriesList').innerHTML = state.categories.map(category => `<div class="register-row ${category.archived_at ? 'archived' : ''}"><span><i style="background:${escapeHtml(category.color || '#0f766e')}"></i>${escapeHtml(category.icon || '●')} <strong>${escapeHtml(category.name)}</strong><small>${category.kind === 'expense' ? 'Despesa' : category.kind === 'income' ? 'Receita' : 'Receita e despesa'}${category.archived_at ? ' · arquivada' : ''}</small></span><span class="row-actions"><button data-edit-category="${category.id}">✎</button><button data-archive-category="${category.id}">${category.archived_at ? '↶' : '○'}</button></span></div>`).join('');
    $('#accountsList').innerHTML = state.accounts.map(account => `<div class="register-row ${account.archived_at ? 'archived' : ''}"><span><i style="background:${escapeHtml(account.color || '#0f766e')}"></i><strong>${escapeHtml(account.name)}</strong><small>${brl.format(accountBalance(account.id))}${account.archived_at ? ' · arquivada' : ''}</small></span><span class="row-actions"><button data-edit-account="${account.id}">✎</button><button data-archive-account="${account.id}">${account.archived_at ? '↶' : '○'}</button></span></div>`).join('');
    $('#transfersList').innerHTML = state.transfers.slice(0,10).map(transfer => `<div class="summary-row"><span>${escapeHtml(state.accounts.find(item => item.id === transfer.from_account_id)?.name || '')} → ${escapeHtml(state.accounts.find(item => item.id === transfer.to_account_id)?.name || '')}<br><small>${dateFmt.format(new Date(`${transfer.transfer_date}T12:00:00`))} · ${escapeHtml(transfer.description || '')}</small></span><span><strong>${brl.format(transfer.amount)}</strong><button class="btn danger" data-delete-transfer="${transfer.id}">Excluir</button></span></div>`).join('') || '<div class="list-empty">Nenhuma transferência.</div>';
    $$('[data-edit-person]').forEach(button => button.onclick = () => editRegister('people', button.dataset.editPerson)); $$('[data-archive-person]').forEach(button => button.onclick = () => toggleArchive('people', button.dataset.archivePerson)); $$('[data-edit-card]').forEach(button => button.onclick = () => editRegister('cards', button.dataset.editCard)); $$('[data-archive-card]').forEach(button => button.onclick = () => toggleArchive('cards', button.dataset.archiveCard)); $$('[data-edit-category]').forEach(button => button.onclick = () => editRegister('categories', button.dataset.editCategory)); $$('[data-archive-category]').forEach(button => button.onclick = () => toggleArchive('categories', button.dataset.archiveCategory)); $$('[data-edit-account]').forEach(button => button.onclick = () => editRegister('accounts', button.dataset.editAccount)); $$('[data-archive-account]').forEach(button => button.onclick = () => toggleArchive('accounts', button.dataset.archiveAccount));
    $$('[data-delete-transfer]').forEach(button => button.onclick = async () => { if(!confirm('Excluir esta transferência?'))return;const{error}=await sb.from('transfers').delete().eq('id',button.dataset.deleteTransfer);if(error)return handleError(error,'excluir transferência');await loadData({quiet:true});renderRegisters();toast('Transferência excluída.'); });
    renderErrors();
  }
  function accountBalance(accountId) {
    const account = state.accounts.find(item => item.id === accountId); let balance = Number(account?.initial_balance || 0);
    state.transactions.filter(item => item.account_id === accountId).forEach(item => balance += item.kind === 'income' ? Number(item.installment_amount) : -Number(item.installment_amount));
    state.settlements.filter(item => item.account_id === accountId).forEach(item => balance += item.direction === 'received' ? Number(item.amount) : -Number(item.amount));
    state.transfers.forEach(item => { if (item.from_account_id === accountId) balance -= Number(item.amount); if (item.to_account_id === accountId) balance += Number(item.amount); }); state.invoicePayments.filter(item => item.account_id === accountId).forEach(item => balance -= Number(item.amount)); return balance;
  }
  async function toggleArchive(table, id) {
    const collection = table === 'people' ? state.people : table === 'cards' ? state.cards : table === 'categories' ? state.categories : state.accounts, item = collection.find(entry => entry.id === id); if (!item) return;
    const { error } = await sb.from(table).update({ archived_at: item.archived_at ? null : new Date().toISOString() }).eq('id', id); if (error) return handleError(error, `arquivar ${table}`); await loadData({ quiet: true }); renderRegisters(); toast(item.archived_at ? 'Cadastro reativado.' : 'Cadastro arquivado sem apagar o histórico.');
  }
  async function editRegister(table, id) {
    const collection = table === 'people' ? state.people : table === 'cards' ? state.cards : table === 'categories' ? state.categories : state.accounts, item = collection.find(entry => entry.id === id); if (!item) return; const name = prompt('Novo nome:', item.name); if (!name?.trim() || name.trim() === item.name) return;
    const payload = { name: name.trim() }; if (table === 'cards') { payload.closing_day = Number(prompt('Dia de fechamento:', item.closing_day || '')) || null; payload.due_day = Number(prompt('Dia de vencimento:', item.due_day || '')) || null; } if (table === 'categories') { payload.icon = prompt('Ícone:', item.icon || '●') || '●'; payload.color = prompt('Cor hexadecimal:', item.color || '#0f766e') || '#0f766e'; const kind=prompt('Uso: expense, income ou both:',item.kind||'both');payload.kind=['expense','income','both'].includes(kind)?kind:item.kind; } if (table === 'accounts') { payload.initial_balance = Number(prompt('Saldo inicial:', item.initial_balance)) || 0; const type=prompt('Tipo: checking, savings, cash ou investment:',item.type);payload.type=['checking','savings','cash','investment'].includes(type)?type:item.type;payload.color=prompt('Cor hexadecimal:',item.color||'#0f766e')||'#0f766e'; }
    const { error } = await sb.from(table).update(payload).eq('id', id); if (error) return handleError(error, `editar ${table}`); await loadData({ quiet: true }); renderRegisters(); toast('Cadastro atualizado.');
  }
  async function deleteRegister(table, id) {
    const field = table === 'people' ? 'person_id' : 'card_id'; if (state.transactions.some(item => item[field] === id)) return toast('Este cadastro possui lançamentos vinculados e não pode ser removido.', 'error');
    const { error } = await sb.from(table).delete().eq('id', id); if (error) return toast(humanError(error), 'error'); await loadData({ quiet: true }); renderRegisters(); toast('Cadastro removido.');
  }
  function renderBarChart(element, rows, valueKey, className = '') {
    const max = Math.max(1, ...rows.map(row => row[valueKey])); element.innerHTML = rows.length ? rows.map(row => `<div class="bar-row"><span>${escapeHtml(row.label)}</span><span class="bar-track"><span class="bar-fill ${className}" style="width:${Math.max(2, row[valueKey] / max * 100)}%"></span></span><strong>${brl.format(row[valueKey])}</strong></div>`).join('') : '<div class="list-empty">Sem dados para o período.</div>';
  }
  function renderReports() {
    const month = $('#reportMonth').value || yyyyMm(), months = Array.from({ length: 6 }, (_, index) => core.addMonths(month, index - 5));
    renderBarChart($('#monthlyChart'), months.map(item => ({ label: item.split('-').reverse().join('/'), value: currentMonthTransactions(item).filter(personalExpense).reduce((sum, transaction) => sum + Number(transaction.installment_amount), 0) })), 'value', 'expense');
    renderBarChart($('#peopleChart'), Object.values(peopleBalances()).map(item => ({ label: item.name, value: Math.abs(core.netBalance(item.receivable, item.payable)) })).filter(item => item.value > 0), 'value'); renderBudgets(month);
  }
  function renderBudgets(month) {
    const transactions = currentMonthTransactions(month).filter(personalExpense), budgets = state.budgets.filter(item => String(item.month).slice(0, 7) === month);
    $('#budgetList').innerHTML = budgets.length ? budgets.map(item => { const category = state.categories.find(category => category.id === item.category_id), spent = transactions.filter(transaction => transaction.category_id === item.category_id).reduce((sum, transaction) => sum + Number(transaction.installment_amount), 0), percentage = spent / Number(item.amount) * 100; return `<div class="budget-progress"><div class="budget-head"><span><strong>${escapeHtml(category?.name || 'Categoria')}</strong> · ${brl.format(spent)} de ${brl.format(item.amount)}</span><button class="btn danger" data-delete-budget="${item.id}">Excluir</button></div><div class="budget-track"><div class="budget-fill ${percentage > 100 ? 'over' : ''}" style="width:${Math.min(100, percentage)}%"></div></div></div>`; }).join('') : '<div class="list-empty">Nenhum orçamento definido para este mês.</div>';
    $$('[data-delete-budget]').forEach(button => button.onclick = () => deleteBudget(button.dataset.deleteBudget));
  }
  async function saveBudget(event) {
    event.preventDefault(); const payload = { user_id: state.user.id, category_id: $('#budgetCategory').value, month: monthStart($('#reportMonth').value), amount: Number($('#budgetAmount').value) }, { error } = await sb.from('budgets').upsert(payload, { onConflict: 'user_id,category_id,month' });
    if (error) return toast(humanError(error), 'error'); $('#budgetAmount').value = ''; await loadData({ quiet: true }); renderReports(); toast('Orçamento salvo.');
  }
  async function deleteBudget(id) { const { error } = await sb.from('budgets').delete().eq('id', id); if (error) return toast(humanError(error), 'error'); await loadData({ quiet: true }); renderReports(); toast('Orçamento removido.'); }
  function parseCsv(text) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let index = 0; index < text.length; index++) { const character = text[index]; if (quoted) { if (character === '"' && text[index + 1] === '"') { field += '"'; index++; } else if (character === '"') quoted = false; else field += character; } else if (character === '"') quoted = true; else if (character === ';') { row.push(field); field = ''; } else if (character === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(value => value !== '')) rows.push(row); row = []; field = ''; } else field += character; }
    if (field || row.length) { row.push(field); rows.push(row); } const headers = rows.shift()?.map(value => value.replace(/^\uFEFF/, '').trim()) || []; return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }
  function normalizeImportRow(row) {
    const kind = row.Tipo === 'income' || row.Tipo === 'Receita' ? 'income' : 'expense', responsibilityText = row.Responsabilidade || '', responsibility = kind === 'income' ? 'own' : /Eu devo/i.test(responsibilityText) ? 'payable' : /Me deve|Outra pessoa/i.test(responsibilityText) ? 'receivable' : 'own', amount = Number(String(row['Valor parcela'] || row.Valor || row['Valor total']).replace(',', '.'));
    const normalized = { raw: row, originalId:row.OriginalId||null, duplicate: false, kind, responsibility, amount, description: row.Descrição?.trim(), purchase_date: row.Data, invoice_month: (row.Mês || row['Mês fatura'] || row.Data?.slice(0,7) || '').slice(0,7), categoryName: row.Categoria?.trim(), cardName: row.Cartão?.trim(), accountName: row.Conta?.trim(), personName: row.Pessoa?.trim(), payment_method: row.Forma || 'Pix', amount_total: Number(String(row['Valor total'] || amount).replace(',', '.')), installment_number: Number(row.Parcela || 1), installments_total: Number(row['Total parcelas'] || 1), due_date: row.Vencimento || null, settled: Number(String(row.Quitado || row['Valor recebido'] || 0).replace(',', '.')), notes: row.Observação || null };
    normalized.valid = /^\d{4}-\d{2}-\d{2}$/.test(normalized.purchase_date || '') && /^\d{4}-\d{2}$/.test(normalized.invoice_month || '') && Boolean(normalized.description) && amount > 0 && (responsibility === 'own' || Boolean(normalized.personName)); return normalized;
  }
  async function previewImport(file) {
    try { const text = await file.text(); state.restoreData = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : null; const sourceRows = state.restoreData ? state.restoreData.transactions || [] : parseCsv(text), imported = sourceRows.map(normalizeImportRow), fingerprints = new Set(state.transactions.map(item => `${item.purchase_date}|${item.description.toLocaleLowerCase('pt-BR')}|${Number(item.installment_amount).toFixed(2)}|${item.kind}|${item.installment_number}`)); imported.forEach(item => item.duplicate = item.valid && fingerprints.has(`${item.purchase_date}|${item.description.toLocaleLowerCase('pt-BR')}|${item.amount.toFixed(2)}|${item.kind}|${item.installment_number}`)); state.importRows = imported; const valid = imported.filter(item => item.valid && !item.duplicate).length; $('#importSummary').innerHTML = `<div class="summary-row"><span>Linhas encontradas</span><strong>${imported.length}</strong></div><div class="summary-row"><span>Prontas para importar</span><strong>${valid}</strong></div><div class="summary-row"><span>Duplicadas ou inválidas</span><strong>${imported.length-valid}</strong></div>${state.restoreData ? '<p class="muted">O backup também restaurará cadastros, contas, transferências e orçamentos.</p>' : ''}`; $('#importPreviewTable').innerHTML = imported.slice(0,100).map(item => `<tr><td>${escapeHtml(item.purchase_date || '')}</td><td>${escapeHtml(item.description || '')}</td><td>${item.kind === 'income' ? 'Receita' : 'Despesa'}</td><td>${item.amount ? brl.format(item.amount) : '-'}</td><td>${!item.valid ? 'Inválida' : item.duplicate ? 'Duplicada' : 'Importar'}</td></tr>`).join(''); $('#confirmImportBtn').disabled = !valid && !state.restoreData; $('#importDialog').showModal(); } catch (error) { handleError(error, 'ler arquivo de importação'); }
  }
  async function confirmImport() {
    const rows = state.importRows.filter(item => item.valid && !item.duplicate); if (!rows.length && !state.restoreData) return; setLoading(true, `Importando ${rows.length} lançamentos...`);
    try {
      if (state.restoreData) await restoreRegisters(state.restoreData);
      const peopleNames = [...new Set(rows.filter(item => item.responsibility !== 'own' && item.personName).map(item => item.personName))], categoryNames = [...new Set(rows.filter(item => item.categoryName).map(item => item.categoryName))], cardNames = [...new Set(rows.filter(item => item.cardName).map(item => item.cardName))], accountNames=[...new Set(rows.filter(item=>item.accountName).map(item=>item.accountName))];
      if (peopleNames.length) { const { error } = await sb.from('people').upsert(peopleNames.map(name => ({ user_id: state.user.id, name })), { onConflict: 'user_id,name', ignoreDuplicates: true }); if (error) throw error; }
      if (categoryNames.length) { const { error } = await sb.from('categories').upsert(categoryNames.map(name => ({ user_id: state.user.id, name })), { onConflict: 'user_id,name', ignoreDuplicates: true }); if (error) throw error; }
      if (cardNames.length) { const { error } = await sb.from('cards').upsert(cardNames.map(name => ({ user_id: state.user.id, name })), { onConflict: 'user_id,name', ignoreDuplicates: true }); if (error) throw error; }
      if(accountNames.length){const{error}=await sb.from('accounts').upsert(accountNames.map(name=>({user_id:state.user.id,name,type:'checking'})),{onConflict:'user_id,name',ignoreDuplicates:true});if(error)throw error;}
      const [{ data: people }, { data: categories }, { data: cards },{data:accounts}] = await Promise.all([sb.from('people').select('*').eq('user_id',state.user.id), sb.from('categories').select('*').eq('user_id',state.user.id), sb.from('cards').select('*').eq('user_id',state.user.id),sb.from('accounts').select('*').eq('user_id',state.user.id)]), series = new Map();
      const payloads = rows.map(item => { const key = `${item.purchase_date}|${item.description}|${item.amount_total}|${item.installments_total}|${item.personName || ''}`; if (!series.has(key)) series.set(key, createUuid()); return { user_id: state.user.id, kind: item.kind, description: item.description, category_id: categories.find(entry => entry.name === item.categoryName)?.id || categories.find(entry => entry.name === 'Outros')?.id || null, payment_method: item.payment_method, card_id: item.kind === 'expense' && item.responsibility !== 'payable' && item.payment_method === 'Crédito' ? cards.find(entry => entry.name === item.cardName)?.id || null : null, account_id: item.kind === 'income' || (item.responsibility !== 'payable' && item.payment_method !== 'Crédito') ? accounts.find(entry=>entry.name===item.accountName)?.id||null : null, person_id: item.responsibility === 'own' ? null : people.find(entry => entry.name === item.personName)?.id || null, responsibility: item.responsibility, amount_total: item.amount_total || item.amount, installment_number: item.installment_number, installments_total: item.installments_total, installment_amount: item.amount, purchase_date: item.purchase_date, invoice_month: monthStart(item.invoice_month), due_date: item.due_date || null, series_id: series.get(key), reimbursement_status: item.responsibility === 'own' ? null : 'pending', amount_received: 0, notes: item.notes } });
      let inserted=[]; if(payloads.length){ const result = await sb.from('transactions').insert(payloads).select('id,installment_amount,responsibility'); if (result.error) throw result.error; inserted=result.data; } const restoredIds=new Map(rows.map((row,index)=>[row.originalId,inserted[index]?.id])); const settlements = state.restoreData?.settlements?.length ? state.restoreData.settlements.map(item=>restoredIds.get(item.transaction_original_id)?{user_id:state.user.id,transaction_id:restoredIds.get(item.transaction_original_id),account_id:accounts.find(account=>account.name===item.account_name)?.id||null,direction:item.direction,amount:item.amount,settled_at:item.settled_at,notes:item.notes,source:'restore'}:null).filter(Boolean) : inserted.map((entry,index) => rows[index].settled > 0 && entry.responsibility !== 'own' ? { user_id: state.user.id, transaction_id: entry.id, direction: entry.responsibility === 'payable' ? 'paid' : 'received', amount: Math.min(rows[index].settled, Number(entry.installment_amount)), settled_at: todayInput(), notes: 'Importado do backup', source: 'import' } : null).filter(Boolean); if (settlements.length) { const result = await sb.from('settlements').insert(settlements); if (result.error) throw result.error; }
      if (state.restoreData) await restoreRelatedData(state.restoreData);
      $('#importDialog').close(); state.importRows = []; state.restoreData = null; $('#importCsvInput').value = ''; await loadData({ quiet: true }); toast(`${inserted.length} lançamentos importados e backup restaurado.`);
    } catch (error) { handleError(error, 'importar backup'); } finally { setLoading(false); }
  }
  async function restoreRegisters(backup) {
    const operations = [];
    if (backup.people?.length) operations.push(sb.from('people').upsert(backup.people.filter(item => !item.is_self).map(item => ({ user_id: state.user.id, name: item.name, archived_at: item.archived_at || null })), { onConflict: 'user_id,name' }));
    if (backup.cards?.length) operations.push(sb.from('cards').upsert(backup.cards.map(item => ({ user_id: state.user.id, name: item.name, closing_day: item.closing_day, due_day: item.due_day, archived_at: item.archived_at || null })), { onConflict: 'user_id,name' }));
    if (backup.categories?.length) operations.push(sb.from('categories').upsert(backup.categories.map(item => ({ user_id: state.user.id, name: item.name, kind: item.kind || 'both', color: item.color || '#0f766e', icon: item.icon || '●', archived_at: item.archived_at || null })), { onConflict: 'user_id,name' }));
    if (backup.accounts?.length) operations.push(sb.from('accounts').upsert(backup.accounts.map(item => ({ user_id: state.user.id, name: item.name, type: item.type, initial_balance: item.initial_balance, color: item.color || '#0f766e', archived_at: item.archived_at || null })), { onConflict: 'user_id,name' }));
    const results = await Promise.all(operations); const failed = results.find(item => item.error); if (failed) throw failed.error;
  }
  async function restoreRelatedData(backup) {
    const [{ data: accounts }, { data: categories }, { data: cards }] = await Promise.all([sb.from('accounts').select('*').eq('user_id',state.user.id),sb.from('categories').select('*').eq('user_id',state.user.id),sb.from('cards').select('*').eq('user_id',state.user.id)]);
    if (backup.transfers?.length) { const existing = new Set(state.transfers.map(item => `${item.transfer_date}|${item.description}|${item.amount}`)), payload = backup.transfers.filter(item => !existing.has(`${item.transfer_date}|${item.description}|${item.amount}`)).map(item => ({ user_id:state.user.id,from_account_id:accounts.find(account=>account.name===item.from_name)?.id,to_account_id:accounts.find(account=>account.name===item.to_name)?.id,amount:item.amount,transfer_date:item.transfer_date,description:item.description })).filter(item=>item.from_account_id&&item.to_account_id); if(payload.length){const result=await sb.from('transfers').insert(payload);if(result.error)throw result.error;} }
    if (backup.budgets?.length) { const payload=backup.budgets.map(item=>({user_id:state.user.id,category_id:categories.find(category=>category.name===item.category_name)?.id,month:item.month,amount:item.amount})).filter(item=>item.category_id);if(payload.length){const result=await sb.from('budgets').upsert(payload,{onConflict:'user_id,category_id,month'});if(result.error)throw result.error;} }
    if (backup.invoicePayments?.length) { const existing=new Set(state.invoicePayments.map(item=>`${item.card_id}|${item.invoice_month}|${item.amount}|${item.paid_at}`)),payload=backup.invoicePayments.map(item=>({user_id:state.user.id,card_id:cards.find(card=>card.name===item.card_name)?.id,account_id:accounts.find(account=>account.name===item.account_name)?.id||null,invoice_month:item.invoice_month,amount:item.amount,paid_at:item.paid_at,notes:item.notes})).filter(item=>item.card_id&&!existing.has(`${item.card_id}|${item.invoice_month}|${item.amount}|${item.paid_at}`));if(payload.length){const result=await sb.from('card_invoice_payments').insert(payload);if(result.error)throw result.error;} }
  }
  function downloadFile(content, type, filename) { const anchor=document.createElement('a');anchor.href=URL.createObjectURL(new Blob([content],{type}));anchor.download=filename;anchor.click();URL.revokeObjectURL(anchor.href); }
  function exportJsonBackup() {
    const transactions=state.transactions.map(item=>({OriginalId:item.id,Data:item.purchase_date,Tipo:item.kind,Descrição:item.description,Categoria:state.categories.find(category=>category.id===item.category_id)?.name||'',Forma:item.payment_method,Cartão:item.cards?.name||'',Conta:item.accounts?.name||'',Responsabilidade:directionLabel(responsibilityOf(item)),Pessoa:item.people?.name||'','Valor total':item.amount_total,Parcela:item.installment_number,'Total parcelas':item.installments_total,'Valor parcela':item.installment_amount,Mês:item.invoice_month,Vencimento:item.due_date||'',Quitado:settledAmount(item),Observação:item.notes||''}));
    const backup={version:4,exportedAt:new Date().toISOString(),people:state.people,cards:state.cards,categories:state.categories,accounts:state.accounts,transactions,settlements:state.settlements.map(item=>({...item,transaction_original_id:item.transaction_id,account_name:state.accounts.find(account=>account.id===item.account_id)?.name})),transfers:state.transfers.map(item=>({...item,from_name:state.accounts.find(account=>account.id===item.from_account_id)?.name,to_name:state.accounts.find(account=>account.id===item.to_account_id)?.name})),budgets:state.budgets.map(item=>({...item,category_name:state.categories.find(category=>category.id===item.category_id)?.name})),invoicePayments:state.invoicePayments.map(item=>({...item,card_name:state.cards.find(card=>card.id===item.card_id)?.name,account_name:state.accounts.find(account=>account.id===item.account_id)?.name}))}; downloadFile(JSON.stringify(backup,null,2),'application/json',`controle-financeiro-backup-${todayInput()}.json`); toast('Backup completo exportado.');
  }
  function exportCsv(all = false) {
    const rows = all ? state.transactions : filteredHistory(), header = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Forma', 'Cartão', 'Conta', 'Responsabilidade', 'Pessoa', 'Valor total', 'Parcela', 'Total parcelas', 'Valor parcela', 'Mês', 'Vencimento', 'Quitado', 'Restante', 'Observação'];
    const data = rows.map(item => [item.purchase_date, item.kind, item.description, state.categories.find(category => category.id === item.category_id)?.name || '', item.payment_method, item.cards?.name || '',item.accounts?.name||'', directionLabel(responsibilityOf(item)), item.people?.name || '', item.amount_total, item.installment_number, item.installments_total, item.installment_amount, item.invoice_month, item.due_date || '', settledAmount(item), remainingOf(item), item.notes || '']), quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`, csv = '\uFEFF' + [header, ...data].map(row => row.map(quote).join(';')).join('\r\n'), anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); anchor.download = `controle-financeiro-${todayInput()}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
  }

  $('#authForm').addEventListener('submit', async event => { event.preventDefault(); setMessage($('#authMessage'), 'Entrando...'); const { error } = await sb.auth.signInWithPassword({ email: $('#authEmail').value, password: $('#authPassword').value }); if (error) setMessage($('#authMessage'), error.message, true); });
  $('#signupBtn').onclick = async () => { setMessage($('#authMessage'), 'Criando conta...'); const { error } = await sb.auth.signUp({ email: $('#authEmail').value, password: $('#authPassword').value }); setMessage($('#authMessage'), error ? error.message : 'Conta criada. Confira sua caixa de entrada se a confirmação estiver ativa.', Boolean(error)); };
  $('#forgotPasswordBtn').onclick = async () => { const email = $('#authEmail').value.trim(); if (!email) return setMessage($('#authMessage'), 'Informe seu e-mail para recuperar a senha.', true); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('?')[0].split('#')[0] }); setMessage($('#authMessage'), error ? error.message : 'Enviamos o link de recuperação para seu e-mail.', Boolean(error)); };
  $('#logoutBtn').onclick = () => sb.auth.signOut(); $$('[data-nav]').forEach(button => button.addEventListener('click', () => nav(button.dataset.nav)));
  $$('.seg').forEach(button => button.onclick = () => { $$('.seg').forEach(item => item.classList.remove('active')); button.classList.add('active'); $('#transactionKind').value = button.dataset.kind; updateCategorySelect(); updateKindUI(); });
  ['amount', 'installments', 'recurringMonths'].forEach(id => $(`#${id}`).addEventListener('input', updatePreview)); ['purchaseDate', 'card'].forEach(id => $(`#${id}`).addEventListener('change', () => updateAutoDates(true))); $('#paymentMethod').addEventListener('change', () => { updateResponsibilityUI(); updateAutoDates(true); });
  $('#responsibility').addEventListener('change', updateResponsibilityUI); $('#invoiceMonth').addEventListener('change', () => { state.invoiceMonthTouched = true; updateAutoDates(); }); $('#transactionForm').addEventListener('submit', saveTransaction); $('#cancelEditBtn').onclick = cancelEdit;
  $('#updateSeries').onchange = () => {
    const item = state.transactions.find(transaction => transaction.id === $('#editingTransactionId').value); if (!item) return;
    const series = state.transactions.filter(transaction => transaction.series_id === item.series_id).sort((a, b) => a.installment_number - b.installment_number), reference = $('#updateSeries').checked ? series[0] : item;
    $('#amount').value = Number($('#updateSeries').checked ? item.amount_total : item.installment_amount).toFixed(2); $('#purchaseDate').value = reference.purchase_date; $('#invoiceMonth').value = String(reference.invoice_month).slice(0, 7); $('#dueDate').value = reference.due_date || ''; updatePreview();
  };
  $('#dashboardMonth').onchange = renderDashboard; $('#invoiceFilterMonth').onchange = renderDebts; $('#invoicePersonFilter').onchange = renderDebts;
  ['historyMonth','historyKind','historySearch','historyCategoryFilter','historyCardFilter','historyPersonFilter','historyResponsibility','historyStatus','historyDateFrom','historyDateTo','historyMin','historyMax'].forEach(id => $(`#${id}`).addEventListener(id === 'historySearch' ? 'input' : 'change', () => { state.historyPage = 1; renderHistory(); }));
  $('#clearHistoryFilters').onclick = () => { ['historyKind','historySearch','historyCategoryFilter','historyCardFilter','historyPersonFilter','historyResponsibility','historyStatus','historyDateFrom','historyDateTo','historyMin','historyMax'].forEach(id => $(`#${id}`).value = ''); $('#historyMonth').value = yyyyMm(); state.historyPage = 1; renderHistory(); };
  $('#reportMonth').onchange = renderReports;
  $('#historyPrev').onclick = () => { state.historyPage--; renderHistory(); }; $('#historyNext').onclick = () => { state.historyPage++; renderHistory(); }; $('#prevMonth').onclick = () => { $('#dashboardMonth').value = core.addMonths($('#dashboardMonth').value, -1); renderDashboard(); }; $('#nextMonth').onclick = () => { $('#dashboardMonth').value = core.addMonths($('#dashboardMonth').value, 1); renderDashboard(); };
  $('#settlementForm').addEventListener('submit', saveSettlement); $('#closeSettlementBtn').onclick = () => $('#settlementDialog').close(); $('#budgetForm').addEventListener('submit', saveBudget);
  $('#invoicePaymentForm').addEventListener('submit', saveInvoicePayment); $('#closeInvoicePaymentBtn').onclick = () => $('#invoicePaymentDialog').close();
  $('#deleteOneBtn').onclick = () => executeDelete('one'); $('#deleteFutureBtn').onclick = () => executeDelete('future'); $('#deleteSeriesBtn').onclick = () => executeDelete('series');
  $('#enableNotificationsBtn').onclick = enableNotifications;
  $('#personForm').onsubmit = async event => { event.preventDefault(); const name = $('#newPerson').value.trim(); if (!name) return; const { error } = await sb.from('people').insert({ user_id: state.user.id, name }); if (error) return toast(humanError(error), 'error'); $('#newPerson').value = ''; await loadData({ quiet: true }); renderRegisters(); toast('Pessoa adicionada.'); };
  $('#cardForm').onsubmit = async event => { event.preventDefault(); const name = $('#newCard').value.trim(); if (!name) return; const payload = { user_id: state.user.id, name, closing_day: Number($('#closingDay').value) || null, due_day: Number($('#dueDay').value) || null }, { error } = await sb.from('cards').insert(payload); if (error) return toast(humanError(error), 'error'); event.target.reset(); await loadData({ quiet: true }); renderRegisters(); toast('Cartão adicionado.'); };
  $('#categoryForm').onsubmit = async event => { event.preventDefault(); const payload = { user_id: state.user.id, name: $('#newCategory').value.trim(), kind: $('#newCategoryKind').value, color: $('#newCategoryColor').value, icon: $('#newCategoryIcon').value.trim() || '●' }, { error } = await sb.from('categories').insert(payload); if (error) return handleError(error, 'adicionar categoria'); event.target.reset(); $('#newCategoryColor').value = '#0f766e'; $('#newCategoryIcon').value = '●'; await loadData({ quiet: true }); renderRegisters(); toast('Categoria adicionada.'); };
  $('#accountForm').onsubmit = async event => { event.preventDefault(); const payload = { user_id: state.user.id, name: $('#newAccount').value.trim(), type: $('#newAccountType').value, initial_balance: Number($('#newAccountBalance').value || 0) }, { error } = await sb.from('accounts').insert(payload); if (error) return handleError(error, 'adicionar conta'); event.target.reset(); $('#newAccountBalance').value = '0'; await loadData({ quiet: true }); renderRegisters(); toast('Conta adicionada.'); };
  $('#transferForm').onsubmit = async event => { event.preventDefault(); if ($('#transferFrom').value === $('#transferTo').value) return toast('Escolha contas diferentes.', 'error'); const payload = { user_id: state.user.id, from_account_id: $('#transferFrom').value, to_account_id: $('#transferTo').value, amount: Number($('#transferAmount').value), transfer_date: $('#transferDate').value, description: $('#transferDescription').value.trim() || null }, { error } = await sb.from('transfers').insert(payload); if (error) return handleError(error, 'registrar transferência'); event.target.reset(); $('#transferDate').value = todayInput(); await loadData({ quiet: true }); renderRegisters(); toast('Transferência registrada.'); };
  $('#exportCsvBtn').onclick = () => exportCsv(false); $('#exportCsvBtn2').onclick = () => exportCsv(true);
  $('#exportJsonBtn').onclick = exportJsonBackup;
  $('#importCsvInput').onchange = event => { if (event.target.files[0]) previewImport(event.target.files[0]); }; $('#confirmImportBtn').onclick = confirmImport;
  $('#clearErrorsBtn').onclick = async () => { const { error } = await sb.from('app_errors').delete().eq('user_id', state.user.id); if (error) return handleError(error, 'limpar diagnóstico'); await loadData({ quiet: true }); renderRegisters(); toast('Registros de diagnóstico removidos.'); };
  $('#resetPasswordForm').onsubmit = async event => { event.preventDefault(); const { error } = await sb.auth.updateUser({ password: $('#newPassword').value }); if (error) return handleError(error, 'redefinir senha'); $('#resetPasswordDialog').close(); toast('Senha atualizada.'); };
  let deferredPrompt = null; window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (!deferredPrompt) return toast('No iPhone/iPad: Safari → Compartilhar → Adicionar à Tela de Início.'); deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; };
  if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      await registration.update();
    } catch (error) {
      console.warn(error);
    }
  });
  window.addEventListener('error', event => recordError(event.error || new Error(event.message), 'erro global')); window.addEventListener('unhandledrejection', event => recordError(event.reason, 'promessa não tratada'));
  sb.auth.onAuthStateChange(async (authEvent, session) => {
    if (!session) { state.user = null; show('authScreen'); return; } state.user = session.user; show('mainScreen');
    if (authEvent === 'PASSWORD_RECOVERY') $('#resetPasswordDialog').showModal();
    try { await ensureSeed(); setFormDefaults(); await loadData(); cancelEdit(); nav('dashboard'); } catch (error) { setLoading(false); handleError(error, 'inicializar aplicativo'); }
  });
  sb.auth.getSession().then(({ data: { session } }) => { if (!session) show('authScreen'); });
})();
