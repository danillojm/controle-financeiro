const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = [
  'angular-app/src/app/core/finance-store.service.ts',
  'angular-app/src/app/pages/entry/entry.ts',
  'angular-app/src/app/pages/debts/debts.ts',
  'angular-app/src/app/pages/history/history.ts',
  'angular-app/src/app/pages/registers/registers.ts',
].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const migration = fs.readFileSync('supabase/migration_v4.sql', 'utf8');
for (const table of ['accounts','transfers','card_invoice_payments','notification_preferences','app_errors']) {
  assert.match(migration, new RegExp(`public\\.${table}`), `Migração v4 sem ${table}`);
}
for (const feature of ['accountBalance','payInvoice','exportCsv','exportJson','restore']) {
  assert.match(source, new RegExp(feature), `Angular sem recurso v4: ${feature}`);
}
console.log('contrato Angular v4: todos os testes passaram');
