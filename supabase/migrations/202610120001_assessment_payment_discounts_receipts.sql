begin;

alter table public.client_assessment_payments
    add column if not exists standard_amount numeric(12,2) not null default 1000,
    add column if not exists discount_amount numeric(12,2) not null default 0,
    add column if not exists receipt_number text,
    add column if not exists receipt_issued_at timestamptz,
    add column if not exists verified_by_name text,
    add column if not exists client_code text,
    add column if not exists discount_authorized_by uuid references public.staff_profiles(user_id),
    add column if not exists discount_authorized_at timestamptz;

alter table public.client_assessment_payments
    drop constraint if exists client_assessment_payments_amount_check;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.client_assessment_payments'::regclass
          and conname = 'client_assessment_amount_discount_check'
    ) then
        alter table public.client_assessment_payments
            add constraint client_assessment_amount_discount_check
            check (
                standard_amount = 1000
                and discount_amount >= 0
                and discount_amount < standard_amount
                and amount = standard_amount - discount_amount
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.client_assessment_payments'::regclass
          and conname = 'client_assessment_receipt_verification_check'
    ) then
        alter table public.client_assessment_payments
            add constraint client_assessment_receipt_verification_check
            check (
                (receipt_number is null and receipt_issued_at is null)
                or (
                    receipt_number is not null
                    and receipt_issued_at is not null
                    and status = 'paid'
                    and verification_status = 'verified'
                )
            );
    end if;
end;
$$;

create unique index if not exists client_assessment_payments_receipt_number_uidx
    on public.client_assessment_payments (receipt_number)
    where receipt_number is not null;

update public.client_assessment_payments p
set payment_instructions = concat_ws(E'\n',
        'Initial Assessment & Consultation',
        'Amount payable: GHS ' || to_char(p.amount, 'FM999,999,990.00'),
        'How to pay',
        '- Method: Mobile Money',
        '- Number: 0549617222',
        '- Account name: Aboagye Richard Atta',
        'After payment: Send your payment confirmation screenshot to LORDBLESS CONSULTANCY via WhatsApp and provide payment reference ' || p.reference || '.',
        'Finance must verify payment before your consultation can be scheduled.'
    ),
    updated_at = now()
where nullif(trim(coalesce(p.payment_instructions, '')), '') is null;

update public.client_assessment_payments p
set client_code = to_jsonb(c)->>'client_code'
from public.clients c
where c.id = p.client_id
  and p.client_code is null;

