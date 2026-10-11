-- Shared initial assessment payment, consultation scheduling, and client notices.

-- Existing UUID client identities and local Finance records remain untouched.

do $$

begin

    if to_regclass('public.clients') is null

        or to_regclass('public.client_accounts') is null

        or to_regclass('public.staff_profiles') is null

        or to_regprocedure('private.has_permission(text)') is null

        or to_regprocedure('private.can_access_client(uuid)') is null

        or to_regprocedure('private.current_client_id()') is null

        or to_regprocedure('private.current_limited_client_id()') is null then

        raise exception 'Apply the identity and limited-access migrations before this migration.';

    end if;

end;

$$;

insert into public.permissions (permission_code, description)

values ('consultations.manage', 'Schedule, reschedule, and cancel client consultations.')

on conflict (permission_code) do update

set description = excluded.description;

create table public.client_assessment_payments (

    id uuid primary key default gen_random_uuid(),

    client_id uuid not null unique references public.clients(id) on delete restrict,

    client_name text not null,

    reference text not null unique default ('LBC-AS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),

    purpose text not null default 'initial_assessment_consultation',

        check (purpose = 'initial_assessment_consultation'),

    amount numeric(12,2) not null default 1000 check (amount = 1000),

    currency text not null default 'GHS' check (currency = 'GHS'),

    status text not null default 'requested',

        check (status in ('requested', 'awaiting_verification', 'paid', 'rejected', 'cancelled')),

    verification_status text not null default 'not_verified',

        check (verification_status in ('not_verified', 'pending', 'verified', 'rejected')),

    payment_instructions text,

    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    client_payment_submitted_at timestamptz,

    client_payment_date date,

    client_payment_reference text,

    verified_by uuid references public.staff_profiles(user_id) on delete restrict,

    verified_at timestamptz,

    amount_received numeric(12,2),

    payment_date date,

    transaction_reference text,

    finance_note text,

    constraint client_assessment_verified_fields_check check (

        (verification_status = 'verified' and status = 'paid' and verified_at is not null and verified_by is not null and amount_received >= amount)

        or verification_status <> 'verified'

    )

);

create table public.client_consultation_meetings (

    id uuid primary key default gen_random_uuid(),

    client_id uuid not null unique references public.clients(id) on delete restrict,

    assessment_payment_id uuid not null unique references public.client_assessment_payments(id) on delete restrict,

    status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),

    starts_at timestamptz not null,

    timezone text not null,

    duration_minutes integer not null default 30 check (duration_minutes between 15 and 120),

    mode text not null check (mode in ('online', 'phone', 'in_person')),

    location text,

    meeting_link text,

    instructions text,

    revision integer not null default 1 check (revision > 0),

    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,

    updated_by uuid not null references public.staff_profiles(user_id) on delete restrict,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    cancelled_at timestamptz

);

create table public.client_consultation_notifications (

    id uuid primary key default gen_random_uuid(),

    client_id uuid not null references public.clients(id) on delete restrict,

    meeting_id uuid not null references public.client_consultation_meetings(id) on delete restrict,

    revision integer not null,

    event_type text not null check (event_type in ('scheduled', 'rescheduled', 'cancelled')),

    title text not null,

    message text not null,

    created_at timestamptz not null default now(),

    read_at timestamptz,

    unique (meeting_id, revision, event_type)

);

create table public.client_consultation_email_outbox (

    id uuid primary key default gen_random_uuid(),

    notification_id uuid not null unique references public.client_consultation_notifications(id) on delete restrict,

    client_id uuid not null references public.clients(id) on delete restrict,

    status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),

    attempt_count integer not null default 0 check (attempt_count >= 0),

    last_error text,

    provider_message_id text,

    sent_at timestamptz,

    updated_at timestamptz not null default now()

);

create index client_assessment_payments_client_status_idx

    on public.client_assessment_payments (client_id, status);

create index client_consultation_meetings_client_status_idx

    on public.client_consultation_meetings (client_id, status);

create index client_consultation_notifications_client_created_idx

    on public.client_consultation_notifications (client_id, created_at desc);

drop trigger if exists client_assessment_payments_set_updated_at on public.client_assessment_payments;

create trigger client_assessment_payments_set_updated_at

before update on public.client_assessment_payments

for each row execute function private.set_updated_at();

drop trigger if exists client_consultation_meetings_set_updated_at on public.client_consultation_meetings;

create trigger client_consultation_meetings_set_updated_at

before update on public.client_consultation_meetings

for each row execute function private.set_updated_at();

