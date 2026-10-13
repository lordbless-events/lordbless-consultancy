-- Persistent client appointments with portal messages.
-- The assessment consultation workflow remains in its existing tables/functions.

create table if not exists public.client_appointments (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    title text not null check (length(btrim(title)) > 0),
    starts_at timestamptz not null,
    timezone text not null,
    duration_minutes integer not null default 30
        check (duration_minutes between 15 and 480),
    channel text not null default 'online'
        check (channel in ('online', 'phone', 'in_person', 'whatsapp')),
    location text,
    meeting_link text,
    instructions text,
    status text not null default 'scheduled'
        check (status in ('scheduled', 'cancelled', 'completed')),
    revision integer not null default 1 check (revision > 0),
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    updated_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists client_appointments_client_start_idx
    on public.client_appointments (client_id, starts_at desc);

drop trigger if exists client_appointments_set_updated_at on public.client_appointments;
create trigger client_appointments_set_updated_at
before update on public.client_appointments
for each row execute function private.set_updated_at();

create table if not exists public.client_appointment_notifications (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    appointment_id uuid not null references public.client_appointments(id) on delete cascade,
    event_type text not null
        check (event_type in ('scheduled', 'rescheduled', 'cancelled', 'completed')),
    title text not null,
    message text not null,
    created_at timestamptz not null default now(),
    read_at timestamptz
);

create index if not exists client_appointment_notifications_client_created_idx
    on public.client_appointment_notifications (client_id, created_at desc);

alter table public.client_appointments enable row level security;
alter table public.client_appointment_notifications enable row level security;
revoke all on public.client_appointments from public, anon;
revoke all on public.client_appointment_notifications from public, anon;
grant select on public.client_appointments to authenticated;
grant select on public.client_appointment_notifications to authenticated;

drop policy if exists client_appointments_read_client_or_staff on public.client_appointments;
create policy client_appointments_read_client_or_staff
on public.client_appointments for select to authenticated
using (
    private.current_client_id() = client_id
    or private.is_overall_admin()
    or (
        private.has_permission('consultations.manage')
        and private.can_access_client(client_id)
    )
);

drop policy if exists client_appointment_notifications_read_client_or_staff on public.client_appointment_notifications;
create policy client_appointment_notifications_read_client_or_staff
on public.client_appointment_notifications for select to authenticated
using (
    private.current_client_id() = client_id
    or private.is_overall_admin()
    or (
        private.has_permission('consultations.manage')
        and private.can_access_client(client_id)
    )
);

create or replace function public.save_client_appointment(
    p_client_id uuid,
    p_appointment_id uuid,
    p_title text,
    p_local_start timestamp without time zone,
    p_timezone text,
    p_duration_minutes integer,
    p_channel text,
    p_location text default null,
    p_meeting_link text default null,
    p_instructions text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    appointment_row public.client_appointments%rowtype;
    event_name text;
    notification_id uuid;
    formatted_start text;
begin
    if auth.uid() is null or not private.has_permission('consultations.manage')
       or not private.can_access_client(p_client_id) then
        raise exception 'Consultation management permission is required for this client.' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.client_accounts ca
        where ca.client_id = p_client_id and ca.access_status = 'active'
    ) then
        raise exception 'Appointments can be scheduled after the client account is active.' using errcode = '42501';
    end if;

    if p_title is null or length(btrim(p_title)) = 0
       or pg_catalog.lower(btrim(p_title)) like '%initial assessment%'
       or p_timezone is null or length(btrim(p_timezone)) = 0
       or p_local_start is null
       or p_local_start at time zone p_timezone <= pg_catalog.now()
       or p_duration_minutes not between 15 and 480
       or p_channel not in ('online', 'phone', 'in_person', 'whatsapp') then
        raise exception 'Provide valid future appointment details.' using errcode = '22023';
    end if;

    if p_appointment_id is null then
        insert into public.client_appointments (
            client_id, title, starts_at, timezone, duration_minutes,
            channel, location, meeting_link, instructions, created_by, updated_by
        ) values (
            p_client_id, btrim(p_title), p_local_start at time zone p_timezone,
            btrim(p_timezone), p_duration_minutes, p_channel,
            nullif(btrim(coalesce(p_location, '')), ''),
            nullif(btrim(coalesce(p_meeting_link, '')), ''),
            nullif(btrim(coalesce(p_instructions, '')), ''), auth.uid(), auth.uid()
        ) returning * into appointment_row;
        event_name := 'scheduled';
    else
        select * into appointment_row
        from public.client_appointments
        where id = p_appointment_id and client_id = p_client_id
        for update;

        if not found then
            raise exception 'Appointment not found for this client.' using errcode = 'P0002';
        end if;

        if appointment_row.status <> 'scheduled' then
            raise exception 'Only scheduled appointments can be changed.' using errcode = '22023';
        end if;

        update public.client_appointments
        set title = btrim(p_title),
            starts_at = p_local_start at time zone p_timezone,
            timezone = btrim(p_timezone),
            duration_minutes = p_duration_minutes,
            channel = p_channel,
            location = nullif(btrim(coalesce(p_location, '')), ''),
            meeting_link = nullif(btrim(coalesce(p_meeting_link, '')), ''),
            instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
            revision = revision + 1,
            updated_by = auth.uid()
        where id = p_appointment_id
        returning * into appointment_row;
        event_name := 'rescheduled';
    end if;

    formatted_start := pg_catalog.to_char(appointment_row.starts_at at time zone appointment_row.timezone, 'FMDay, DD Mon YYYY at HH12:MI AM');

    insert into public.client_appointment_notifications (
        client_id, appointment_id, event_type, title, message
    ) values (
        p_client_id,
        appointment_row.id,
        event_name,
        case when event_name = 'scheduled' then 'Appointment Scheduled' else 'Appointment Updated' end,
        case when event_name = 'scheduled'
            then 'Your appointment "' || appointment_row.title || '" is scheduled for ' || formatted_start || ' (' || appointment_row.timezone || ').'
            else 'Your appointment "' || appointment_row.title || '" has been rescheduled to ' || formatted_start || ' (' || appointment_row.timezone || ').'
        end
    ) returning id into notification_id;

    return pg_catalog.jsonb_build_object(
        'appointment', pg_catalog.to_jsonb(appointment_row),
        'notification_id', notification_id
    );
end;
$$;

create or replace function public.set_client_appointment_status(
    p_appointment_id uuid,
    p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    appointment_row public.client_appointments%rowtype;
    event_name text;
    notification_id uuid;
begin
    if auth.uid() is null or not private.has_permission('consultations.manage') then
        raise exception 'Consultation management permission is required.' using errcode = '42501';
    end if;
    if p_status not in ('cancelled', 'completed') then
        raise exception 'Unsupported appointment status.' using errcode = '22023';
    end if;

    update public.client_appointments
    set status = p_status, updated_by = auth.uid()
    where id = p_appointment_id
      and status = 'scheduled'
      and private.can_access_client(client_id)
    returning * into appointment_row;

    if not found then
        raise exception 'Scheduled appointment not found or access denied.' using errcode = '42501';
    end if;

    event_name := p_status;
    insert into public.client_appointment_notifications (
        client_id, appointment_id, event_type, title, message
    ) values (
        appointment_row.client_id,
        appointment_row.id,
        event_name,
        case when p_status = 'cancelled' then 'Appointment Cancelled' else 'Appointment Completed' end,
        case when p_status = 'cancelled'
            then 'Your appointment "' || appointment_row.title || '" has been cancelled. Contact LORDBLESS CONSULTANCY if you need assistance.'
            else 'Your appointment "' || appointment_row.title || '" has been marked as completed.'
        end
    ) returning id into notification_id;

    return notification_id;
end;
$$;

create or replace function public.mark_client_appointment_notification_read(p_notification_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.client_appointment_notifications
    set read_at = coalesce(read_at, pg_catalog.now())
    where id = p_notification_id
      and client_id = private.current_client_id();
$$;

revoke all on function public.save_client_appointment(uuid, uuid, text, timestamp without time zone, text, integer, text, text, text, text) from public, anon;
revoke all on function public.set_client_appointment_status(uuid, text) from public, anon;
revoke all on function public.mark_client_appointment_notification_read(uuid) from public, anon;
grant execute on function public.save_client_appointment(uuid, uuid, text, timestamp without time zone, text, integer, text, text, text, text) to authenticated;
grant execute on function public.set_client_appointment_status(uuid, text) to authenticated;
grant execute on function public.mark_client_appointment_notification_read(uuid) to authenticated;
