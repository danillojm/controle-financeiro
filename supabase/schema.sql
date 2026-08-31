-- Execute este arquivo no Supabase: SQL Editor > New query > Run
create extension if not exists pgcrypto;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_self boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id,name)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  closing_day int check (closing_day between 1 and 31),
  due_day int check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  unique(user_id,name)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(user_id,name)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('expense','income')),
  description text not null,
  category_id uuid references public.categories(id) on delete set null,
  payment_method text,
  card_id uuid references public.cards(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  responsibility text not null default 'own' check(responsibility in ('own','receivable','payable')),
  amount_total numeric(12,2) not null check(amount_total > 0),
  installment_number int not null default 1 check(installment_number >= 1),
  installments_total int not null default 1 check(installments_total >= 1),
  installment_amount numeric(12,2) not null check(installment_amount > 0),
  purchase_date date not null,
  invoice_month date not null,
  due_date date,
  series_id uuid not null default gen_random_uuid(),
  reimbursement_status text check(reimbursement_status in ('pending','paid') or reimbursement_status is null),
  amount_received numeric(12,2) not null default 0 check(amount_received >= 0),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.transactions
  add column if not exists due_date date,
  add column if not exists series_id uuid;

update public.transactions set series_id = id where series_id is null;
alter table public.transactions
  alter column series_id set default gen_random_uuid(),
  alter column series_id set not null;

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  direction text not null check (direction in ('received','paid')),
  amount numeric(12,2) not null check (amount > 0),
  settled_at date not null default current_date,
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month date not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(user_id,category_id,month)
);

-- Migração segura para projetos que já executaram uma versão anterior do schema.
alter table public.transactions
  add column if not exists responsibility text;

update public.transactions t
set responsibility = case
  when t.kind = 'income' then 'own'
  when exists (
    select 1 from public.people p
    where p.id = t.person_id and p.is_self = false
  ) then 'receivable'
  else 'own'
end
where responsibility is null;

alter table public.transactions
  alter column responsibility set default 'own',
  alter column responsibility set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_responsibility_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_responsibility_check
      check (responsibility in ('own','receivable','payable'));
  end if;
end $$;

update public.transactions
set responsibility = 'own', reimbursement_status = null, amount_received = 0
where responsibility in ('receivable','payable') and person_id is null;

update public.transactions set person_id = null where responsibility = 'own';

create index if not exists idx_transactions_user_invoice on public.transactions(user_id, invoice_month);
create index if not exists idx_transactions_user_person on public.transactions(user_id, person_id);
create index if not exists idx_transactions_user_responsibility on public.transactions(user_id, responsibility);
create index if not exists idx_transactions_user_due_date on public.transactions(user_id, due_date);
create index if not exists idx_transactions_user_series on public.transactions(user_id, series_id);
create index if not exists idx_settlements_user_transaction on public.settlements(user_id, transaction_id);
create unique index if not exists idx_settlements_legacy_unique on public.settlements(transaction_id, source) where source = 'legacy';
create index if not exists idx_budgets_user_month on public.budgets(user_id, month);

insert into public.settlements (user_id, transaction_id, direction, amount, settled_at, source, notes)
select t.user_id, t.id,
  case when t.responsibility = 'payable' then 'paid' else 'received' end,
  least(t.amount_received, t.installment_amount), current_date, 'legacy',
  'Quitação importada da versão anterior'
from public.transactions t
where t.amount_received > 0
  and t.responsibility in ('receivable','payable')
on conflict do nothing;

alter table public.people enable row level security;
alter table public.cards enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.settlements enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "people_own" on public.people;
create policy "people_own" on public.people for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cards_own" on public.cards;
create policy "cards_own" on public.cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "categories_own" on public.categories;
create policy "categories_own" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "transactions_own" on public.transactions;
create policy "transactions_own" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "settlements_own" on public.settlements;
create policy "settlements_own" on public.settlements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "budgets_own" on public.budgets;
create policy "budgets_own" on public.budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.validate_finance_ownership()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if exists (
    select 1 from public.settlements s where s.transaction_id = new.id
    group by s.transaction_id having sum(s.amount) > new.installment_amount
  ) then raise exception 'O valor da parcela não pode ser menor que o total já quitado.';
  end if;
  if tg_op = 'UPDATE' then
    if (old.responsibility <> new.responsibility or old.person_id is distinct from new.person_id) and exists (
      select 1 from public.settlements s where s.transaction_id = new.id
    ) then raise exception 'Remova as quitações antes de alterar a pessoa ou a responsabilidade.';
    end if;
  end if;
  if new.person_id is not null and not exists (
    select 1 from public.people p where p.id = new.person_id and p.user_id = new.user_id
  ) then raise exception 'A pessoa selecionada não pertence ao usuário.';
  end if;
  if new.card_id is not null and not exists (
    select 1 from public.cards c where c.id = new.card_id and c.user_id = new.user_id
  ) then raise exception 'O cartão selecionado não pertence ao usuário.';
  end if;
  if new.kind = 'income' and (new.responsibility <> 'own' or new.person_id is not null) then
    raise exception 'Receitas devem usar responsabilidade própria e não podem ter pessoa.';
  end if;
  if new.responsibility = 'own' and new.person_id is not null then
    raise exception 'Gastos próprios não podem ter outra pessoa vinculada.';
  end if;
  if new.responsibility in ('receivable','payable') and new.person_id is null then
    raise exception 'Dívidas precisam ter uma pessoa vinculada.';
  end if;
  return new;