alter table public.client_assessment_payments enable row level security;

alter table public.client_consultation_meetings enable row level security;

alter table public.client_consultation_notifications enable row level security;

alter table public.client_consultation_email_outbox enable row level security;

revoke all on public.client_assessment_payments,

    public.client_consultation_meetings,

    public.client_consultation_notifications,

    public.client_consultation_email_outbox from public, anon;

grant select on public.client_assessment_payments,

    public.client_consultation_meetings,

    public.client_consultation_notifications to authenticated;

grant select on public.client_consultation_email_outbox to authenticated;

grant all on public.client_assessment_payments,

    public.client_consultation_meetings,

    public.client_consultation_notifications,

    public.client_consultation_email_outbox to service_role;

create policy client_assessment_payments_finance_read

on public.client_assessment_payments for select to authenticated

using (private.has_permission('finance.read'));

create policy client_consultation_meetings_staff_read

on public.client_consultation_meetings for select to authenticated

using (

    private.has_permission('consultations.manage')

    and private.can_access_client(client_id)

);

create policy client_consultation_notifications_read

on public.client_consultation_notifications for select to authenticated

using (

    private.current_client_id() = client_id

    or private.current_limited_client_id() = client_id

    or (private.has_permission('messages.read') and private.can_access_client(client_id))

);

create policy client_consultation_email_outbox_staff_read

on public.client_consultation_email_outbox for select to authenticated

using (

    private.has_permission('consultations.manage')

    and private.can_access_client(client_id)

);

-- Safe client projections are owner-rights views with explicit ownership predicates.

create view public.client_assessment_payment_status

with (security_barrier = true)

as

select

    p.id, p.client_id, p.reference, p.purpose, p.amount, p.currency,

    p.status, p.verification_status, p.payment_instructions, p.created_at,

    p.updated_at, p.client_payment_submitted_at, p.client_payment_date,

    p.client_payment_reference, p.verified_at, p.amount_received,

    p.payment_date, p.transaction_reference

from public.client_assessment_payments p

where p.client_id = private.current_client_id()

   or p.client_id = private.current_limited_client_id();

create view public.client_consultation_meeting_status

with (security_barrier = true)

as

select

    m.id, m.client_id, m.status, m.starts_at, m.timezone,

    m.duration_minutes, m.mode, m.location, m.meeting_link,

    m.instructions, m.revision, m.cancelled_at

from public.client_consultation_meetings m

where m.client_id = private.current_client_id()

   or m.client_id = private.current_limited_client_id();

revoke all on public.client_assessment_payment_status,

    public.client_consultation_meeting_status from public, anon;

grant select on public.client_assessment_payment_status,

    public.client_consultation_meeting_status to authenticated;

create or replace function public.request_initial_assessment_payment(p_client_id uuid)

returns jsonb

language plpgsql

security definer

set search_path = pg_catalog, public, auth, private

as $$

declare

    client_record public.clients%rowtype;

    payment_record public.client_assessment_payments%rowtype;

begin

    if auth.uid() is null or not private.has_permission('finance.requests') then

        raise exception 'Finance payment-request permission is required.' using errcode = '42501';

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

    if found then

        return jsonb_build_object('created', false, 'payment', to_jsonb(payment_record));

    end if;

    insert into public.client_assessment_payments (

        client_id, client_name, created_by

    ) values (

        p_client_id,

        coalesce(nullif(client_record.full_name, ''), 'Client'),

        auth.uid()

    )

    on conflict (client_id) do nothing

    returning * into payment_record;

    if not found then

        select * into payment_record

        from public.client_assessment_payments p

        where p.client_id = p_client_id;

        return jsonb_build_object('created', false, 'payment', to_jsonb(payment_record));

    end if;

    return jsonb_build_object('created', true, 'payment', to_jsonb(payment_record));

end;

$$;

create or replace function public.submit_initial_assessment_payment(

    p_payment_id uuid,

    p_payment_date date,

    p_transaction_reference text

)

returns jsonb

language plpgsql

security definer

set search_path = pg_catalog, public, auth, private

as $$

declare

    own_client_id uuid;

    payment_record public.client_assessment_payments%rowtype;

