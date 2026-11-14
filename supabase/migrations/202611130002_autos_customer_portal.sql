-- Dedicated AUTOS customer portal records and customer-scoped operations.
-- Additive only: uses existing clients, enquiries, journeys, documents,
-- client_accounts, staff permission helpers, and private Storage.
begin;

do $$
begin
    if to_regclass('public.clients') is null
       or to_regclass('public.enquiries') is null
       or to_regclass('public.client_accounts') is null
       or to_regclass('public.client_journeys') is null
       or to_regclass('public.client_journey_stage_history') is null
       or to_regclass('public.client_documents') is null
       or to_regclass('public.document_requests') is null
       or to_regclass('public.staff_profiles') is null
       or to_regclass('storage.objects') is null
       or to_regprocedure('private.can_manage_autos()') is null
       or to_regprocedure('private.is_autos_enquiry_for_client(uuid,uuid)') is null
       or to_regprocedure('private.is_autos_journey(uuid)') is null then
        raise exception 'Required existing AUTOS, journey, document, identity, or authorization structures are missing.';
    end if;
end;
$$;

create table public.autos_customer_quotes (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    enquiry_id uuid not null references public.enquiries(id) on delete restrict,
    quote_reference text not null unique,
    version integer not null check (version > 0),
    currency text not null check (currency in ('EUR','USD','GHS')),
    vehicle_purchase_price numeric(14,2) not null check (vehicle_purchase_price > 0),
    lordbless_service_fee numeric(14,2) not null check (lordbless_service_fee >= 0),
    status text not null default 'draft' check (status in ('draft','sent','accepted','declined','superseded')),
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    accepted_by uuid references auth.users(id) on delete set null,
    accepted_at timestamptz,
    unique (enquiry_id, version),
    check ((status <> 'accepted') or (accepted_by is not null and accepted_at is not null))
);

create table public.autos_customer_agreements (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    enquiry_id uuid not null references public.enquiries(id) on delete restrict,
    document_id uuid not null references public.client_documents(id) on delete restrict,
    agreement_reference text not null,
    version integer not null check (version > 0),
    status text not null default 'draft' check (status in ('draft','sent','accepted','superseded')),
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    accepted_by uuid references auth.users(id) on delete set null,
    accepted_at timestamptz,
    unique (enquiry_id, agreement_reference, version),
    check ((status <> 'accepted') or (accepted_by is not null and accepted_at is not null))
);

create table public.autos_logistics_statements (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    enquiry_id uuid not null references public.enquiries(id) on delete restrict,
    statement_reference text not null unique,
    currency text not null check (currency in ('EUR','USD','GHS')),
    line_items jsonb not null check (jsonb_typeof(line_items) = 'array' and jsonb_array_length(line_items) > 0),
    total_amount numeric(14,2) not null check (total_amount >= 0),
    status text not null default 'draft' check (status in ('draft','issued','superseded')),
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    issued_at timestamptz
);

create table public.autos_payment_requests (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    enquiry_id uuid not null references public.enquiries(id) on delete restrict,
    quote_id uuid references public.autos_customer_quotes(id) on delete restrict,
    logistics_statement_id uuid references public.autos_logistics_statements(id) on delete restrict,
    reference text not null unique,
    payment_type text not null check (payment_type in ('vehicle_purchase','service_fee','logistics')),
    currency text not null check (currency in ('EUR','USD','GHS')),
    amount numeric(14,2) not null check (amount > 0),
    description text not null check (length(btrim(description)) between 1 and 500),
    payment_instructions text not null default '' check (length(payment_instructions) <= 3000),
    status text not null default 'requested' check (status in ('requested','submitted','verified','cancelled')),
    client_payment_reference text,
    client_payment_date date,
    submitted_at timestamptz,
    verified_by uuid references public.staff_profiles(user_id) on delete set null,
    verified_by_name text,
    verified_at timestamptz,
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    check ((status <> 'verified') or (verified_by is not null and verified_at is not null))
);