end;
$$;

-- Recursos da versão 4. Para bancos existentes, use migration_v4.sql.
alter table public.people add column if not exists archived_at timestamptz;
alter table public.cards add column if not exists archived_at timestamptz;
alter table public.categories add column if not exists archived_at timestamptz,
  add column if not exists color text not null default '#0f766e',
  add column if not exists icon text not null default '●',
  add column if not exists kind text not null default 'both';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='categories_kind_check' and conrelid='public.categories'::regclass) then
    alter table public.categories add constraint categories_kind_check check(kind in ('expense','income','both'));
  end if;
end $$;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, type text not null default 'checking' check(type in ('checking','savings','cash','investment')),
  initial_balance numeric(12,2) not null default 0, color text not null default '#0f766e', archived_at timestamptz,
  created_at timestamptz not null default now(), unique(user_id,name)
);
alter table public.transactions add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.settlements add column if not exists account_id uuid references public.accounts(id) on delete set null;
create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  from_account_id uuid not null references public.accounts(id) on delete restrict, to_account_id uuid not null references public.accounts(id) on delete restrict,
  amount numeric(12,2) not null check(amount>0), transfer_date date not null, description text, created_at timestamptz not null default now(), check(from_account_id<>to_account_id)
);
create table if not exists public.card_invoice_payments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade, invoice_month date not null,
  account_id uuid references public.accounts(id) on delete set null, amount numeric(12,2) not null check(amount>0),
  paid_at date not null default current_date, notes text, created_at timestamptz not null default now()
);
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default false,
  days_before integer not null default 7 check(days_before between 0 and 30), updated_at timestamptz not null default now()
);
create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  message text not null, context text, details jsonb, app_version text, created_at timestamptz not null default now()
);
create index if not exists idx_transactions_user_account on public.transactions(user_id,account_id);
create index if not exists idx_settlements_user_account on public.settlements(user_id,account_id);
create index if not exists idx_transfers_user_date on public.transfers(user_id,transfer_date);
create index if not exists idx_invoice_payments_user_month on public.card_invoice_payments(user_id,invoice_month);
create index if not exists idx_app_errors_user_created on public.app_errors(user_id,created_at desc);
alter table public.accounts enable row level security; alter table public.transfers enable row level security;
alter table public.card_invoice_payments enable row level security; alter table public.notification_preferences enable row level security; alter table public.app_errors enable row level security;
drop policy if exists "accounts_own" on public.accounts; create policy "accounts_own" on public.accounts for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "transfers_own" on public.transfers; create policy "transfers_own" on public.transfers for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "invoice_payments_own" on public.card_invoice_payments; create policy "invoice_payments_own" on public.card_invoice_payments for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "notification_preferences_own" on public.notification_preferences; create policy "notification_preferences_own" on public.notification_preferences for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "app_errors_insert_own" on public.app_errors; create policy "app_errors_insert_own" on public.app_errors for insert with check(auth.uid()=user_id);
drop policy if exists "app_errors_select_own" on public.app_errors; create policy "app_errors_select_own" on public.app_errors for select using(auth.uid()=user_id);
drop policy if exists "app_errors_delete_own" on public.app_errors; create policy "app_errors_delete_own" on public.app_errors for delete using(auth.uid()=user_id);

