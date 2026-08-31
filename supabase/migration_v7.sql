-- Meu Controle Financeiro — Migração v7
-- Identifica compras importadas de faturas e impede importações duplicadas.

begin;

alter table public.transactions
  add column if not exists import_fingerprint text;

create unique index if not exists transactions_user_import_fingerprint_key
  on public.transactions(user_id, import_fingerprint);

commit;