create table public.autos_customer_receipts (
    id uuid primary key default gen_random_uuid(),
    payment_request_id uuid not null unique references public.autos_payment_requests(id) on delete restrict,
    receipt_number text not null unique,
    amount_paid numeric(14,2) not null check (amount_paid > 0),
    currency text not null check (currency in ('EUR','USD','GHS')),
    issued_at timestamptz not null default now(),
    issued_by uuid not null references public.staff_profiles(user_id) on delete restrict
);

create table public.autos_customer_updates (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    enquiry_id uuid not null references public.enquiries(id) on delete restrict,
    title text not null check (length(btrim(title)) between 1 and 160),
    message text not null check (length(btrim(message)) between 1 and 3000),
    published boolean not null default false,
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    published_at timestamptz
);

create index autos_customer_quotes_client_created_idx on public.autos_customer_quotes(client_id, created_at desc);
create index autos_customer_agreements_client_created_idx on public.autos_customer_agreements(client_id, created_at desc);
create index autos_logistics_statements_client_created_idx on public.autos_logistics_statements(client_id, created_at desc);
create index autos_payment_requests_client_created_idx on public.autos_payment_requests(client_id, created_at desc);
create index autos_customer_updates_client_published_idx on public.autos_customer_updates(client_id, published, created_at desc);

do $$
declare table_name text;
begin
    foreach table_name in array array[
        'autos_customer_quotes','autos_customer_agreements','autos_logistics_statements',
        'autos_payment_requests','autos_customer_receipts','autos_customer_updates'
    ] loop
        execute format('alter table public.%I enable row level security', table_name);
        execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    end loop;
end;
$$;
grant select (id,client_id,enquiry_id,quote_reference,version,currency,vehicle_purchase_price,lordbless_service_fee,status,created_at,sent_at,accepted_at) on public.autos_customer_quotes to authenticated;
grant select (id,client_id,enquiry_id,document_id,agreement_reference,version,status,created_at,sent_at,accepted_at) on public.autos_customer_agreements to authenticated;
grant select (id,client_id,enquiry_id,statement_reference,currency,line_items,total_amount,status,created_at,issued_at) on public.autos_logistics_statements to authenticated;
grant select (id,client_id,enquiry_id,quote_id,logistics_statement_id,reference,payment_type,currency,amount,description,payment_instructions,status,client_payment_reference,client_payment_date,submitted_at,verified_at,created_at) on public.autos_payment_requests to authenticated;
grant select (id,payment_request_id,receipt_number,amount_paid,currency,issued_at) on public.autos_customer_receipts to authenticated;
grant select (id,client_id,enquiry_id,title,message,published,created_at,published_at) on public.autos_customer_updates to authenticated;
grant insert on public.autos_customer_updates to authenticated;

-- Direct reads are strictly tied to the authenticated linked client and an
-- existing AUTOS enquiry. Staff writes remain bounded by China Desk/Admin.
create policy autos_quotes_read on public.autos_customer_quotes for select to authenticated
using ((private.current_client_id() = client_id and private.is_autos_enquiry_for_client(enquiry_id, client_id)) or private.can_manage_autos());

create policy autos_agreements_read on public.autos_customer_agreements for select to authenticated
using ((private.current_client_id() = client_id and private.is_autos_enquiry_for_client(enquiry_id, client_id)) or private.can_manage_autos());

create policy autos_logistics_read on public.autos_logistics_statements for select to authenticated
using ((private.current_client_id() = client_id and private.is_autos_enquiry_for_client(enquiry_id, client_id)) or private.can_manage_autos());

create policy autos_payments_read on public.autos_payment_requests for select to authenticated
using ((private.current_client_id() = client_id and private.is_autos_enquiry_for_client(enquiry_id, client_id)) or private.can_manage_autos());
create policy autos_receipts_read on public.autos_customer_receipts for select to authenticated
using (private.can_manage_autos() or exists (
    select 1 from public.autos_payment_requests p
    where p.id = payment_request_id and p.client_id = private.current_client_id()
      and private.is_autos_enquiry_for_client(p.enquiry_id, p.client_id)
));

create policy autos_updates_read on public.autos_customer_updates for select to authenticated
using ((published and private.current_client_id() = client_id and private.is_autos_enquiry_for_client(enquiry_id, client_id)) or private.can_manage_autos());
create policy autos_updates_staff_insert on public.autos_customer_updates for insert to authenticated
with check (private.can_manage_autos() and private.is_autos_enquiry_for_client(enquiry_id, client_id) and created_by = auth.uid());