create or replace function public.validate_v4_ownership() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_table_name='transactions' and new.account_id is not null and not exists(select 1 from public.accounts a where a.id=new.account_id and a.user_id=new.user_id) then raise exception 'A conta selecionada não pertence ao usuário.'; end if;
  if tg_table_name='settlements' and new.account_id is not null and not exists(select 1 from public.accounts a where a.id=new.account_id and a.user_id=new.user_id) then raise exception 'A conta da quitação não pertence ao usuário.'; end if;
  if tg_table_name='transfers' and (not exists(select 1 from public.accounts a where a.id=new.from_account_id and a.user_id=new.user_id) or not exists(select 1 from public.accounts a where a.id=new.to_account_id and a.user_id=new.user_id)) then raise exception 'As contas da transferência devem pertencer ao usuário.'; end if;
  if tg_table_name='card_invoice_payments' and (not exists(select 1 from public.cards c where c.id=new.card_id and c.user_id=new.user_id) or (new.account_id is not null and not exists(select 1 from public.accounts a where a.id=new.account_id and a.user_id=new.user_id))) then raise exception 'O cartão e a conta do pagamento devem pertencer ao usuário.'; end if;
  if tg_table_name='card_invoice_payments' and (select coalesce(sum(p.amount),0) from public.card_invoice_payments p where p.card_id=new.card_id and p.invoice_month=new.invoice_month and p.id<>new.id)+new.amount>(select coalesce(sum(t.installment_amount),0) from public.transactions t where t.user_id=new.user_id and t.card_id=new.card_id and t.invoice_month=new.invoice_month and t.kind='expense') then raise exception 'O pagamento não pode ultrapassar o total da fatura.'; end if;
  return new;
end $$;
drop trigger if exists trg_validate_transaction_account on public.transactions; create trigger trg_validate_transaction_account before insert or update on public.transactions for each row execute function public.validate_v4_ownership();
drop trigger if exists trg_validate_settlement_account on public.settlements; create trigger trg_validate_settlement_account before insert or update on public.settlements for each row execute function public.validate_v4_ownership();
drop trigger if exists trg_validate_transfer_accounts on public.transfers; create trigger trg_validate_transfer_accounts before insert or update on public.transfers for each row execute function public.validate_v4_ownership();
drop trigger if exists trg_validate_invoice_payment on public.card_invoice_payments; create trigger trg_validate_invoice_payment before insert or update on public.card_invoice_payments for each row execute function public.validate_v4_ownership();

create or replace function public.get_dashboard_summary(p_month date)
returns table(income numeric,expenses numeric,receivable numeric,payable numeric) language sql security invoker set search_path=public as $$
select coalesce(sum(t.installment_amount) filter(where t.kind='income'),0),
coalesce(sum(t.installment_amount) filter(where t.kind='expense' and t.responsibility in ('own','payable')),0),
coalesce(sum(greatest(t.installment_amount-coalesce(s.settled,0),0)) filter(where t.responsibility='receivable'),0),
coalesce(sum(greatest(t.installment_amount-coalesce(s.settled,0),0)) filter(where t.responsibility='payable'),0)
from public.transactions t left join(select transaction_id,sum(amount) settled from public.settlements group by transaction_id)s on s.transaction_id=t.id
where t.user_id=auth.uid() and t.invoice_month=date_trunc('month',p_month)::date $$;

drop trigger if exists trg_validate_finance_ownership on public.transactions;
create trigger trg_validate_finance_ownership before insert or update on public.transactions
for each row execute function public.validate_finance_ownership();

