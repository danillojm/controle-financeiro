const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migration_v6.sql', 'utf8');
const entry = fs.readFileSync('angular-app/src/app/pages/entry/entry.ts', 'utf8');
const template = fs.readFileSync('angular-app/src/app/pages/entry/entry.html', 'utf8');

assert.match(migration, /recurrence_type/, 'Migração v6 sem tipo de recorrência');
assert.match(migration, /update_transaction_series_v6/, 'Migração v6 sem atualização atômica');
assert.match(
  migration,
  /when p_recurrence_type = 'monthly' then p_amount_total/,
  'Série mensal não mantém o valor integral',
);
assert.match(entry, /Array\(count\)\.fill\(this\.form\.amount\)/, 'Dívida mensal não repete o valor');
assert.match(entry, /await this\.store\.load\(\)/, 'Edição não recarrega as outras telas');
assert.match(template, /Dívida de valor fixo mensal/, 'Opção mensal ausente no formulário');

console.log('contrato v6: dívida mensal e atualização consistente');