-- Keep agreement attachments inside the same customer transaction and only
-- expose a document already approved through the existing review workflow.
create or replace function private.guard_autos_agreement_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if not private.can_manage_autos() or not private.is_autos_enquiry_for_client(new.enquiry_id,new.client_id)
       or not exists (
            select 1 from public.client_documents d where d.id=new.document_id and d.client_id=new.client_id
              and d.status='approved' and private.is_autos_document(d.id)
              and (pg_catalog.to_jsonb(d)->>'enquiry_id'=new.enquiry_id::text or exists (
                  select 1 from public.document_requests r where r.id=(pg_catalog.to_jsonb(d)->>'document_request_id')::uuid
                    and r.enquiry_id=new.enquiry_id and r.client_id=new.client_id
              ))
       ) then raise exception 'Agreement must be an approved customer-facing document for this transaction.' using errcode='42501'; end if;
    return new;
end;
$$;
create trigger autos_agreements_scope_attachment before insert on public.autos_customer_agreements
for each row execute function private.guard_autos_agreement_attachment();

revoke all on function private.guard_autos_agreement_attachment() from public,anon,authenticated;

-- Directly updating a payment row cannot mark it verified or alter its amount.
create or replace function private.guard_autos_payment_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.client_id is distinct from old.client_id or new.enquiry_id is distinct from old.enquiry_id
       or new.quote_id is distinct from old.quote_id or new.logistics_statement_id is distinct from old.logistics_statement_id
       or new.reference is distinct from old.reference or new.payment_type is distinct from old.payment_type
       or new.currency is distinct from old.currency or new.amount is distinct from old.amount
       or new.description is distinct from old.description or new.payment_instructions is distinct from old.payment_instructions
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
        raise exception 'AUTOS payment request terms are immutable.' using errcode='42501';
    end if;
    if new.status is distinct from old.status and current_setting('app.autos_payment_update',true) is distinct from new.status then
        raise exception 'Payment status can only be changed by a controlled customer or verification action.' using errcode='42501';
    end if;
    return new;
end;
$$;
create trigger autos_payment_guard_update before update on public.autos_payment_requests
for each row execute function private.guard_autos_payment_changes();
revoke all on function private.guard_autos_payment_changes() from public,anon,authenticated;

create or replace function public.create_autos_customer_quote(
    p_client_id uuid,p_enquiry_id uuid,p_currency text,p_vehicle_price numeric,p_service_fee numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare next_version integer; new_id uuid;
begin
    if auth.uid() is null or not private.can_manage_autos() or not private.is_autos_enquiry_for_client(p_enquiry_id,p_client_id)
       or p_currency not in ('EUR','USD','GHS') or p_vehicle_price <= 0 or p_service_fee < 0 then
        raise exception 'AUTOS permission, client transaction, currency, and valid price values are required.' using errcode='42501';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enquiry_id::text || ':autos_quote',0));
    select coalesce(max(version),0)+1 into next_version from public.autos_customer_quotes where enquiry_id=p_enquiry_id;
    update public.autos_customer_quotes set status='superseded' where enquiry_id=p_enquiry_id and status='sent';
    insert into public.autos_customer_quotes(client_id,enquiry_id,quote_reference,version,currency,vehicle_purchase_price,lordbless_service_fee,status,created_by,sent_at)
    values(p_client_id,p_enquiry_id,'LBC-AQ-'||pg_catalog.to_char(pg_catalog.now(),'YYYYMMDD')||'-'||pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text,'-',''),1,8)),next_version,p_currency,p_vehicle_price,p_service_fee,'sent',auth.uid(),pg_catalog.now())
    returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.create_autos_customer_quote(uuid,uuid,text,numeric,numeric) from public,anon;
grant execute on function public.create_autos_customer_quote(uuid,uuid,text,numeric,numeric) to authenticated;

