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
  amount_total numeric(12,2) not null check(amount_total > 0),
  installment_number int not null default 1 check(installment_number >= 1),
  installments_total int not null default 1 check(installments_total >= 1),
  installment_amount numeric(12,2) not null check(installment_amount > 0),
  purchase_date date not null,
  invoice_month date not null,
  reimbursement_status text check(reimbursement_status in ('pending','paid') or reimbursement_status is null),
  amount_received numeric(12,2) not null default 0 check(amount_received >= 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_invoice on public.transactions(user_id, invoice_month);
create index if not exists idx_transactions_user_person on public.transactions(user_id, person_id);

alter table public.people enable row level security;
alter table public.cards enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "people_own" on public.people;
create policy "people_own" on public.people for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cards_own" on public.cards;
create policy "cards_own" on public.cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "categories_own" on public.categories;
create policy "categories_own" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "transactions_own" on public.transactions;
create policy "transactions_own" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