begin

    if auth.uid() is null then

        raise exception 'Authentication is required.' using errcode = '42501';

    end if;

    own_client_id := coalesce(private.current_client_id(), private.current_limited_client_id());

    if own_client_id is null then

        raise exception 'An active or limited client account is required.' using errcode = '42501';

    end if;

    if p_payment_date is null or nullif(trim(p_transaction_reference), '') is null then

        raise exception 'Enter the payment date and transaction reference.' using errcode = '22023';

    end if;

    if p_payment_date > current_date or length(trim(p_transaction_reference)) > 160 then

        raise exception 'Enter a valid payment date and transaction reference.' using errcode = '22023';

    end if;

    update public.client_assessment_payments p

    set status = 'awaiting_verification',

        verification_status = 'pending',

        client_payment_submitted_at = coalesce(p.client_payment_submitted_at, now()),

        client_payment_date = p_payment_date,

        client_payment_reference = trim(p_transaction_reference),

        updated_at = now()

    where p.id = p_payment_id

      and p.client_id = own_client_id

      and p.status = 'requested'

    returning * into payment_record;

    if not found then

        select * into payment_record

        from public.client_assessment_payments p

        where p.id = p_payment_id and p.client_id = own_client_id;

        if not found or payment_record.status not in ('awaiting_verification', 'paid') then

            raise exception 'This assessment request cannot be submitted.' using errcode = '42501';

        end if;

    end if;

    return to_jsonb(payment_record);

end;

$$;

create or replace function public.set_initial_assessment_payment_instructions(

    p_payment_id uuid,

    p_payment_instructions text

)

returns jsonb

language plpgsql

security definer

set search_path = pg_catalog, public, auth, private

as $$

declare

    payment_record public.client_assessment_payments%rowtype;

begin

    if auth.uid() is null or not private.has_permission('finance.requests') then

        raise exception 'Finance payment-request permission is required.' using errcode = '42501';

    end if;

    if nullif(trim(coalesce(p_payment_instructions, '')), '') is null

        or length(trim(p_payment_instructions)) > 2000 then

        raise exception 'Enter approved payment instructions of 1 to 2,000 characters.' using errcode = '22023';

    end if;

    select * into payment_record

    from public.client_assessment_payments p

    where p.id = p_payment_id

    for update;

    if not found then

        raise exception 'The assessment payment request was not found.' using errcode = 'P0002';

    end if;

    if payment_record.status <> 'requested' then

        raise exception 'Payment instructions can only be changed before the client submits payment.' using errcode = '22023';

    end if;

    update public.client_assessment_payments p

    set payment_instructions = trim(p_payment_instructions), updated_at = now()

    where p.id = p_payment_id

    returning * into payment_record;

    return to_jsonb(payment_record);

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

begin

    if auth.uid() is null or not private.has_permission('finance.verify') then

        raise exception 'Finance verification permission is required.' using errcode = '42501';

    end if;

    if p_amount_received is null or p_amount_received < 1000

        or p_payment_date is null or nullif(trim(p_transaction_reference), '') is null then

        raise exception 'Verify the full GHS 1,000 receipt, payment date, and transaction reference.' using errcode = '22023';

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

    update public.client_assessment_payments p

    set status = 'paid',

        verification_status = 'verified',

        verified_by = auth.uid(),

        verified_at = now(),

        amount_received = p_amount_received,

        payment_date = p_payment_date,

        transaction_reference = trim(p_transaction_reference),

        finance_note = nullif(trim(coalesce(p_finance_note, '')), ''),

        updated_at = now()

    where p.id = p_payment_id

    returning * into payment_record;

    -- Only an already password-configured limited account becomes active here.

    update public.client_accounts ca

    set access_status = 'active',

        activated_at = coalesce(ca.activated_at, now()),

        updated_at = now()

    where ca.client_id = payment_record.client_id

      and ca.access_status = 'activation_required';

    return jsonb_build_object('payment', to_jsonb(payment_record), 'already_verified', false);

end;

$$;

create or replace function public.schedule_client_consultation(

    p_client_id uuid,

    p_local_start timestamp without time zone,

    p_timezone text,

    p_duration_minutes integer default 30,

    p_mode text default 'online',

    p_location text default null,

    p_meeting_link text default null,

    p_instructions text default null

)

returns jsonb

language plpgsql

security definer

set search_path = pg_catalog, public, auth, private

as $$

declare

    meeting_record public.client_consultation_meetings%rowtype;

    old_record public.client_consultation_meetings%rowtype;

    notification_record public.client_consultation_notifications%rowtype;

    event_kind text;

    message_body text;

    meeting_start timestamptz;

    had_meeting boolean := false;