create or replace function public.request_initial_assessment_payment(
    p_client_id uuid,
    p_discount_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    client_record public.clients%rowtype;
    payment_record public.client_assessment_payments%rowtype;
    requested_discount numeric(12,2);
    created_request boolean := false;
begin
    if auth.uid() is null or not private.has_permission('finance.requests') then
        raise exception 'Finance payment-request permission is required.' using errcode = '42501';
    end if;

    if p_discount_amount is null or p_discount_amount <> round(p_discount_amount, 2) then
        raise exception 'Enter a discount in GHS with no more than two decimal places.' using errcode = '22023';
    end if;

    requested_discount := p_discount_amount;
    if requested_discount < 0 or requested_discount >= 1000 then
        raise exception 'The discount must be at least GHS 0 and less than GHS 1,000.' using errcode = '22023';
    end if;

    select * into client_record
    from public.clients c
    where c.id = p_client_id;

    if not found then
        raise exception 'The selected client record was not found.' using errcode = 'P0002';
    end if;

    select * into payment_record
    from public.client_assessment_payments p
    where p.client_id = p_client_id
    for update;

    if not found then
        insert into public.client_assessment_payments (
            client_id, client_name, client_code, standard_amount, discount_amount,
            discount_authorized_by, discount_authorized_at, amount, currency, created_by
        ) values (
            p_client_id,
            coalesce(nullif(client_record.full_name, ''), 'Client'),
            to_jsonb(client_record)->>'client_code',
            1000,
            requested_discount,
            case when requested_discount > 0 then auth.uid() else null end,
            case when requested_discount > 0 then now() else null end,
            1000 - requested_discount,
            'GHS',
            auth.uid()
        )
        on conflict (client_id) do nothing
        returning * into payment_record;

        created_request := found;
        if not created_request then
            select * into payment_record
            from public.client_assessment_payments p
            where p.client_id = p_client_id
            for update;
        end if;
    end if;

    if payment_record.client_code is null then
        update public.client_assessment_payments p
        set client_code = to_jsonb(client_record)->>'client_code'
        where p.id = payment_record.id
        returning * into payment_record;
    end if;

    if nullif(trim(coalesce(payment_record.payment_instructions, '')), '') is null then
        update public.client_assessment_payments p
        set payment_instructions = concat_ws(E'\n',
                'Initial Assessment & Consultation',
                'Amount payable: GHS ' || to_char(payment_record.amount, 'FM999,999,990.00'),
                'How to pay',
                '- Method: Mobile Money',
                '- Number: 0549617222',
                '- Account name: Aboagye Richard Atta',
                'After payment: Send your payment confirmation screenshot to LORDBLESS CONSULTANCY via WhatsApp and provide payment reference ' || payment_record.reference || '.',
                'Finance must verify payment before your consultation can be scheduled.'
            ),
            updated_at = now()
        where p.id = payment_record.id
        returning * into payment_record;
    end if;

    return jsonb_build_object(
        'created', created_request,
        'payment', to_jsonb(payment_record)
    );
end;
$$;

create or replace function public.request_initial_assessment_payment(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, auth, private
as $$
    select public.request_initial_assessment_payment(p_client_id, 0::numeric);
$$;

create or replace function public.update_initial_assessment_payment_discount(
    p_payment_id uuid,
    p_discount_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    payment_record public.client_assessment_payments%rowtype;
    requested_discount numeric(12,2);
begin
    if auth.uid() is null or not private.has_permission('finance.requests') then
        raise exception 'Finance payment-request permission is required.' using errcode = '42501';
    end if;

    if p_discount_amount is null or p_discount_amount <> round(p_discount_amount, 2) then
        raise exception 'Enter a discount in GHS with no more than two decimal places.' using errcode = '22023';
    end if;

    requested_discount := p_discount_amount;
    if requested_discount < 0 or requested_discount >= 1000 then
        raise exception 'The discount must be at least GHS 0 and less than GHS 1,000.' using errcode = '22023';
    end if;

    select * into payment_record
    from public.client_assessment_payments p
    where p.id = p_payment_id
    for update;

    if not found then
        raise exception 'The assessment payment request was not found.' using errcode = 'P0002';
    end if;

    if payment_record.status <> 'requested'
       or payment_record.verification_status in ('pending', 'verified')
       or payment_record.client_payment_submitted_at is not null then
        raise exception 'The assessment request can only be changed before payment is submitted or verified.' using errcode = '22023';
    end if;

    if payment_record.discount_amount = requested_discount then
        return jsonb_build_object('updated', false, 'payment', to_jsonb(payment_record));
    end if;

    update public.client_assessment_payments p
    set standard_amount = 1000,
        discount_amount = requested_discount,
        amount = 1000 - requested_discount,
        discount_authorized_by = auth.uid(),
        discount_authorized_at = now(),
        updated_at = now()
    where p.id = p_payment_id
    returning * into payment_record;

    return jsonb_build_object('updated', true, 'payment', to_jsonb(payment_record));
end;
$$;

create or replace function public.verify_initial_assessment_payment(
    p_payment_id uuid,
    p_amount_received numeric,
    p_payment_date date,
    p_transaction_reference text,
    p_finance_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    payment_record public.client_assessment_payments%rowtype;
    verifier_name text;
begin
    if auth.uid() is null or not private.has_permission('finance.verify') then
        raise exception 'Finance verification permission is required.' using errcode = '42501';
    end if;

    select * into payment_record
    from public.client_assessment_payments p
    where p.id = p_payment_id
    for update;

    if not found then
        raise exception 'The assessment payment request was not found.' using errcode = 'P0002';
    end if;

    if payment_record.status = 'paid' and payment_record.verification_status = 'verified' then
        return jsonb_build_object('payment', to_jsonb(payment_record), 'already_verified', true);
    end if;

    if payment_record.status not in ('requested', 'awaiting_verification') then
        raise exception 'This assessment request is not eligible for verification.' using errcode = '22023';
    end if;

    if p_amount_received is null or p_amount_received <> payment_record.amount then
        raise exception 'The amount received must exactly match the final amount payable: GHS %.',
            to_char(payment_record.amount, 'FM999,999,990.00') using errcode = '22023';
    end if;

    if p_payment_date is null or p_payment_date > current_date
        or nullif(trim(coalesce(p_transaction_reference, '')), '') is null
        or length(trim(p_transaction_reference)) > 160 then
        raise exception 'Enter a valid payment date and verified transaction reference.' using errcode = '22023';
    end if;

    select nullif(trim(sp.display_name), '') into verifier_name
    from public.staff_profiles sp
    where sp.user_id = auth.uid();

    update public.client_assessment_payments p
    set status = 'paid',
        verification_status = 'verified',
        verified_by = auth.uid(),
        verified_by_name = coalesce(verifier_name, 'Finance'),
        verified_at = now(),
        amount_received = p_amount_received,
        payment_date = p_payment_date,
        transaction_reference = trim(p_transaction_reference),
        finance_note = nullif(trim(coalesce(p_finance_note, '')), ''),
        receipt_number = 'LBC-RCP-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        receipt_issued_at = now(),
        updated_at = now()
    where p.id = p_payment_id
    returning * into payment_record;

    update public.client_accounts ca
    set access_status = 'active',
        activated_at = coalesce(ca.activated_at, now()),
        updated_at = now()
    where ca.client_id = payment_record.client_id
      and ca.access_status = 'activation_required';

    return jsonb_build_object(
        'payment', to_jsonb(payment_record),
        'already_verified', false,
        'receipt_issued', true
    );
end;
$$;

create or replace function private.activate_verified_assessment_after_password_setup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if new.access_status = 'activation_required'
       and old.access_status = 'invited'
       and exists (
            select 1
            from public.client_assessment_payments p
            where p.client_id = new.client_id
              and p.status = 'paid'
              and p.verification_status = 'verified'
       ) then
        new.access_status := 'active';
        new.activated_at := coalesce(new.activated_at, now());
        new.updated_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists client_accounts_activate_verified_assessment on public.client_accounts;
create trigger client_accounts_activate_verified_assessment
before update of access_status on public.client_accounts
for each row
execute function private.activate_verified_assessment_after_password_setup();

revoke all on function private.activate_verified_assessment_after_password_setup() from public, anon, authenticated;

create or replace view public.client_assessment_payment_status
with (security_barrier = true)
as
select
    p.id, p.client_id, p.reference, p.purpose, p.amount, p.currency,
    p.status, p.verification_status, p.payment_instructions, p.created_at,
    p.updated_at, p.client_payment_submitted_at, p.client_payment_date,
    p.client_payment_reference, p.verified_at, p.amount_received,
    p.payment_date, p.transaction_reference,
    p.standard_amount, p.discount_amount, p.receipt_number, p.receipt_issued_at,
    p.verified_by, p.verified_by_name, p.client_code
from public.client_assessment_payments p
where p.client_id = private.current_client_id()
   or p.client_id = private.current_limited_client_id();

revoke all on function public.request_initial_assessment_payment(uuid, numeric) from public, anon;
grant execute on function public.request_initial_assessment_payment(uuid, numeric) to authenticated;
revoke all on function public.request_initial_assessment_payment(uuid) from public, anon;
grant execute on function public.request_initial_assessment_payment(uuid) to authenticated;
revoke all on function public.update_initial_assessment_payment_discount(uuid, numeric) from public, anon;
grant execute on function public.update_initial_assessment_payment_discount(uuid, numeric) to authenticated;
revoke all on function public.verify_initial_assessment_payment(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.verify_initial_assessment_payment(uuid, numeric, date, text, text) to authenticated;
revoke all on function public.submit_initial_assessment_payment(uuid, date, text) from public, anon, authenticated;
revoke all on public.client_assessment_payment_status from public, anon;
grant select on public.client_assessment_payment_status to authenticated;

commit;