create or replace function public.create_autos_customer_agreement(
    p_client_id uuid,p_enquiry_id uuid,p_document_id uuid,p_reference text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; next_version integer;
begin
    if auth.uid() is null or not private.can_manage_autos() or not private.is_autos_enquiry_for_client(p_enquiry_id,p_client_id)
       or nullif(pg_catalog.btrim(p_reference),'') is null
       or not exists (
            select 1 from public.client_documents d where d.id=p_document_id and d.client_id=p_client_id
              and d.status='approved' and private.is_autos_document(d.id)
              and (pg_catalog.to_jsonb(d)->>'enquiry_id'=p_enquiry_id::text or exists (
                  select 1 from public.document_requests r where r.id=(pg_catalog.to_jsonb(d)->>'document_request_id')::uuid
                    and r.enquiry_id=p_enquiry_id and r.client_id=p_client_id
              ))
       ) then
        raise exception 'An approved AUTOS customer-facing agreement document for this client and transaction is required.' using errcode='42501';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enquiry_id::text || ':' || pg_catalog.btrim(p_reference),0));
    select coalesce(max(version),0)+1 into next_version from public.autos_customer_agreements
    where enquiry_id=p_enquiry_id and agreement_reference=pg_catalog.btrim(p_reference);
    update public.autos_customer_agreements set status='superseded'
    where enquiry_id=p_enquiry_id and agreement_reference=pg_catalog.btrim(p_reference) and status='sent';
    insert into public.autos_customer_agreements(client_id,enquiry_id,document_id,agreement_reference,version,status,created_by,sent_at)
    values(p_client_id,p_enquiry_id,p_document_id,pg_catalog.btrim(p_reference),next_version,'sent',auth.uid(),pg_catalog.now()) returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.create_autos_customer_agreement(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.create_autos_customer_agreement(uuid,uuid,uuid,text) to authenticated;

create or replace function public.create_autos_logistics_statement(
    p_client_id uuid,p_enquiry_id uuid,p_reference text,p_currency text,p_line_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare row_item jsonb; total numeric(14,2):=0; new_id uuid;
begin
    if auth.uid() is null or not private.can_manage_autos() or not private.is_autos_enquiry_for_client(p_enquiry_id,p_client_id)
       or p_currency not in ('EUR','USD','GHS') or nullif(pg_catalog.btrim(p_reference),'') is null
       or jsonb_typeof(p_line_items)<>'array' or jsonb_array_length(p_line_items)=0 then
        raise exception 'AUTOS permission, transaction, statement reference, currency and itemized costs are required.' using errcode='22023';
    end if;
    for row_item in select value from jsonb_array_elements(p_line_items) loop
        if jsonb_typeof(row_item)<>'object' or nullif(pg_catalog.btrim(row_item->>'label'),'') is null
           or jsonb_typeof(row_item->'amount')<>'number' or (row_item->>'amount')::numeric<0 then
            raise exception 'Every logistics cost must have a label and a non-negative numeric amount.' using errcode='22023';
        end if;
        total:=total+(row_item->>'amount')::numeric;
    end loop;
    insert into public.autos_logistics_statements(client_id,enquiry_id,statement_reference,currency,line_items,total_amount,status,created_by,issued_at)
    values(p_client_id,p_enquiry_id,pg_catalog.btrim(p_reference),p_currency,p_line_items,total,'issued',auth.uid(),pg_catalog.now()) returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.create_autos_logistics_statement(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.create_autos_logistics_statement(uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.create_autos_payment_request(
    p_client_id uuid,p_enquiry_id uuid,p_reference text,p_type text,p_currency text,p_amount numeric,
    p_description text,p_instructions text,p_quote_id uuid default null,p_logistics_statement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; expected_amount numeric; expected_currency text;
begin
    if auth.uid() is null or not private.can_manage_autos() or not private.is_autos_enquiry_for_client(p_enquiry_id,p_client_id)
       or p_currency not in ('EUR','USD','GHS') or p_amount<=0 or nullif(pg_catalog.btrim(p_reference),'') is null then
        raise exception 'AUTOS permission and valid transaction payment details are required.' using errcode='42501';
    end if;
    if p_type in ('vehicle_purchase','service_fee') then
        select case when p_type='vehicle_purchase' then vehicle_purchase_price else lordbless_service_fee end,currency
        into expected_amount,expected_currency from public.autos_customer_quotes
        where id=p_quote_id and client_id=p_client_id and enquiry_id=p_enquiry_id and status='accepted';
        if not found or expected_amount is distinct from p_amount or expected_currency is distinct from p_currency or p_logistics_statement_id is not null then
            raise exception 'Vehicle and service fee requests must match an accepted quotation exactly.' using errcode='23514';
        end if;
    elsif p_type='logistics' then
        select total_amount,currency into expected_amount,expected_currency from public.autos_logistics_statements
        where id=p_logistics_statement_id and client_id=p_client_id and enquiry_id=p_enquiry_id and status='issued';
        if not found or expected_amount is distinct from p_amount or expected_currency is distinct from p_currency or p_quote_id is not null then
            raise exception 'Logistics requests must match a separately issued logistics statement exactly.' using errcode='23514';
        end if;
    else
        raise exception 'Unsupported AUTOS payment type.' using errcode='22023';
    end if;
    insert into public.autos_payment_requests(client_id,enquiry_id,quote_id,logistics_statement_id,reference,payment_type,currency,amount,description,payment_instructions,created_by)
    values(p_client_id,p_enquiry_id,p_quote_id,p_logistics_statement_id,pg_catalog.btrim(p_reference),p_type,p_currency,p_amount,pg_catalog.btrim(p_description),coalesce(p_instructions,''),auth.uid()) returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.create_autos_payment_request(uuid,uuid,text,text,text,numeric,text,text,uuid,uuid) from public,anon;
grant execute on function public.create_autos_payment_request(uuid,uuid,text,text,text,numeric,text,text,uuid,uuid) to authenticated;

create or replace function public.list_autos_customer_documents()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid; result jsonb;
begin
    select ca.client_id into cid from public.client_accounts ca where ca.auth_user_id=auth.uid() and ca.access_status='active';
    if cid is null or not private.is_autos_client(cid) then raise exception 'Active AUTOS client portal access is required.' using errcode='42501'; end if;
    select jsonb_build_object(
        'documents',coalesce((select jsonb_agg(jsonb_build_object(
            'id',d.id,'client_id',d.client_id,'document_type',d.document_type,'document_name',d.document_name,
            'file_name',d.file_name,'storage_path',d.storage_path,'status',d.status,'uploaded_at',d.uploaded_at,
            'document_request_id',pg_catalog.to_jsonb(d)->>'document_request_id',
            'rejection_reason',pg_catalog.to_jsonb(d)->>'rejection_reason'
        ) order by d.uploaded_at desc)
        from public.client_documents d where d.client_id=cid and (
            private.is_autos_document(d.id) or exists (
                select 1 from public.autos_customer_agreements a where a.document_id=d.id and a.client_id=cid
            )
        )), '[]'::jsonb),
        'requests',coalesce((select jsonb_agg(jsonb_build_object(
            'id',r.id,'client_id',r.client_id,'enquiry_id',r.enquiry_id,'document_type',r.document_type,
            'document_name',r.document_name,'message',r.message,'status',r.status,'created_at',r.created_at
        ) order by r.created_at desc) from public.document_requests r
          where r.client_id=cid and private.is_autos_enquiry(r.enquiry_id)), '[]'::jsonb)
    ) into result;
    return result;
end;
$$;
revoke all on function public.list_autos_customer_documents() from public,anon;
grant execute on function public.list_autos_customer_documents() to authenticated;

-- Make sent commercial documents immutable; each revision is a new version.
create or replace function private.guard_autos_commercial_version()
returns trigger language plpgsql set search_path = '' as $$
begin
    if old.status <> 'draft' and (
        new.client_id is distinct from old.client_id or new.enquiry_id is distinct from old.enquiry_id
        or new.quote_reference is distinct from old.quote_reference or new.version is distinct from old.version
        or new.currency is distinct from old.currency or new.vehicle_purchase_price is distinct from old.vehicle_purchase_price
        or new.lordbless_service_fee is distinct from old.lordbless_service_fee or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at
    ) then raise exception 'A sent AUTOS quotation is immutable; create a new version.' using errcode = '42501'; end if;
    return new;
end;
$$;
create trigger autos_quotes_immutable_sent before update on public.autos_customer_quotes
for each row execute function private.guard_autos_commercial_version();

create or replace function private.guard_autos_agreement_version()
returns trigger language plpgsql set search_path = '' as $$
begin
    if old.status <> 'draft' and (
        new.client_id is distinct from old.client_id or new.enquiry_id is distinct from old.enquiry_id
        or new.document_id is distinct from old.document_id or new.agreement_reference is distinct from old.agreement_reference
        or new.version is distinct from old.version or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at
    ) then raise exception 'A sent AUTOS agreement is immutable; publish a revised version.' using errcode = '42501'; end if;
    return new;
end;
$$;
create trigger autos_agreements_immutable_sent before update on public.autos_customer_agreements
for each row execute function private.guard_autos_agreement_version();
revoke all on function private.guard_autos_commercial_version() from public,anon,authenticated;
revoke all on function private.guard_autos_agreement_version() from public,anon,authenticated;

create or replace function public.has_autos_customer_portal()
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.client_accounts ca
        where ca.auth_user_id = auth.uid() and ca.access_status = 'active'
          and private.is_autos_client(ca.client_id)
    );
$$;
revoke all on function public.has_autos_customer_portal() from public, anon;
grant execute on function public.has_autos_customer_portal() to authenticated;

-- Return only customer-facing journey fields. Stage history deliberately omits
-- internal_note, staff identity, and operational metadata.
create or replace function public.autos_customer_portal_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid; result jsonb;
begin
    select ca.client_id into cid from public.client_accounts ca
    where ca.auth_user_id = auth.uid() and ca.access_status = 'active';
    if auth.uid() is null or cid is null or not private.is_autos_client(cid) then
        raise exception 'Active AUTOS client portal access is required.' using errcode = '42501';
    end if;
    select jsonb_build_object(
        'client', jsonb_build_object(
            'id', c.id,
            'name', coalesce(to_jsonb(c)->>'full_name', to_jsonb(c)->>'name', 'Client'),
            'client_code', coalesce(to_jsonb(c)->>'client_code', to_jsonb(c)->>'client_number'),
            'email', to_jsonb(c)->>'email',
            'phone', coalesce(to_jsonb(c)->>'whatsapp', to_jsonb(c)->>'phone')
        ),
        'transactions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'enquiry_id', e.id,
                'reference', coalesce(to_jsonb(e)->>'reference', to_jsonb(e)->>'enquiry_reference'),
                'title', coalesce(to_jsonb(e)->>'vehicle_title', to_jsonb(e)->>'title', 'Vehicle transaction'),
                'service', coalesce(to_jsonb(e)->>'service', 'LORDBLESS AUTOS'),
                'created_at', e.created_at,
                'journeys', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'id', j.id, 'title', j.title, 'stage', j.stage,
                        'updated_at', j.updated_at,
                        'history', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                'previous_stage', h.previous_stage,
                                'stage', h.new_stage,
                                'created_at', h.created_at
                            ) order by h.created_at)
                            from public.client_journey_stage_history h
                            where h.journey_id = j.id
                        ), '[]'::jsonb)
                    )) from public.client_journeys j
                    where j.enquiry_id = e.id and j.client_id = cid and private.is_autos_journey(j.id)
                ), '[]'::jsonb)
            ) order by e.created_at desc)
            from public.enquiries e where e.client_id = cid and private.is_autos_enquiry(e.id)
        ), '[]'::jsonb)
    ) into result
    from public.clients c where c.id = cid;
    return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.autos_customer_portal_snapshot() from public, anon;
