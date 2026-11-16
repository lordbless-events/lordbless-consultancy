-- REVIEW ONLY. Central persistence for ordinary service payment requests,
-- client payment submissions, verification history and official receipts.
-- Does not alter assessment-payment or AUTOS tables. Do not apply without
-- reviewing production constraints and the existing finance permission set.
begin;

do $$
begin
    if to_regclass('public.clients') is null
       or to_regclass('public.client_journeys') is null
       or to_regprocedure('private.has_finance_permission(text)') is null
       or to_regprocedure('private.can_access_client(uuid)') is null
       or to_regprocedure('private.current_client_id()') is null then
        raise exception 'Required client, journey and finance authorization structures are missing.';
    end if;
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
              'client_service_payment_requests',
              'client_service_payment_submissions',
              'client_service_payment_history',
              'client_service_payment_receipts'
          )
    ) then
        raise exception 'One or more service-payment tables already exist; inspect them before applying.';
    end if;
end;
$$;

create table public.client_service_payment_requests (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    journey_id uuid references public.client_journeys(id) on delete set null,
    request_key uuid not null,
    reference text not null unique,
    request_type text not null default 'Service Fee',
    purpose text,
    title text not null,
    description text not null default '',
    service text not null default '',
    transaction_title text not null default '',
    destination text not null default '',
    transaction_id text,
    subtotal numeric(14,2) not null,
    discount numeric(14,2) not null default 0,
    tax numeric(14,2) not null default 0,
    amount numeric(14,2) not null,
    currency text not null check (currency in ('EUR','USD','GHS')),
    due_date date,
    payment_instructions text not null default '',
    admin_note text not null default '',
    status text not null default 'requested'
        check (status in ('requested','partially_paid','payment_submitted','under_review','rejected','paid','cancelled')),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (created_by, request_key),
    check (amount > 0 and subtotal > 0 and discount >= 0 and tax >= 0),
    check (length(btrim(title)) between 1 and 240),
    check (length(description) <= 4000 and length(payment_instructions) <= 4000 and length(admin_note) <= 4000)
);

create index client_service_payment_requests_client_created_idx
    on public.client_service_payment_requests(client_id, created_at desc);
create index client_service_payment_requests_status_created_idx
    on public.client_service_payment_requests(status, created_at desc);
create index client_service_payment_requests_journey_idx
    on public.client_service_payment_requests(journey_id)
    where journey_id is not null;

