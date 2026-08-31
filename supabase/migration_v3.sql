-- Meu Controle Financeiro — Migração v3
-- Execute após migration_v2.sql em projetos existentes.

begin;

alter table public.transactions
  add column if not exists due_date date,
  add column if not exists series_id uuid;

update public.transactions set series_id = id where series_id is null;
alter table public.transactions
  alter column series_id set default gen_random_uuid(),
  alter column series_id set not null;

-- Normaliza vínculos permitidos antes de ativar as novas validações.
update public.transactions
set responsibility = 'own', reimbursement_status = null, amount_received = 0
where responsibility in ('receivable', 'payable') and person_id is null;

update public.transactions set person_id = null where responsibility = 'own';

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  direction text not null check (direction in ('received', 'paid')),
  amount numeric(12,2) not null check (amount > 0),
  settled_at date not null default current_date,
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_settlements_legacy_unique
  on public.settlements(transaction_id, source)
  where source = 'legacy';

insert into public.settlements (user_id, transaction_id, direction, amount, settled_at, source, notes)
select
  t.user_id,
  t.id,
  case when t.responsibility = 'payable' then 'paid' else 'received' end,
  least(t.amount_received, t.installment_amount),
  current_date,
  'legacy',
  'Quitação importada da versão anterior'
from public.transactions t
where t.amount_received > 0
  and t.responsibility in ('receivable', 'payable')
on conflict do nothing;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month date not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(user_id, category_id, month)
);

create index if not exists idx_transactions_user_due_date
  on public.transactions(user_id, due_date);
create index if not exists idx_transactions_user_series
  on public.transactions(user_id, series_id);
create index if not exists idx_settlements_user_transaction
  on public.settlements(user_id, transaction_id);
create index if not exists idx_budgets_user_month
  on public.budgets(user_id, month);

alter table public.settlements enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "settlements_own" on public.settlements;
create policy "settlements_own" on public.settlements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "budgets_own" on public.budgets;
create policy "budgets_own" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.validate_finance_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.settlements s
    where s.transaction_id = new.id
    group by s.transaction_id
    having sum(s.amount) > new.installment_amount
  ) then
    raise exception 'O valor da parcela não pode ser menor que o total já quitado.';
  end if;

  if tg_op = 'UPDATE' then
    if (old.responsibility <> new.responsibility or old.person_id is distinct from new.person_id) and exists (
      select 1 from public.settlements s where s.transaction_id = new.id
    ) then
      raise exception 'Remova as quitações antes de alterar a pessoa ou a responsabilidade.';
    end if;
  end if;

  if new.person_id is not null and not exists (
    select 1 from public.people p where p.id = new.person_id and p.user_id = new.user_id
  ) then
    raise exception 'A pessoa selecionada não pertence ao usuário.';
  end if;

  if new.card_id is not null and not exists (
    select 1 from public.cards c where c.id = new.card_id and c.user_id = new.user_id
  ) then
    raise exception 'O cartão selecionado não pertence ao usuário.';
  end if;

  if new.kind = 'income' and (new.responsibility <> 'own' or new.person_id is not null) then
    raise exception 'Receitas devem usar responsabilidade própria e não podem ter pessoa.';
  end if;

  if new.responsibility = 'own' and new.person_id is not null then
    raise exception 'Gastos próprios não podem ter outra pessoa vinculada.';
  end if;

  if new.responsibility in ('receivable', 'payable') and new.person_id is null then
    raise exception 'Dívidas precisam ter uma pessoa vinculada.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_finance_ownership on public.transactions;
create trigger trg_validate_finance_ownership
before insert or update on public.transactions
for each row execute function public.validate_finance_ownership();

create or replace function public.validate_settlement_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  transaction_owner uuid;
  transaction_responsibility text;
begin
  select user_id, responsibility
    into transaction_owner, transaction_responsibility
  from public.transactions
  where id = new.transaction_id;

  if transaction_owner is null or transaction_owner <> new.user_id then
    raise exception 'O lançamento da quitação não pertence ao usuário.';
  end if;

  if transaction_responsibility not in ('receivable', 'payable') then
    raise exception 'Somente dívidas podem receber quitações.';
  end if;

  if (
    select coalesce(sum(s.amount), 0)
    from public.settlements s
    where s.transaction_id = new.transaction_id
      and s.id <> new.id
  ) + new.amount > (
    select t.installment_amount
    from public.transactions t
    where t.id = new.transaction_id
  ) then
    raise exception 'A quitação não pode ultrapassar o saldo do lançamento.';
  end if;

  if (transaction_responsibility = 'receivable' and new.direction <> 'received')
    or (transaction_responsibility = 'payable' and new.direction <> 'paid') then
    raise exception 'O sentido da quitação não corresponde ao lançamento.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_settlement_ownership on public.settlements;
create trigger trg_validate_settlement_ownership
before insert or update on public.settlements
for each row execute function public.validate_settlement_ownership();

create or replace function public.validate_budget_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.categories c
    where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'A categoria do orçamento não pertence ao usuário.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_budget_ownership on public.budgets;
create trigger trg_validate_budget_ownership
before insert or update on public.budgets
for each row execute function public.validate_budget_ownership();

create or replace function public.update_transaction_series(
  p_series_id uuid,
  p_description text,
  p_category_id uuid,
  p_payment_method text,
  p_card_id uuid,
  p_person_id uuid,
  p_responsibility text,
  p_amount_total numeric,
  p_purchase_date date,
  p_first_invoice_month date,
  p_due_day integer,
  p_notes text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  changed_rows integer;
begin
  update public.transactions t
  set description = p_description,
      category_id = p_category_id,
      payment_method = p_payment_method,
      card_id = p_card_id,
      person_id = p_person_id,
      responsibility = p_responsibility,
      amount_total = p_amount_total,
      installment_amount = case
        when t.kind = 'income' then p_amount_total
        else floor((p_amount_total * 100) / t.installments_total) / 100
          + case
              when t.installment_number <= mod(round(p_amount_total * 100)::integer, t.installments_total) then 0.01
              else 0
            end
      end,
      purchase_date = case
        when t.kind = 'income' and t.installment_number > 1 then (
          date_trunc('month', p_first_invoice_month)
          + ((t.installment_number - 1) || ' months')::interval
        )::date
        else p_purchase_date
      end,
      invoice_month = (
        date_trunc('month', p_first_invoice_month)
        + ((t.installment_number - 1) || ' months')::interval
      )::date,
      due_date = case when p_due_day is null then null else make_date(
        extract(year from (date_trunc('month', p_first_invoice_month) + ((t.installment_number - 1) || ' months')::interval))::integer,
        extract(month from (date_trunc('month', p_first_invoice_month) + ((t.installment_number - 1) || ' months')::interval))::integer,
        least(
          p_due_day,
          extract(day from (date_trunc('month', p_first_invoice_month) + (t.installment_number || ' months')::interval - interval '1 day'))::integer
        )
      ) end,
      notes = p_notes
  where t.user_id = auth.uid()
    and t.series_id = p_series_id;

  get diagnostics changed_rows = row_count;
  return changed_rows;
end;
$$;

commit;