begin

    if auth.uid() is null or not private.has_permission('consultations.manage')

        or not private.can_access_client(p_client_id) then

        raise exception 'Authorized Admin access to this client is required.' using errcode = '42501';

    end if;

    if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then

        raise exception 'Choose a valid IANA timezone.' using errcode = '22023';

    end if;

    if p_local_start is null or p_local_start <= (now() at time zone p_timezone) then

        raise exception 'Choose a future consultation time.' using errcode = '22023';

    end if;

    if p_duration_minutes is null or p_duration_minutes not between 15 and 120 then

        raise exception 'Consultation duration must be between 15 and 120 minutes.' using errcode = '22023';

    end if;

    if p_mode is null or p_mode not in ('online', 'phone', 'in_person') then

        raise exception 'Choose a supported consultation mode.' using errcode = '22023';

    end if;

    if not exists (

        select 1 from public.client_assessment_payments p

        where p.client_id = p_client_id

          and p.status = 'paid'

          and p.verification_status = 'verified'

    ) then

        raise exception 'Consultation scheduling is available after Finance verifies the assessment payment.' using errcode = '42501';

    end if;

    meeting_start := p_local_start at time zone p_timezone;

    select * into old_record

    from public.client_consultation_meetings m

    where m.client_id = p_client_id

    for update;

    had_meeting := found;

    if had_meeting

        and old_record.status = 'scheduled'

        and old_record.starts_at = meeting_start

        and old_record.timezone = p_timezone

        and old_record.duration_minutes = p_duration_minutes

        and old_record.mode = p_mode

        and old_record.location is not distinct from nullif(trim(coalesce(p_location, '')), '')

        and old_record.meeting_link is not distinct from nullif(trim(coalesce(p_meeting_link, '')), '')

        and old_record.instructions is not distinct from nullif(trim(coalesce(p_instructions, '')), '') then

        select * into notification_record

        from public.client_consultation_notifications n

        where n.meeting_id = old_record.id and n.revision = old_record.revision

        order by n.created_at desc limit 1;

        return jsonb_build_object('meeting', to_jsonb(old_record), 'notification_id', notification_record.id, 'unchanged', true);

    end if;

    if had_meeting then

        event_kind := case when old_record.status = 'scheduled' then 'rescheduled' else 'scheduled' end;

        update public.client_consultation_meetings m

        set status = 'scheduled',

            starts_at = meeting_start,

            timezone = p_timezone,

            duration_minutes = p_duration_minutes,

            mode = p_mode,

            location = nullif(trim(coalesce(p_location, '')), ''),

            meeting_link = nullif(trim(coalesce(p_meeting_link, '')), ''),

            instructions = nullif(trim(coalesce(p_instructions, '')), ''),

            revision = m.revision + 1,

            updated_by = auth.uid(),

            cancelled_at = null

        where m.id = old_record.id

        returning * into meeting_record;

    else

        event_kind := 'scheduled';

        insert into public.client_consultation_meetings (

            client_id, assessment_payment_id, starts_at, timezone,

            duration_minutes, mode, location, meeting_link, instructions,

            created_by, updated_by

        )

        select p_client_id, p.id, meeting_start, p_timezone,

            p_duration_minutes, p_mode, nullif(trim(coalesce(p_location, '')), ''),

            nullif(trim(coalesce(p_meeting_link, '')), ''),

            nullif(trim(coalesce(p_instructions, '')), ''), auth.uid(), auth.uid()

        from public.client_assessment_payments p

        where p.client_id = p_client_id

        returning * into meeting_record;

    end if;

    message_body := 'Your Initial Assessment & 30-Minute Consultation has been ' || event_kind || ' for ' ||

        to_char(meeting_record.starts_at at time zone meeting_record.timezone, 'FMDay, DD FMMonth YYYY "at" HH12:MI AM') ||

        ' (' || meeting_record.timezone || '). Duration: ' || meeting_record.duration_minutes || ' minutes. Mode: ' ||

        replace(meeting_record.mode, '_', ' ') || '.' ||

        case when meeting_record.location is not null then E'\nLocation: ' || meeting_record.location else '' end ||

        case when meeting_record.meeting_link is not null then E'\nMeeting link: ' || meeting_record.meeting_link else '' end ||

        case when meeting_record.instructions is not null then E'\nInstructions: ' || meeting_record.instructions else '' end;

    insert into public.client_consultation_notifications (

        client_id, meeting_id, revision, event_type, title, message

    ) values (

        p_client_id, meeting_record.id, meeting_record.revision, event_kind,

        case event_kind when 'rescheduled' then 'Consultation Rescheduled' else 'Consultation Scheduled' end,

        message_body

    ) returning * into notification_record;

    insert into public.client_consultation_email_outbox (notification_id, client_id)

    values (notification_record.id, p_client_id)

    on conflict (notification_id) do nothing;

    return jsonb_build_object('meeting', to_jsonb(meeting_record), 'notification_id', notification_record.id, 'unchanged', false);