create table public.client_service_payment_submissions (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.client_service_payment_requests(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    submission_key uuid not null,
    amount_submitted numeric(14,2) not null check (amount_submitted > 0),
    amount_received numeric(14,2),
    currency text not null check (currency in ('EUR','USD','GHS')),
    payment_method text not null check (payment_method in ('Bank Transfer','Mobile Money','Card','Cash','Other')),
    transaction_reference text not null,
    payment_date date not null,
    status text not null default 'submitted'
        check (status in ('submitted','verified','rejected')),
    submitted_at timestamptz not null default now(),
    verified_by uuid references auth.users(id) on delete set null,
    verified_by_name text not null default '',
    verified_at timestamptz,
    verification_note text not null default '',
    rejection_reason text not null default '',
    unique (client_id, submission_key),
    check (amount_received is null or amount_received > 0),
    check (length(btrim(transaction_reference)) between 1 and 200),
    check (length(verification_note) <= 4000 and length(rejection_reason) <= 4000)
);

-- A rejected payment remains in history but may be resubmitted with its
-- original genuine transfer reference. Active and verified references remain
-- unique per client to prevent duplicate submissions.
create unique index client_service_payment_submission_reference_uidx
    on public.client_service_payment_submissions(client_id, lower(transaction_reference))
    where status <> 'rejected';
create index client_service_payment_submissions_request_idx
    on public.client_service_payment_submissions(request_id, submitted_at desc);
create index client_service_payment_submissions_review_idx
    on public.client_service_payment_submissions(status, submitted_at desc);

create table public.client_service_payment_receipts (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null unique references public.client_service_payment_submissions(id) on delete restrict,
    request_id uuid not null references public.client_service_payment_requests(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    receipt_number text not null unique,
    amount_paid numeric(14,2) not null check (amount_paid > 0),
    currency text not null check (currency in ('EUR','USD','GHS')),
    payment_method text not null,
    payment_reference text not null,
    payment_date date not null,
    issued_by uuid references auth.users(id) on delete set null,
    issued_by_name text not null default '',
    issued_at timestamptz not null default now(),
    notes text not null default ''
);
create index client_service_payment_receipts_client_issued_idx
    on public.client_service_payment_receipts(client_id, issued_at desc);

create table public.client_service_payment_history (
    id bigint generated always as identity primary key,
    request_id uuid references public.client_service_payment_requests(id) on delete restrict,
    payment_id uuid references public.client_service_payment_submissions(id) on delete restrict,
    actor_id uuid references auth.users(id) on delete set null,
    event text not null,
    previous_status text,
    new_status text,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check (request_id is not null or payment_id is not null)
);
create index client_service_payment_history_request_idx
    on public.client_service_payment_history(request_id, created_at desc);
create index client_service_payment_history_payment_idx
    on public.client_service_payment_history(payment_id, created_at desc)
    where payment_id is not null;

-- History and issued receipts are append-only records. RPCs run with their
-- owner privileges; ordinary authenticated clients and staff receive no
-- direct write grants on these tables.
create or replace function private.prevent_service_payment_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    raise exception 'Payment audit and issued receipt records are immutable.' using errcode = '42501';
end;
$$;

create trigger client_service_payment_history_immutable
before update or delete on public.client_service_payment_history
for each row execute function private.prevent_service_payment_audit_mutation();

create trigger client_service_payment_receipts_immutable
before update or delete on public.client_service_payment_receipts
for each row execute function private.prevent_service_payment_audit_mutation();

alter table public.client_service_payment_requests enable row level security;
alter table public.client_service_payment_submissions enable row level security;
alter table public.client_service_payment_receipts enable row level security;
alter table public.client_service_payment_history enable row level security;

revoke all on public.client_service_payment_requests,
    public.client_service_payment_submissions,
    public.client_service_payment_receipts,
    public.client_service_payment_history from public, anon, authenticated;
grant select on public.client_service_payment_requests,
    public.client_service_payment_submissions,
    public.client_service_payment_receipts,
    public.client_service_payment_history to authenticated;

create policy client_service_payment_requests_read
on public.client_service_payment_requests for select to authenticated
using (
    client_id = private.current_client_id()
    or private.has_finance_permission('finance.read')
);
create policy client_service_payment_submissions_read
on public.client_service_payment_submissions for select to authenticated
using (
    client_id = private.current_client_id()
    or private.has_finance_permission('finance.read')
);
create policy client_service_payment_receipts_read
on public.client_service_payment_receipts for select to authenticated
using (
    client_id = private.current_client_id()
    or private.has_finance_permission('finance.read')
);
create policy client_service_payment_history_read
on public.client_service_payment_history for select to authenticated
using (
    exists (
        select 1 from public.client_service_payment_requests r
        where r.id = client_service_payment_history.request_id
          and (
              r.client_id = private.current_client_id()
              or private.has_finance_permission('finance.read')
          )
    )
    or exists (
        select 1 from public.client_service_payment_submissions p
        where p.id = client_service_payment_history.payment_id
          and (
              p.client_id = private.current_client_id()
              or private.has_finance_permission('finance.read')
          )
    )
);

create or replace function public.create_client_service_payment_request(
    p_client_id uuid,
    p_request_key uuid,
    p_request_type text,
    p_purpose text,
    p_title text,
    p_description text,
    p_service text,
    p_transaction_title text,
    p_destination text,
    p_transaction_id text,
    p_journey_id uuid,
    p_subtotal numeric,
    p_discount numeric,
    p_tax numeric,
    p_amount numeric,
    p_currency text,
    p_due_date date,
    p_payment_instructions text,
    p_admin_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.client_service_payment_requests%rowtype;
begin
    if auth.uid() is null
       or not private.has_finance_permission('finance.requests') then
        raise exception 'Finance request permission is required for this client.' using errcode = '42501';
    end if;
    if p_request_key is null or p_client_id is null
       or nullif(pg_catalog.btrim(p_title), '') is null
       or p_currency not in ('EUR','USD','GHS')
       or p_subtotal is null or p_discount is null or p_tax is null or p_amount is null
       or p_subtotal <= 0 or p_discount < 0 or p_tax < 0 or p_amount <= 0
       or p_amount <> p_subtotal - p_discount + p_tax
       or pg_catalog.length(p_title) > 240
       or pg_catalog.length(coalesce(p_description,'')) > 4000
       or pg_catalog.length(coalesce(p_payment_instructions,'')) > 4000
       or pg_catalog.length(coalesce(p_admin_note,'')) > 4000 then
        raise exception 'Enter a valid payment request and currency.' using errcode = '22023';
    end if;
    if p_journey_id is not null and not exists (
        select 1 from public.client_journeys j
        where j.id = p_journey_id and j.client_id = p_client_id
          and not private.is_autos_journey(j.id)
    ) then
        raise exception 'The selected journey does not belong to this client.' using errcode = '23514';
    end if;

    insert into public.client_service_payment_requests (
        client_id, journey_id, request_key, reference, request_type, purpose,
        title, description, service, transaction_title, destination, transaction_id,
        subtotal, discount, tax, amount, currency, due_date, payment_instructions,
        admin_note, created_by
    ) values (
        p_client_id, p_journey_id, p_request_key,
        'LBC-PAY-' || pg_catalog.to_char(pg_catalog.now(), 'YY') || '-' ||
            pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,12)),
        coalesce(nullif(pg_catalog.btrim(p_request_type),''),'Service Fee'),
        nullif(pg_catalog.btrim(p_purpose),''),
        pg_catalog.btrim(p_title), coalesce(p_description,''), coalesce(p_service,''),
        coalesce(p_transaction_title,''), coalesce(p_destination,''), p_transaction_id,
        p_subtotal, p_discount, p_tax, p_amount, p_currency, p_due_date,
        coalesce(p_payment_instructions,''), coalesce(p_admin_note,''), auth.uid()
    )
    on conflict (created_by, request_key) do update
        set request_key = excluded.request_key
    returning * into saved;

    insert into public.client_service_payment_history(request_id, actor_id, event, new_status, details)
    select saved.id, auth.uid(), 'request_created', saved.status,
           pg_catalog.jsonb_build_object('reference', saved.reference, 'amount', saved.amount, 'currency', saved.currency)
    where not exists (
        select 1 from public.client_service_payment_history h
        where h.request_id = saved.id and h.event = 'request_created'
    );
    return pg_catalog.to_jsonb(saved);
end;
$$;

create or replace function public.submit_client_service_payment(
    p_request_id uuid,
    p_submission_key uuid,
    p_amount numeric,
    p_payment_method text,
    p_transaction_reference text,
    p_payment_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request_row public.client_service_payment_requests%rowtype;
    saved public.client_service_payment_submissions%rowtype;
    received_total numeric(14,2);
    previous_request_status text;
begin
    if auth.uid() is null or private.current_client_id() is null then
        raise exception 'An active client session is required.' using errcode = '42501';
    end if;
    if p_submission_key is null or p_amount is null or p_amount <= 0
       or p_payment_method not in ('Bank Transfer','Mobile Money','Card','Cash','Other')
       or nullif(pg_catalog.btrim(p_transaction_reference),'') is null
       or pg_catalog.length(p_transaction_reference) > 200
       or p_payment_date is null or p_payment_date > current_date then
        raise exception 'Enter a valid amount, payment method, reference and payment date.' using errcode = '22023';
    end if;
    select * into request_row from public.client_service_payment_requests
    where id = p_request_id and client_id = private.current_client_id()
    for update;
    if not found or request_row.status in ('paid','cancelled') then
        raise exception 'This payment request is unavailable.' using errcode = '42501';
    end if;
    select * into saved from public.client_service_payment_submissions
    where client_id = request_row.client_id and submission_key = p_submission_key;
    if found then
        if saved.request_id <> request_row.id
           or saved.amount_submitted <> p_amount
           or saved.payment_method <> p_payment_method
           or saved.transaction_reference <> pg_catalog.btrim(p_transaction_reference)
           or saved.payment_date <> p_payment_date then
            raise exception 'This submission key was already used for a different payment.' using errcode = '23505';
        end if;
        return pg_catalog.to_jsonb(saved);
    end if;
    select coalesce(sum(p.amount_received),0) into received_total
    from public.client_service_payment_submissions p
    where p.request_id = request_row.id and p.status = 'verified';
    if p_amount > request_row.amount - received_total then
        raise exception 'Submitted amount exceeds the unpaid balance.' using errcode = '22023';
    end if;
    if exists (
        select 1 from public.client_service_payment_submissions p
        where p.request_id = request_row.id and p.status in ('submitted')
    ) then
        raise exception 'A payment submission is already awaiting Finance review.' using errcode = '23505';
    end if;
    insert into public.client_service_payment_submissions (
        request_id, client_id, submission_key, amount_submitted, currency,
        payment_method, transaction_reference, payment_date
    ) values (
        request_row.id, request_row.client_id, p_submission_key, p_amount,
        request_row.currency, p_payment_method, pg_catalog.btrim(p_transaction_reference), p_payment_date
    )
    on conflict (client_id, submission_key) do nothing
    returning * into saved;
    if saved.id is null then
        select * into saved from public.client_service_payment_submissions
        where client_id = request_row.client_id and submission_key = p_submission_key;
        if saved.request_id <> request_row.id
           or saved.amount_submitted <> p_amount
           or saved.payment_method <> p_payment_method
           or saved.transaction_reference <> pg_catalog.btrim(p_transaction_reference)
           or saved.payment_date <> p_payment_date then
            raise exception 'This submission key was already used for a different payment.' using errcode = '23505';
        end if;
        return pg_catalog.to_jsonb(saved);
    end if;
    insert into public.client_service_payment_history(
        request_id, payment_id, actor_id, event, new_status, details
    ) values (
        request_row.id, saved.id, auth.uid(), 'payment_submitted', saved.status,
        pg_catalog.jsonb_build_object('amount', saved.amount_submitted, 'currency', saved.currency,
            'payment_method', saved.payment_method, 'payment_date', saved.payment_date)
    );
    previous_request_status := request_row.status;
    update public.client_service_payment_requests
    set status = 'payment_submitted', updated_at = pg_catalog.now()
    where id = request_row.id returning * into request_row;
    if request_row.status is distinct from previous_request_status then
        insert into public.client_service_payment_history(
            request_id, payment_id, actor_id, event, previous_status, new_status
        ) values (
            request_row.id, saved.id, auth.uid(), 'request_status_changed', previous_request_status, request_row.status
        );
    end if;
    return pg_catalog.to_jsonb(saved);
end;
$$;

create or replace function public.verify_client_service_payment(
    p_payment_id uuid,
    p_action text,
    p_amount_received numeric,
    p_finance_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare payment_row public.client_service_payment_submissions%rowtype;
    request_row public.client_service_payment_requests%rowtype;
    reviewer_name text;
    total_received numeric(14,2);
    previous_request_status text;
    saved_receipt public.client_service_payment_receipts%rowtype;
begin
    if auth.uid() is null or not private.has_finance_permission('finance.verify') then
        raise exception 'Finance verification permission is required.' using errcode = '42501';
    end if;
    if p_action not in ('verified','rejected')
       or (p_action = 'rejected' and nullif(pg_catalog.btrim(p_finance_note),'') is null)
       or pg_catalog.length(coalesce(p_finance_note,'')) > 4000 then
        raise exception 'Choose verification or provide a rejection reason.' using errcode = '22023';
    end if;
    select * into payment_row from public.client_service_payment_submissions
    where id = p_payment_id for update;
    if not found then
        raise exception 'Payment submission was not found.' using errcode = 'P0002';
    end if;
    select * into request_row from public.client_service_payment_requests
    where id = payment_row.request_id for update;
    previous_request_status := request_row.status;
    if payment_row.status = 'verified' then
        select * into saved_receipt from public.client_service_payment_receipts where payment_id = payment_row.id;
        return pg_catalog.jsonb_build_object('payment',pg_catalog.to_jsonb(payment_row),'receipt',pg_catalog.to_jsonb(saved_receipt),'already_verified',true);
    end if;
    if payment_row.status <> 'submitted' then
        raise exception 'Only a submitted payment can be reviewed.' using errcode = '22023';
    end if;
    select nullif(pg_catalog.btrim(sp.display_name),'') into reviewer_name
    from public.staff_profiles sp where sp.user_id = auth.uid();
    if p_action = 'verified' then
        if p_amount_received is null or p_amount_received <= 0 or p_amount_received > payment_row.amount_submitted then
            raise exception 'Verified amount must be positive and no greater than the submitted amount.' using errcode = '22023';
        end if;
        update public.client_service_payment_submissions
        set status='verified', amount_received=p_amount_received, verified_by=auth.uid(),
            verified_by_name=coalesce(reviewer_name,'Finance'), verified_at=pg_catalog.now(),
            verification_note=coalesce(nullif(pg_catalog.btrim(p_finance_note),''),'')
        where id=payment_row.id returning * into payment_row;
        insert into public.client_service_payment_receipts(
            payment_id,request_id,client_id,receipt_number,amount_paid,currency,payment_method,
            payment_reference,payment_date,issued_by,issued_by_name,notes
        ) values (
            payment_row.id,request_row.id,request_row.client_id,
            'LBC-RCP-' || pg_catalog.to_char(pg_catalog.now(),'YYYY') || '-' ||
                pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,12)),
            p_amount_received,request_row.currency,payment_row.payment_method,payment_row.transaction_reference,
            payment_row.payment_date,auth.uid(),coalesce(reviewer_name,'Finance'),
            coalesce(nullif(pg_catalog.btrim(p_finance_note),''),'')
        ) returning * into saved_receipt;
        insert into public.client_service_payment_history(
            request_id, payment_id, actor_id, event, previous_status, new_status, details
        ) values (
            request_row.id, payment_row.id, auth.uid(), 'payment_verified', 'submitted', 'verified',
            pg_catalog.jsonb_build_object('amount_received', p_amount_received,
                'currency', request_row.currency, 'receipt_number', saved_receipt.receipt_number,
                'finance_note', coalesce(nullif(pg_catalog.btrim(p_finance_note),''),''))
        );
        select coalesce(sum(p.amount_received),0) into total_received
        from public.client_service_payment_submissions p
        where p.request_id=request_row.id and p.status='verified';
        update public.client_service_payment_requests
        set status=case when total_received >= amount then 'paid' else 'partially_paid' end,
            updated_at=pg_catalog.now()
        where id=request_row.id returning * into request_row;
    else
        update public.client_service_payment_submissions
        set status='rejected', rejection_reason=pg_catalog.btrim(p_finance_note),
            verified_by=auth.uid(), verified_by_name=coalesce(reviewer_name,'Finance'),
            verified_at=pg_catalog.now()
        where id=payment_row.id returning * into payment_row;
        select coalesce(sum(p.amount_received),0) into total_received
        from public.client_service_payment_submissions p
        where p.request_id=request_row.id and p.status='verified';
        update public.client_service_payment_requests
        set status=case when total_received > 0 then 'partially_paid' else 'rejected' end,
            updated_at=pg_catalog.now()
        where id=request_row.id returning * into request_row;
        insert into public.client_service_payment_history(
            request_id, payment_id, actor_id, event, previous_status, new_status, details
        ) values (
            request_row.id, payment_row.id, auth.uid(), 'payment_rejected', 'submitted', 'rejected',
            pg_catalog.jsonb_build_object('rejection_reason', pg_catalog.btrim(p_finance_note))
        );
    end if;
    if request_row.status is distinct from previous_request_status then
        insert into public.client_service_payment_history(
            request_id, payment_id, actor_id, event, previous_status, new_status, details
        ) values (
            request_row.id, payment_row.id, auth.uid(), 'request_status_changed',
            previous_request_status, request_row.status, '{}'::jsonb
        );
    end if;
    return pg_catalog.jsonb_build_object(
        'payment',pg_catalog.to_jsonb(payment_row),
        'request',pg_catalog.to_jsonb(request_row),
        'receipt',case when saved_receipt.id is null then null else pg_catalog.to_jsonb(saved_receipt) end,
        'already_verified',false
    );
end;
$$;

create or replace function public.cancel_client_service_payment_request(p_request_id uuid,p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare previous_status text;
begin
    if auth.uid() is null or not private.has_finance_permission('finance.requests') then
        raise exception 'Finance request permission is required.' using errcode = '42501';
    end if;
    if pg_catalog.length(coalesce(p_reason,'')) > 1000 then
        raise exception 'Cancellation reason is too long.' using errcode = '22023';
    end if;
    select r.status into previous_status
    from public.client_service_payment_requests r
    where r.id = p_request_id and r.status not in ('paid','cancelled')
      and private.can_access_client(r.client_id)
    for update;
    if not found then raise exception 'Payment request not found or cannot be cancelled.' using errcode = '42501'; end if;

    update public.client_service_payment_requests r
    set status='cancelled',admin_note=concat_ws(E'\n',nullif(r.admin_note,''),nullif(pg_catalog.btrim(p_reason),'')),updated_at=pg_catalog.now()
    where r.id=p_request_id and r.status not in ('paid','cancelled');
    insert into public.client_service_payment_history(request_id, actor_id, event, previous_status, new_status, details)
    values (p_request_id, auth.uid(), 'request_cancelled', previous_status, 'cancelled',
        pg_catalog.jsonb_build_object('reason', coalesce(pg_catalog.btrim(p_reason),'')));
end;
$$;

create or replace function public.update_client_service_payment_request(
    p_request_id uuid,
    p_expected_updated_at timestamptz,
    p_title text,
    p_description text,
    p_service text,
    p_transaction_title text,
    p_destination text,
    p_subtotal numeric,
    p_discount numeric,
    p_tax numeric,
    p_amount numeric,
    p_currency text,
    p_due_date date,
    p_payment_instructions text,
    p_admin_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_request public.client_service_payment_requests%rowtype;
    updated_request public.client_service_payment_requests%rowtype;
begin
    if auth.uid() is null or not private.has_finance_permission('finance.requests') then
        raise exception 'Finance request permission is required.' using errcode = '42501';
    end if;
    select * into current_request
    from public.client_service_payment_requests r
    where r.id = p_request_id
    for update;
    if not found then
        raise exception 'Payment request not found or access denied.' using errcode = '42501';
    end if;
    if current_request.updated_at is distinct from p_expected_updated_at then
        raise exception 'This payment request changed while it was being edited. Reload and try again.' using errcode = '40001';
    end if;
    if current_request.status not in ('requested','rejected','partially_paid')
       or exists (
           select 1 from public.client_service_payment_submissions p
           where p.request_id = current_request.id and p.status in ('submitted','verified')
       ) then
        raise exception 'A payment request cannot be edited after a payment has been submitted or verified.' using errcode = '22023';
    end if;
    if nullif(pg_catalog.btrim(p_title),'') is null
       or p_currency not in ('EUR','USD','GHS')
       or p_subtotal is null or p_discount is null or p_tax is null or p_amount is null
       or p_subtotal <= 0 or p_discount < 0 or p_tax < 0 or p_amount <= 0
       or p_amount <> p_subtotal - p_discount + p_tax
       or pg_catalog.length(p_title) > 240
       or pg_catalog.length(coalesce(p_description,'')) > 4000
       or pg_catalog.length(coalesce(p_payment_instructions,'')) > 4000
       or pg_catalog.length(coalesce(p_admin_note,'')) > 4000 then
        raise exception 'Enter a valid payment request and currency.' using errcode = '22023';
    end if;
    update public.client_service_payment_requests
    set title=pg_catalog.btrim(p_title), description=coalesce(p_description,''),
        service=coalesce(p_service,''), transaction_title=coalesce(p_transaction_title,''),
        destination=coalesce(p_destination,''), subtotal=p_subtotal, discount=p_discount,
        tax=p_tax, amount=p_amount, currency=p_currency, due_date=p_due_date,
        payment_instructions=coalesce(p_payment_instructions,''), admin_note=coalesce(p_admin_note,''),
        updated_at=pg_catalog.now()
    where id=current_request.id
    returning * into updated_request;
    insert into public.client_service_payment_history(
        request_id, actor_id, event, previous_status, new_status, details
    ) values (
        updated_request.id, auth.uid(), 'request_edited', current_request.status, updated_request.status,
        pg_catalog.jsonb_build_object(
            'previous', pg_catalog.jsonb_build_object('title', current_request.title, 'description', current_request.description,
                'service', current_request.service, 'transaction_title', current_request.transaction_title,
                'amount', current_request.amount, 'currency', current_request.currency, 'due_date', current_request.due_date),
            'current', pg_catalog.jsonb_build_object('title', updated_request.title, 'description', updated_request.description,
                'service', updated_request.service, 'transaction_title', updated_request.transaction_title,
                'amount', updated_request.amount, 'currency', updated_request.currency, 'due_date', updated_request.due_date)
        )
    );
    return pg_catalog.to_jsonb(updated_request);
end;
$$;

create or replace function public.list_admin_client_service_payments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not private.has_finance_permission('finance.read') then
        raise exception 'Finance read permission is required.' using errcode = '42501';
    end if;
    return pg_catalog.jsonb_build_object(
        'requests',coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('record',pg_catalog.to_jsonb(r),'client_name',c.full_name,'client_code',pg_catalog.to_jsonb(c)->>'client_code') order by r.created_at desc)
            from public.client_service_payment_requests r join public.clients c on c.id=r.client_id
        ),'[]'::jsonb),
        'payments',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.submitted_at desc) from public.client_service_payment_submissions p),'[]'::jsonb),
        'receipts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rc) order by rc.issued_at desc) from public.client_service_payment_receipts rc),'[]'::jsonb)
    );