grant execute on function public.autos_customer_portal_snapshot() to authenticated;

create or replace function public.accept_autos_quote(p_quote_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid; q public.autos_customer_quotes%rowtype;
begin
    select ca.client_id into cid from public.client_accounts ca where ca.auth_user_id=auth.uid() and ca.access_status='active';
    if cid is null then raise exception 'Active client account required.' using errcode='42501'; end if;
    select * into q from public.autos_customer_quotes where id=p_quote_id and client_id=cid for update;
    if not found or not private.is_autos_enquiry_for_client(q.enquiry_id,cid) or q.status <> 'sent' then
        raise exception 'This quotation is unavailable for acceptance.' using errcode='42501';
    end if;
    update public.autos_customer_quotes set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=q.id;
    update public.autos_customer_quotes set status='superseded' where enquiry_id=q.enquiry_id and id<>q.id and status in ('sent','accepted');
    return q.id;
end;
$$;
revoke all on function public.accept_autos_quote(uuid) from public, anon;
grant execute on function public.accept_autos_quote(uuid) to authenticated;

create or replace function public.accept_autos_agreement(p_agreement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid; a public.autos_customer_agreements%rowtype;
begin
    select ca.client_id into cid from public.client_accounts ca where ca.auth_user_id=auth.uid() and ca.access_status='active';
    if cid is null then raise exception 'Active client account required.' using errcode='42501'; end if;
    select * into a from public.autos_customer_agreements where id=p_agreement_id and client_id=cid for update;
    if not found or not private.is_autos_enquiry_for_client(a.enquiry_id,cid) or a.status <> 'sent' then
        raise exception 'This agreement is unavailable for acceptance.' using errcode='42501';
    end if;
    update public.autos_customer_agreements set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=a.id;
    update public.autos_customer_agreements set status='superseded'
    where enquiry_id=a.enquiry_id and agreement_reference=a.agreement_reference and id<>a.id and status in ('sent','accepted');
    return a.id;
end;
$$;
revoke all on function public.accept_autos_agreement(uuid) from public, anon;
grant execute on function public.accept_autos_agreement(uuid) to authenticated;

create or replace function public.submit_autos_payment_reference(p_payment_id uuid,p_reference text,p_payment_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid; p public.autos_payment_requests%rowtype;
begin
    select ca.client_id into cid from public.client_accounts ca where ca.auth_user_id=auth.uid() and ca.access_status='active';
    if cid is null or nullif(btrim(p_reference),'') is null or length(p_reference)>160 then
        raise exception 'Active client and valid payment reference are required.' using errcode='22023';
    end if;
    select * into p from public.autos_payment_requests where id=p_payment_id and client_id=cid for update;
    if not found or not private.is_autos_enquiry_for_client(p.enquiry_id,cid) or p.status <> 'requested' then
        raise exception 'This payment request is unavailable for submission.' using errcode='42501';
    end if;
    perform pg_catalog.set_config('app.autos_payment_update','submitted',true);
    update public.autos_payment_requests set status='submitted',client_payment_reference=btrim(p_reference),client_payment_date=p_payment_date,submitted_at=now() where id=p.id;
    return p.id;
end;
$$;
revoke all on function public.submit_autos_payment_reference(uuid,text,date) from public, anon;
grant execute on function public.submit_autos_payment_reference(uuid,text,date) to authenticated;

create or replace function public.verify_autos_payment(p_payment_id uuid,p_receipt_number text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.autos_payment_requests%rowtype; reviewer_name text; receipt_id uuid;
begin
    if auth.uid() is null or not private.can_manage_autos() or nullif(btrim(p_receipt_number),'') is null then
        raise exception 'AUTOS payment verification permission and a receipt number are required.' using errcode='42501';
    end if;
    select * into p from public.autos_payment_requests where id=p_payment_id for update;
    if not found or not private.is_autos_enquiry_for_client(p.enquiry_id,p.client_id) or p.status <> 'submitted' then
        raise exception 'Only a submitted AUTOS payment can be verified.' using errcode='22023';
    end if;
    select coalesce(nullif(btrim(display_name),''),auth.uid()::text) into reviewer_name
    from public.staff_profiles where user_id=auth.uid();
    perform pg_catalog.set_config('app.autos_payment_update','verified',true);
    update public.autos_payment_requests set status='verified',verified_by=auth.uid(),verified_by_name=coalesce(reviewer_name,auth.uid()::text),verified_at=now() where id=p.id;
    insert into public.autos_customer_receipts(payment_request_id,receipt_number,amount_paid,currency,issued_by)
    values(p.id,btrim(p_receipt_number),p.amount,p.currency,auth.uid()) returning id into receipt_id;
    return receipt_id;
end;
$$;
revoke all on function public.verify_autos_payment(uuid,text) from public, anon;
grant execute on function public.verify_autos_payment(uuid,text) to authenticated;

commit;
