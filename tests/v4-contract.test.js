const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migration_v4.sql', 'utf8');

for (const id of ['categoryForm','accountForm','transferForm','importDialog','deleteDialog','resetPasswordForm','cardInvoiceSummary','settlementAccount']) {
  assert.match(html, new RegExp(`id="${id}"`), `Interface v4 sem ${id}`);
}
for (const table of ['accounts','transfers','card_invoice_payments','notification_preferences','app_errors']) {
  assert.match(migration, new RegExp(`public\\.${table}`), `Migração v4 sem ${table}`);
}
for (const feature of ['confirmImport','executeDelete','saveInvoicePayment','accountBalance','handleError']) {
  assert.match(app, new RegExp(`function ${feature}`), `app.js sem ${feature}`);
}
const saveFlow = app.match(/async function saveTransaction[\s\S]*?\n  function setFormDefaults/)?.[0] || '';
assert.match(saveFlow, /haptic\(/, 'Salvamento sem resposta tátil');
assert.match(saveFlow, /description.*focus/, 'Salvamento não prepara o próximo lançamento');
assert.doesNotMatch(saveFlow, /nav\(['"]dashboard/, 'Salvamento ainda redireciona para o início');
assert.match(migration, /alter table public\.settlements[\s\S]*account_id/, 'Quitações sem vínculo com conta');

console.log('contrato v4: todos os testes passaram');
