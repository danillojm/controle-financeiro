-- Meu Controle Financeiro — Migração v6
-- Adiciona séries mensais de valor fixo e atualização consistente da série.

begin;

alter table public.transactions
  add column if not exists recurrence_type text not null default 'installment';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_recurrence_type_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions add constraint transactions_recurrence_type_check
      check (recurrence_type in ('installment','monthly'));
  end if;
end $$;

update public.transactions
set recurrence_type = 'monthly'
where kind = 'income' and installments_total > 1 and recurrence_type = 'installment';

create or replace function public.update_transaction_series_v6(
  p_series_id uuid, p_description text, p_category_id uuid,
  p_payment_method text, p_card_id uuid, p_person_id uuid,
  p_responsibility text, p_amount_total numeric, p_purchase_date date,
  p_first_invoice_month date, p_due_day integer, p_notes text,
  p_account_id uuid, p_recurrence_type text
)
returns integer language plpgsql security invoker set search_path = public as $$
declare changed_rows integer;
begin
  if p_recurrence_type not in ('installment','monthly') then
    raise exception 'Tipo de recorrência inválido.';
  end if;

  changed_rows := public.update_transaction_series_v4(
    p_series_id, p_description, p_category_id, p_payment_method,
    p_card_id, p_person_id, p_responsibility, p_amount_total,
    p_purchase_date, p_first_invoice_month, p_due_day, p_notes,
    p_account_id
  );

  update public.transactions
  set recurrence_type = p_recurrence_type,
      amount_total = p_amount_total,
      installment_amount = case
        when p_recurrence_type = 'monthly' then p_amount_total
        else installment_amount
      end,
      purchase_date = case
        when p_recurrence_type = 'monthly' and installment_number > 1 then invoice_month
        else p_purchase_date
      end
  where user_id = auth.uid() and series_id = p_series_id;

  return changed_rows;
end;
$$;

commit;