end;
$$;

create or replace function public.list_my_client_service_payments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare cid uuid := private.current_client_id();
begin
    if auth.uid() is null or cid is null then
        raise exception 'An active linked client account is required.' using errcode = '42501';
    end if;
    return pg_catalog.jsonb_build_object(
        'requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('record',pg_catalog.to_jsonb(r),'client_name',c.full_name,'client_code',pg_catalog.to_jsonb(c)->>'client_code') order by r.created_at desc)
            from public.client_service_payment_requests r join public.clients c on c.id=r.client_id where r.client_id=cid),'[]'::jsonb),
        'payments',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.submitted_at desc) from public.client_service_payment_submissions p where p.client_id=cid),'[]'::jsonb),
        'receipts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rc) order by rc.issued_at desc) from public.client_service_payment_receipts rc where rc.client_id=cid),'[]'::jsonb)
    );
end;
$$;

revoke all on function public.create_client_service_payment_request(uuid,uuid,text,text,text,text,text,text,text,text,uuid,numeric,numeric,numeric,numeric,text,date,text,text) from public,anon,authenticated;
grant execute on function public.create_client_service_payment_request(uuid,uuid,text,text,text,text,text,text,text,text,uuid,numeric,numeric,numeric,numeric,text,date,text,text) to authenticated;
revoke all on function public.submit_client_service_payment(uuid,uuid,numeric,text,text,date) from public,anon,authenticated;
grant execute on function public.submit_client_service_payment(uuid,uuid,numeric,text,text,date) to authenticated;
revoke all on function public.verify_client_service_payment(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.verify_client_service_payment(uuid,text,numeric,text) to authenticated;
revoke all on function public.cancel_client_service_payment_request(uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_client_service_payment_request(uuid,text) to authenticated;
revoke all on function public.update_client_service_payment_request(uuid,timestamptz,text,text,text,text,text,numeric,numeric,numeric,numeric,text,date,text,text) from public,anon,authenticated;
grant execute on function public.update_client_service_payment_request(uuid,timestamptz,text,text,text,text,text,numeric,numeric,numeric,numeric,text,date,text,text) to authenticated;
revoke all on function public.list_admin_client_service_payments() from public,anon,authenticated;
grant execute on function public.list_admin_client_service_payments() to authenticated;
revoke all on function public.list_my_client_service_payments() from public,anon,authenticated;
grant execute on function public.list_my_client_service_payments() to authenticated;
revoke all on function private.prevent_service_payment_audit_mutation() from public,anon,authenticated;

commit;
