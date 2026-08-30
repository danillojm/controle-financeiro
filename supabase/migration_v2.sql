-- Meu Controle Financeiro — Migração v2
--
-- Use este arquivo somente em projetos que já executaram a versão anterior
-- do schema. No Supabase: SQL Editor > New query > cole este arquivo > Run.
--
-- A migração preserva os lançamentos existentes:
--   - despesas vinculadas a outra pessoa viram "Outra pessoa me deve";
--   - receitas e demais despesas viram "Meu gasto".

begin;

alter table public.transactions
  add column if not exists responsibility text;

update public.transactions t
set responsibility = case
  when t.kind = 'income' then 'own'
  when exists (
    select 1
    from public.people p
    where p.id = t.person_id
      and p.is_self = false
  ) then 'receivable'
  else 'own'
end
where t.responsibility is null;

alter table public.transactions
  alter column responsibility set default 'own',
  alter column responsibility set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_responsibility_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_responsibility_check
      check (responsibility in ('own', 'receivable', 'payable'));
  end if;
end $$;

create index if not exists idx_transactions_user_responsibility
  on public.transactions(user_id, responsibility);

commit;
