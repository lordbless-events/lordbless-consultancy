-- Review proposal only. Do not apply until production permissions and schema
-- are confirmed. Uses existing client_assessment_payments for verified client
-- income; this table stores only additional organisational income and expenses.
begin;

do $$
begin
    if to_regclass('public.staff_profiles') is null
       or to_regclass('public.client_assessment_payments') is null
       or to_regprocedure('private.has_permission(text)') is null then
        raise exception 'Apply the existing identity and assessment-payment migrations first.';
    end if;
end;
$$;

create table if not exists public.finance_adjustments (
    id uuid primary key default gen_random_uuid(),
    entry_type text not null check (entry_type in ('income', 'expense')),
    entry_date date not null,
    category text not null,
    description text not null check (length(btrim(description)) between 1 and 240),
    amount numeric(12,2) not null check (amount > 0),
    additional_amount numeric(12,2) not null default 0 check (additional_amount >= 0),
    currency text not null check (currency in ('EUR', 'USD', 'GHS')),
    payment_method text,
    payment_reference text,
    remarks text,
    staff_name text,
    payment_period text,
    created_by uuid not null default auth.uid() references public.staff_profiles(user_id) on delete restrict,
    updated_by uuid not null default auth.uid() references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint finance_adjustments_staff_fields_check check (
        (category in ('staff_remuneration', 'staff_allowances') and entry_type = 'expense'
            and nullif(btrim(staff_name), '') is not null
            and nullif(btrim(payment_period), '') is not null)
        or category not in ('staff_remuneration', 'staff_allowances')
    ),
    constraint finance_adjustments_income_category_check check (
        entry_type <> 'income' or category in (
            'other_organisational_income', 'investment_income', 'refund_recovery', 'other_income'
        )
    ),
    constraint finance_adjustments_expense_category_check check (
        entry_type <> 'expense' or category in (
            'internet_wifi', 'ai_subscriptions', 'software_subscriptions', 'electricity',
            'office_expenses', 'staff_remuneration', 'staff_allowances',
            'marketing_advertising', 'transport_logistics', 'professional_services',
            'equipment_maintenance', 'other_expenses'
        )
    )
);

create table if not exists public.finance_adjustment_history (
    id bigint generated always as identity primary key,
    adjustment_id uuid not null references public.finance_adjustments(id) on delete restrict,
    action text not null check (action in ('created', 'updated')),
    before_record jsonb,
    after_record jsonb not null,
    changed_by uuid references public.staff_profiles(user_id) on delete set null,
    changed_at timestamptz not null default now()
);

create index if not exists finance_adjustments_date_currency_idx
    on public.finance_adjustments(entry_date desc, currency, entry_type);
create index if not exists finance_adjustment_history_record_changed_idx
    on public.finance_adjustment_history(adjustment_id, changed_at desc);

alter table public.finance_adjustments enable row level security;
alter table public.finance_adjustment_history enable row level security;

revoke all on public.finance_adjustments, public.finance_adjustment_history from public, anon;
grant select, insert, update on public.finance_adjustments to authenticated;
grant select on public.finance_adjustment_history to authenticated;

drop policy if exists finance_adjustments_read_authorized on public.finance_adjustments;
create policy finance_adjustments_read_authorized
on public.finance_adjustments for select to authenticated
using (private.has_permission('finance.read'));

drop policy if exists finance_adjustments_create_authorized on public.finance_adjustments;
create policy finance_adjustments_create_authorized
on public.finance_adjustments for insert to authenticated
with check (
    private.has_permission('finance.requests')
    and created_by = auth.uid()
    and updated_by = auth.uid()
);

drop policy if exists finance_adjustments_update_authorized on public.finance_adjustments;
create policy finance_adjustments_update_authorized
on public.finance_adjustments for update to authenticated
using (private.has_permission('finance.requests'))
with check (
    private.has_permission('finance.requests')
    and updated_by = auth.uid()
);

drop policy if exists finance_adjustment_history_read_authorized on public.finance_adjustment_history;
create policy finance_adjustment_history_read_authorized
on public.finance_adjustment_history for select to authenticated
using (private.has_permission('finance.read'));

create or replace function private.prepare_finance_adjustment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
    if tg_op = 'UPDATE' then
        new.created_by := old.created_by;
        new.created_at := old.created_at;
        new.updated_by := auth.uid();
        new.updated_at := now();
        return new;
    end if;

    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    return new;
end;
$$;

create or replace function private.record_finance_adjustment_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
    if tg_op = 'UPDATE' then
        insert into public.finance_adjustment_history (
            adjustment_id, action, before_record, after_record, changed_by
        ) values (new.id, 'updated', to_jsonb(old), to_jsonb(new), auth.uid());
    else
        insert into public.finance_adjustment_history (
            adjustment_id, action, after_record, changed_by
        ) values (new.id, 'created', to_jsonb(new), auth.uid());
    end if;
    return new;
end;
$$;

revoke all on function private.prepare_finance_adjustment() from public, anon, authenticated;
revoke all on function private.record_finance_adjustment_history() from public, anon, authenticated;
drop trigger if exists finance_adjustments_prepare on public.finance_adjustments;
create trigger finance_adjustments_prepare
before insert or update on public.finance_adjustments
for each row execute function private.prepare_finance_adjustment();
drop trigger if exists finance_adjustments_audit on public.finance_adjustments;
create trigger finance_adjustments_audit
after insert or update on public.finance_adjustments
for each row execute function private.record_finance_adjustment_history();

-- Deliberately grant no DELETE privilege or policy. Financial corrections are
-- made by editing a saved row and are retained in finance_adjustment_history.
commit;
