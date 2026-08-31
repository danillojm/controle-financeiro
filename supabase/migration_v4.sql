-- Meu Controle Financeiro — Migração v4
-- Execute após migration_v3.sql em projetos existentes.

begin;

alter table public.people add column if not exists archived_at timestamptz;
alter table public.cards add column if not exists archived_at timestamptz;
alter table public.categories
  add column if not exists archived_at timestamptz,
  add column if not exists color text not null default '#0f766e',
  add column if not exists icon text not null default '●',
  add column if not exists kind text not null default 'both';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_kind_check' and conrelid = 'public.categories'::regclass) then
    alter table public.categories add constraint categories_kind_check check (kind in ('expense','income','both'));
  end if;
end $$;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'checking' check (type in ('checking','savings','cash','investment')),
  initial_balance numeric(12,2) not null default 0,
  color text not null default '#0f766e',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,name)
);

alter table public.transactions
  add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.settlements
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_account_id uuid not null references public.accounts(id) on delete restrict,
  to_account_id uuid not null references public.accounts(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  transfer_date date not null,
  description text,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

create table if not exists public.card_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  invoice_month date not null,
  account_id uuid references public.accounts(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  days_before integer not null default 7 check (days_before between 0 and 30),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  message text not null,
  context text,
  details jsonb,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_account on public.transactions(user_id,account_id);
create index if not exists idx_settlements_user_account on public.settlements(user_id,account_id);
create index if not exists idx_transfers_user_date on public.transfers(user_id,transfer_date);
create index if not exists idx_invoice_payments_user_month on public.card_invoice_payments(user_id,invoice_month);
create index if not exists idx_app_errors_user_created on public.app_errors(user_id,created_at desc);

alter table public.accounts enable row level security;
alter table public.transfers enable row level security;
alter table public.card_invoice_payments enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.app_errors enable row level security;

drop policy if exists "accounts_own" on public.accounts;
create policy "accounts_own" on public.accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "transfers_own" on public.transfers;
create policy "transfers_own" on public.transfers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "invoice_payments_own" on public.card_invoice_payments;
create policy "invoice_payments_own" on public.card_invoice_payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notification_preferences_own" on public.notification_preferences;
create policy "notification_preferences_own" on public.notification_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "app_errors_insert_own" on public.app_errors;
create policy "app_errors_insert_own" on public.app_errors for insert with check (auth.uid() = user_id);
drop policy if exists "app_errors_select_own" on public.app_errors;
create policy "app_errors_select_own" on public.app_errors for select using (auth.uid() = user_id);
drop policy if exists "app_errors_delete_own" on public.app_errors;
create policy "app_errors_delete_own" on public.app_errors for delete using (auth.uid() = user_id);

create or replace function public.validate_v4_ownership()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_table_name = 'transactions' and new.account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id
  ) then raise exception 'A conta selecionada não pertence ao usuário.';
  end if;
  if tg_table_name = 'settlements' and new.account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id
  ) then raise exception 'A conta da quitação não pertence ao usuário.';
  end if;
  if tg_table_name = 'transfers' and (
    not exists (select 1 from public.accounts a where a.id = new.from_account_id and a.user_id = new.user_id)
    or not exists (select 1 from public.accounts a where a.id = new.to_account_id and a.user_id = new.user_id)
  ) then raise exception 'As contas da transferência devem pertencer ao usuário.';
  end if;
  if tg_table_name = 'card_invoice_payments' and (
    not exists (select 1 from public.cards c where c.id = new.card_id and c.user_id = new.user_id)
    or (new.account_id is not null and not exists (select 1 from public.accounts a where a.id = new.account_id and a.user_id = new.user_id))
  ) then raise exception 'O cartão e a conta do pagamento devem pertencer ao usuário.';
  end if;
  if tg_table_name = 'card_invoice_payments' and (
    select coalesce(sum(p.amount),0) from public.card_invoice_payments p
    where p.card_id=new.card_id and p.invoice_month=new.invoice_month and p.id<>new.id
  ) + new.amount > (
    select coalesce(sum(t.installment_amount),0) from public.transactions t
    where t.user_id=new.user_id and t.card_id=new.card_id and t.invoice_month=new.invoice_month and t.kind='expense'
  ) then raise exception 'O pagamento não pode ultrapassar o total da fatura.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_transaction_account on public.transactions;
create trigger trg_validate_transaction_account before insert or update on public.transactions for each row execute function public.validate_v4_ownership();
drop trigger if exists trg_validate_settlement_account on public.settlements;
create trigger trg_validate_settlement_account before insert or update on public.settlements for each row execute function public.validate_v4_ownership();
drop trigger if exists trg_validate_transfer_accounts on public.transfers;
create trigger trg_validate_transfer_accounts before insert or update on public.transfers for each row execute function public.validate_v4_ownership();
drop trigger if exists trg_validate_invoice_payment on public.card_invoice_payments;
create trigger trg_validate_invoice_payment before insert or update on public.card_invoice_payments for each row execute function public.validate_v4_ownership();

create or replace function public.get_dashboard_summary(p_month date)
returns table(income numeric, expenses numeric, receivable numeric, payable numeric)
language sql security invoker set search_path = public as $$
  select
    coalesce(sum(t.installment_amount) filter (where t.kind = 'income'),0),
    coalesce(sum(t.installment_amount) filter (where t.kind = 'expense' and t.responsibility in ('own','payable')),0),
    coalesce(sum(greatest(t.installment_amount - coalesce(s.settled,0),0)) filter (where t.responsibility = 'receivable'),0),
    coalesce(sum(greatest(t.installment_amount - coalesce(s.settled,0),0)) filter (where t.responsibility = 'payable'),0)
  from public.transactions t
  left join (select transaction_id,sum(amount) settled from public.settlements group by transaction_id) s on s.transaction_id = t.id
  where t.user_id = auth.uid() and t.invoice_month = date_trunc('month',p_month)::date;
$$;

create or replace function public.update_transaction_series_v4(
  p_series_id uuid, p_description text, p_category_id uuid,
  p_payment_method text, p_card_id uuid, p_person_id uuid,
  p_responsibility text, p_amount_total numeric, p_purchase_date date,
  p_first_invoice_month date, p_due_day integer, p_notes text,
  p_account_id uuid
)
returns integer language plpgsql security invoker set search_path = public as $$
declare changed_rows integer;
begin
  changed_rows := public.update_transaction_series(
    p_series_id, p_description, p_category_id, p_payment_method,
    p_card_id, p_person_id, p_responsibility, p_amount_total,
    p_purchase_date, p_first_invoice_month, p_due_day, p_notes
  );
  update public.transactions set account_id = p_account_id
  where user_id = auth.uid() and series_id = p_series_id;
  return changed_rows;
end;
$$;

commit;
