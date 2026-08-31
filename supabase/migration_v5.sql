-- Meu Controle Financeiro — Migração v5
-- Corrige os gatilhos da v4 que compartilhavam NEW entre tabelas incompatíveis.

begin;

drop trigger if exists trg_validate_transaction_account on public.transactions;
drop trigger if exists trg_validate_settlement_account on public.settlements;
drop trigger if exists trg_validate_transfer_accounts on public.transfers;
drop trigger if exists trg_validate_invoice_payment on public.card_invoice_payments;

create or replace function public.validate_transaction_account_v5()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.accounts where id = new.account_id and user_id = new.user_id
  ) then raise exception 'A conta selecionada não pertence ao usuário.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_settlement_account_v5()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.accounts where id = new.account_id and user_id = new.user_id
  ) then raise exception 'A conta da quitação não pertence ao usuário.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_transfer_accounts_v5()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.accounts where id = new.from_account_id and user_id = new.user_id)
    or not exists (select 1 from public.accounts where id = new.to_account_id and user_id = new.user_id)
  then raise exception 'As contas da transferência devem pertencer ao usuário.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_invoice_payment_v5()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.cards where id = new.card_id and user_id = new.user_id)
    or (new.account_id is not null and not exists (
      select 1 from public.accounts where id = new.account_id and user_id = new.user_id
    ))
  then raise exception 'O cartão e a conta do pagamento devem pertencer ao usuário.';
  end if;
  if (select coalesce(sum(amount),0) from public.card_invoice_payments
      where card_id = new.card_id and invoice_month = new.invoice_month and id is distinct from new.id)
      + new.amount > (select coalesce(sum(installment_amount),0) from public.transactions
      where user_id = new.user_id and card_id = new.card_id and invoice_month = new.invoice_month and kind = 'expense')
  then raise exception 'O pagamento não pode ultrapassar o total da fatura.';
  end if;
  return new;
end;
$$;

create trigger trg_validate_transaction_account before insert or update on public.transactions
for each row execute function public.validate_transaction_account_v5();
create trigger trg_validate_settlement_account before insert or update on public.settlements
for each row execute function public.validate_settlement_account_v5();
create trigger trg_validate_transfer_accounts before insert or update on public.transfers
for each row execute function public.validate_transfer_accounts_v5();
create trigger trg_validate_invoice_payment before insert or update on public.card_invoice_payments
for each row execute function public.validate_invoice_payment_v5();

drop function if exists public.validate_v4_ownership();

commit;
