
-- REVIEW ONLY. Allows authorised Finance staff to record and verify ordinary
-- service payments directly against a request.
-- Existing submissions, payments, history and receipts remain intact.
-- Historical pending submissions do not block direct Finance verification.
-- Do not apply without production review.

begin;

create or replace function public.verify_client_service_payment_request(
    p_request_id uuid,
    p_verification_key uuid,
    p_amount_received numeric,
    p_payment_method text,
    p_payment_reference text,
    p_payment_date date,
    p_finance_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    request_row public.client_service_payment_requests%rowtype;
    payment_row public.client_service_payment_submissions%rowtype;
    saved_receipt public.client_service_payment_receipts%rowtype;
    total_received numeric(14,2);
    previous_request_status text;
    reviewer_name text;
    saved_reference text;
begin
    if auth.uid() is null
       or not private.has_finance_permission('finance.verify') then
        raise exception 'Finance verification permission is required.'
            using errcode = '42501';
    end if;

    if p_request_id is null
       or p_verification_key is null
       or p_amount_received is null
       or p_amount_received <= 0
       or p_amount_received <> pg_catalog.round(p_amount_received,2)
       or p_payment_method is null
       or p_payment_method not in (
           'Bank Transfer','Mobile Money','Card','Cash','Other'
       )
       or p_payment_date is null
       or p_payment_date > current_date
       or pg_catalog.length(coalesce(p_payment_reference,'')) > 200
       or pg_catalog.length(coalesce(p_finance_note,'')) > 4000 then
        raise exception 'Enter a valid received amount, method, payment date and note.'
            using errcode = '22023';
    end if;

    select *
    into request_row
    from public.client_service_payment_requests
    where id = p_request_id
    for update;

    if not found
       or request_row.status in ('paid','cancelled') then
        raise exception 'Payment request not found or no longer outstanding.'
            using errcode = '42501';
    end if;

    saved_reference := coalesce(
        nullif(pg_catalog.btrim(p_payment_reference),''),
        'FINANCE-' || p_verification_key::text
    );

    -- Idempotency: return the existing verified payment and receipt
    -- if this verification key has already been successfully processed.
    select *
    into payment_row
    from public.client_service_payment_submissions
    where client_id = request_row.client_id
      and submission_key = p_verification_key;

    if found then
        if payment_row.request_id <> request_row.id
           or payment_row.status <> 'verified'
           or payment_row.amount_received <> p_amount_received
           or payment_row.payment_method <> p_payment_method
           or payment_row.payment_date <> p_payment_date
           or payment_row.transaction_reference <> saved_reference then
            raise exception 'This verification key was already used for a different payment.'
                using errcode = '23505';
        end if;

        select *
        into saved_receipt
        from public.client_service_payment_receipts
        where payment_id = payment_row.id;

        return pg_catalog.jsonb_build_object(
            'payment',pg_catalog.to_jsonb(payment_row),
            'receipt',case
                when saved_receipt.id is null then null
                else pg_catalog.to_jsonb(saved_receipt)
            end,
            'already_verified',true
        );
    end if;

    -- Historical client submissions are preserved.
    -- They do not prevent Finance from independently recording
    -- and verifying a confirmed payment.

    select coalesce(sum(p.amount_received),0)
    into total_received
    from public.client_service_payment_submissions p
    where p.request_id = request_row.id
      and p.status = 'verified';

    if p_amount_received > request_row.amount - total_received then
        raise exception 'Received amount exceeds the outstanding request balance.'
            using errcode = '22023';
    end if;

    select nullif(pg_catalog.btrim(sp.display_name),'')
    into reviewer_name
    from public.staff_profiles sp
    where sp.user_id = auth.uid();

    insert into public.client_service_payment_submissions (
        request_id,
        client_id,
        submission_key,
        amount_submitted,
        amount_received,
        currency,
        payment_method,
        transaction_reference,
        payment_date,
        status,
        verified_by,
        verified_by_name,
        verified_at,
        verification_note
    )
    values (
        request_row.id,
        request_row.client_id,
        p_verification_key,
        p_amount_received,
        p_amount_received,
        request_row.currency,
        p_payment_method,
        saved_reference,
        p_payment_date,
        'verified',
        auth.uid(),
        coalesce(reviewer_name,'Finance'),
        pg_catalog.now(),
        coalesce(pg_catalog.btrim(p_finance_note),'')
    )
    returning * into payment_row;

    insert into public.client_service_payment_receipts (
        payment_id,
        request_id,
        client_id,
        receipt_number,
        amount_paid,
        currency,
        payment_method,
        payment_reference,
        payment_date,
        issued_by,
        issued_by_name,
        notes
    )
    values (
        payment_row.id,
        request_row.id,
        request_row.client_id,
        'LBC-RCP-' ||
            pg_catalog.to_char(pg_catalog.now(),'YYYY') || '-' ||
            pg_catalog.upper(
                pg_catalog.substr(
                    pg_catalog.replace(
                        pg_catalog.gen_random_uuid()::text,'-',''
                    ),1,12
                )
            ),
        p_amount_received,
        request_row.currency,
        p_payment_method,
        coalesce(
            nullif(pg_catalog.btrim(p_payment_reference),''),
            'Recorded by Finance'
        ),
        p_payment_date,
        auth.uid(),
        coalesce(reviewer_name,'Finance'),
        coalesce(pg_catalog.btrim(p_finance_note),'')
    )
    returning * into saved_receipt;

    -- Capture the actual request status before changing it.
    previous_request_status := request_row.status;

    insert into public.client_service_payment_history (
        request_id,
        payment_id,
        actor_id,
        event,
        previous_status,
        new_status,
        details
    )
    values (
        request_row.id,
        payment_row.id,
        auth.uid(),
        'payment_verified',
        previous_request_status,
        'verified',
        pg_catalog.jsonb_build_object(
            'amount_received',p_amount_received,
            'currency',request_row.currency,
            'payment_method',p_payment_method,
            'payment_reference',coalesce(
                pg_catalog.btrim(p_payment_reference),''
            ),
            'payment_date',p_payment_date,
            'receipt_number',saved_receipt.receipt_number,
            'finance_note',coalesce(
                pg_catalog.btrim(p_finance_note),''
            )
        )
    );

    select coalesce(sum(p.amount_received),0)
    into total_received
    from public.client_service_payment_submissions p
    where p.request_id = request_row.id
      and p.status = 'verified';

    update public.client_service_payment_requests
    set status = case
            when total_received >= amount then 'paid'
            else 'partially_paid'
        end,
        updated_at = pg_catalog.now()
    where id = request_row.id
    returning * into request_row;

    if request_row.status is distinct from previous_request_status then
        insert into public.client_service_payment_history (
            request_id,
            payment_id,
            actor_id,
            event,
            previous_status,
            new_status
        )
        values (
            request_row.id,
            payment_row.id,
            auth.uid(),
            'request_status_changed',
            previous_request_status,
            request_row.status
        );
    end if;

    return pg_catalog.jsonb_build_object(
        'payment',pg_catalog.to_jsonb(payment_row),
        'request',pg_catalog.to_jsonb(request_row),
        'receipt',pg_catalog.to_jsonb(saved_receipt),
        'already_verified',false
    );
end;
$$;

revoke all on function
    public.verify_client_service_payment_request(
        uuid,uuid,numeric,text,text,date,text
    )
    from public, anon, authenticated;

grant execute on function
    public.verify_client_service_payment_request(
        uuid,uuid,numeric,text,text,date,text
    )
    to authenticated;

-- Prevent new client self-report submissions.
-- Historical submissions and their existing records are retained.
revoke all on function
    public.submit_client_service_payment(uuid,uuid,numeric,text,text,date)
    from public, anon, authenticated;

commit;