create or replace function public.validate_settlement_ownership()
returns trigger language plpgsql security invoker set search_path = public as $$
declare transaction_owner uuid; transaction_responsibility text;
begin
  select user_id, responsibility into transaction_owner, transaction_responsibility
  from public.transactions where id = new.transaction_id;
  if transaction_owner is null or transaction_owner <> new.user_id then
    raise exception 'O lançamento da quitação não pertence ao usuário.';
  end if;
  if transaction_responsibility not in ('receivable','payable') then
    raise exception 'Somente dívidas podem receber quitações.';
  end if;
  if (
    select coalesce(sum(s.amount), 0) from public.settlements s
    where s.transaction_id = new.transaction_id and s.id <> new.id
  ) + new.amount > (
    select t.installment_amount from public.transactions t where t.id = new.transaction_id
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
create trigger trg_validate_settlement_ownership before insert or update on public.settlements
for each row execute function public.validate_settlement_ownership();

create or replace function public.validate_budget_ownership()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (
    select 1 from public.categories c where c.id = new.category_id and c.user_id = new.user_id
  ) then raise exception 'A categoria do orçamento não pertence ao usuário.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_budget_ownership on public.budgets;
create trigger trg_validate_budget_ownership before insert or update on public.budgets
for each row execute function public.validate_budget_ownership();

create or replace function public.update_transaction_series(
  p_series_id uuid, p_description text, p_category_id uuid,
  p_payment_method text, p_card_id uuid, p_person_id uuid,
  p_responsibility text, p_amount_total numeric, p_purchase_date date,
  p_first_invoice_month date, p_due_day integer, p_notes text
)
returns integer language plpgsql security invoker set search_path = public as $$
declare changed_rows integer;
begin
  update public.transactions t
  set description = p_description, category_id = p_category_id,
      payment_method = p_payment_method, card_id = p_card_id,
      person_id = p_person_id, responsibility = p_responsibility,
      amount_total = p_amount_total,
      installment_amount = case when t.kind = 'income' then p_amount_total else
        floor((p_amount_total * 100) / t.installments_total) / 100
        + case when t.installment_number <= mod(round(p_amount_total * 100)::integer, t.installments_total) then 0.01 else 0 end end,
      purchase_date = case when t.kind = 'income' and t.installment_number > 1 then
        (date_trunc('month', p_first_invoice_month) + ((t.installment_number - 1) || ' months')::interval)::date
        else p_purchase_date end,
      invoice_month = (date_trunc('month', p_first_invoice_month) + ((t.installment_number - 1) || ' months')::interval)::date,
      due_date = case when p_due_day is null then null else make_date(
        extract(year from (date_trunc('month', p_first_invoice_month) + ((t.installment_number - 1) || ' months')::interval))::integer,
        extract(month from (date_trunc('month', p_first_invoice_month) + ((t.installment_number - 1) || ' months')::interval))::integer,
        least(p_due_day, extract(day from (date_trunc('month', p_first_invoice_month) + (t.installment_number || ' months')::interval - interval '1 day'))::integer)
      ) end,
      notes = p_notes
  where t.user_id = auth.uid() and t.series_id = p_series_id;
  get diagnostics changed_rows = row_count;
  return changed_rows;
end;
$$;

create or replace function public.update_transaction_series_v4(
 p_series_id uuid,p_description text,p_category_id uuid,p_payment_method text,p_card_id uuid,p_person_id uuid,
 p_responsibility text,p_amount_total numeric,p_purchase_date date,p_first_invoice_month date,p_due_day integer,p_notes text,p_account_id uuid
) returns integer language plpgsql security invoker set search_path=public as $$
declare changed_rows integer; begin
 changed_rows:=public.update_transaction_series(p_series_id,p_description,p_category_id,p_payment_method,p_card_id,p_person_id,p_responsibility,p_amount_total,p_purchase_date,p_first_invoice_month,p_due_day,p_notes);
 update public.transactions set account_id=p_account_id where user_id=auth.uid() and series_id=p_series_id; return changed_rows;
end $$;

-- Correção v5: cada tabela usa uma função compatível com o formato do próprio NEW.
drop trigger if exists trg_validate_transaction_account on public.transactions;
drop trigger if exists trg_validate_settlement_account on public.settlements;
drop trigger if exists trg_validate_transfer_accounts on public.transfers;
drop trigger if exists trg_validate_invoice_payment on public.card_invoice_payments;
create or replace function public.validate_transaction_account_v5() returns trigger language plpgsql security invoker set search_path=public as $$ begin if new.account_id is not null and not exists(select 1 from public.accounts where id=new.account_id and user_id=new.user_id) then raise exception 'A conta selecionada não pertence ao usuário.'; end if; return new; end $$;
create or replace function public.validate_settlement_account_v5() returns trigger language plpgsql security invoker set search_path=public as $$ begin if new.account_id is not null and not exists(select 1 from public.accounts where id=new.account_id and user_id=new.user_id) then raise exception 'A conta da quitação não pertence ao usuário.'; end if; return new; end $$;
create or replace function public.validate_transfer_accounts_v5() returns trigger language plpgsql security invoker set search_path=public as $$ begin if not exists(select 1 from public.accounts where id=new.from_account_id and user_id=new.user_id) or not exists(select 1 from public.accounts where id=new.to_account_id and user_id=new.user_id) then raise exception 'As contas da transferência devem pertencer ao usuário.'; end if; return new; end $$;
create or replace function public.validate_invoice_payment_v5() returns trigger language plpgsql security invoker set search_path=public as $$ begin if not exists(select 1 from public.cards where id=new.card_id and user_id=new.user_id) or (new.account_id is not null and not exists(select 1 from public.accounts where id=new.account_id and user_id=new.user_id)) then raise exception 'O cartão e a conta do pagamento devem pertencer ao usuário.'; end if; if (select coalesce(sum(amount),0) from public.card_invoice_payments where card_id=new.card_id and invoice_month=new.invoice_month and id is distinct from new.id)+new.amount>(select coalesce(sum(installment_amount),0) from public.transactions where user_id=new.user_id and card_id=new.card_id and invoice_month=new.invoice_month and kind='expense') then raise exception 'O pagamento não pode ultrapassar o total da fatura.'; end if; return new; end $$;
create trigger trg_validate_transaction_account before insert or update on public.transactions for each row execute function public.validate_transaction_account_v5();
create trigger trg_validate_settlement_account before insert or update on public.settlements for each row execute function public.validate_settlement_account_v5();
create trigger trg_validate_transfer_accounts before insert or update on public.transfers for each row execute function public.validate_transfer_accounts_v5();
create trigger trg_validate_invoice_payment before insert or update on public.card_invoice_payments for each row execute function public.validate_invoice_payment_v5();
drop function if exists public.validate_v4_ownership();
