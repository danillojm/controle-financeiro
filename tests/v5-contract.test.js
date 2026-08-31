const assert = require('node:assert/strict');
const fs = require('node:fs');
const migration = fs.readFileSync('supabase/migration_v5.sql', 'utf8');

for (const fn of [
  'validate_transaction_account_v5',
  'validate_settlement_account_v5',
  'validate_transfer_accounts_v5',
  'validate_invoice_payment_v5',
]) {
  assert.match(migration, new RegExp(`function public\\.${fn}`), `Função ausente: ${fn}`);
}
assert.doesNotMatch(
  migration.match(/function public\.validate_transaction_account_v5[\s\S]*?\$\$;/)?.[0] || '',
  /from_account_id/,
  'O gatilho de lançamentos não pode acessar campos de transferências',
);
console.log('contrato v5: gatilhos separados e compatíveis');