end;

$$;

create or replace function public.cancel_client_consultation(

    p_client_id uuid,

    p_reason text default null

)

returns jsonb

language plpgsql

security definer

set search_path = pg_catalog, public, auth, private

as $$

declare

    meeting_record public.client_consultation_meetings%rowtype;

    notification_record public.client_consultation_notifications%rowtype;

    message_body text;

begin

    if auth.uid() is null or not private.has_permission('consultations.manage')

        or not private.can_access_client(p_client_id) then

        raise exception 'Authorized Admin access to this client is required.' using errcode = '42501';

    end if;

    select * into meeting_record

    from public.client_consultation_meetings m

    where m.client_id = p_client_id

    for update;

    if not found then

        raise exception 'No consultation is scheduled for this client.' using errcode = 'P0002';

    end if;

    if meeting_record.status = 'cancelled' then

        select * into notification_record

        from public.client_consultation_notifications n

        where n.meeting_id = meeting_record.id and n.revision = meeting_record.revision and n.event_type = 'cancelled';

        return jsonb_build_object('meeting', to_jsonb(meeting_record), 'notification_id', notification_record.id, 'unchanged', true);

    end if;

    update public.client_consultation_meetings m

    set status = 'cancelled', revision = m.revision + 1,

        updated_by = auth.uid(), cancelled_at = now()

    where m.id = meeting_record.id

    returning * into meeting_record;

    message_body := 'Your Initial Assessment & 30-Minute Consultation scheduled for ' ||

        to_char(meeting_record.starts_at at time zone meeting_record.timezone, 'FMDay, DD FMMonth YYYY "at" HH12:MI AM') ||

        ' (' || meeting_record.timezone || ') has been cancelled.' ||

        case when nullif(trim(coalesce(p_reason, '')), '') is not null then E'\n' || trim(p_reason) else '' end;

    insert into public.client_consultation_notifications (

        client_id, meeting_id, revision, event_type, title, message

    ) values (

        p_client_id, meeting_record.id, meeting_record.revision, 'cancelled',

        'Consultation Cancelled', message_body

    ) returning * into notification_record;

    insert into public.client_consultation_email_outbox (notification_id, client_id)

    values (notification_record.id, p_client_id)

    on conflict (notification_id) do nothing;

    return jsonb_build_object('meeting', to_jsonb(meeting_record), 'notification_id', notification_record.id, 'unchanged', false);

end;

$$;

create or replace function public.mark_client_consultation_notification_read(p_notification_id uuid)

returns boolean

language plpgsql

security definer

set search_path = pg_catalog, public, auth, private

as $$

declare

    own_client_id uuid;

begin

    if auth.uid() is null then

        raise exception 'Authentication is required.' using errcode = '42501';

    end if;

    own_client_id := coalesce(private.current_client_id(), private.current_limited_client_id());

    if own_client_id is null then

        raise exception 'An active or limited client account is required.' using errcode = '42501';

    end if;
////

    set read_at = coalesce(n.read_at, now())

    where n.id = p_notification_id and n.client_id = own_client_id;

    return found;

end;

$$;

revoke all on function public.request_initial_assessment_payment(uuid) from public, anon;

revoke all on function public.submit_initial_assessment_payment(uuid, date, text) from public, anon;

revoke all on function public.set_initial_assessment_payment_instructions(uuid, text) from public, anon;

revoke all on function public.verify_initial_assessment_payment(uuid, numeric, date, text, text) from public, anon;

revoke all on function public.schedule_client_consultation(uuid, timestamp without time zone, text, integer, text, text, text, text) from public, anon;

revoke all on function public.cancel_client_consultation(uuid, text) from public, anon;

revoke all on function public.mark_client_consultation_notification_read(uuid) from public, anon;
grant execute on function public.request_initial_assessment_payment(uuid) to authenticated;

grant execute on function public.submit_initial_assessment_payment(uuid, date, text) to authenticated;

grant execute on function public.set_initial_assessment_payment_instructions(uuid, text) to authenticated;

grant execute on function public.verify_initial_assessment_payment(uuid, numeric, date, text, text) to authenticated;

grant execute on function public.schedule_client_consultation(uuid, timestamp without time zone, text, integer, text, text, text, text) to authenticated;

grant execute on function public.cancel_client_consultation(uuid, text) to authenticated;

grant execute on function public.mark_client_consultation_notification_read(uuid) to authenticated;
