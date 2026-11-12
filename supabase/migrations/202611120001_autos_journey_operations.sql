-- AUTOS stages and private journey change history.
-- Additive and backward-compatible: existing journeys and their current stage
-- values are retained. Apply only after confirming the base stage migration.

do $$
begin
    if to_regclass('public.client_journeys') is null
       or not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'client_journeys'
              and column_name = 'stage'
       )
       or not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'client_journeys'
              and column_name = 'operational_status'
       ) then
        raise exception 'The client journey stage and operational status migration must be applied first.';
    end if;

    if exists (
        select 1 from public.client_journeys
        where stage not in (
            'enquiry','assessment','planning','preparation','applications_approvals',
            'visa_processing','travel','arrival','completed',
            'enquiry_received','enquiry_reviewed','availability_confirmation',
            'quotation_preparation','quotation_sent','awaiting_customer_decision',
            'order_confirmed','payment_processing','vehicle_sourcing',
            'inspection_documentation','shipping_preparation','in_transit',
            'arrived_in_ghana','customs_clearing','delivery_arrangements',
            'delivered','autos_completed'
        )
        or operational_status not in ('active','on_hold','completed','cancelled','unsuccessful')
    ) then
        raise exception 'A current journey uses an unmapped stage or operational status; no data was changed.';
    end if;
end;
$$;

alter table public.client_journeys
    drop constraint if exists client_journeys_stage_check,
    drop constraint if exists client_journeys_operational_status_check;

alter table public.client_journeys
    add constraint client_journeys_stage_check check (stage in (
        'enquiry','assessment','planning','preparation','applications_approvals',
        'visa_processing','travel','arrival','completed',
        'enquiry_received','enquiry_reviewed','availability_confirmation',
        'quotation_preparation','quotation_sent','awaiting_customer_decision',
        'order_confirmed','payment_processing','vehicle_sourcing',
        'inspection_documentation','shipping_preparation','in_transit',
        'arrived_in_ghana','customs_clearing','delivery_arrangements',
        'delivered','autos_completed'
    )),
    add constraint client_journeys_operational_status_check check (
        operational_status in ('active','on_hold','completed','cancelled','unsuccessful')
    );

-- Phase 1 keeps AUTOS operations staff-only. This restrictive read policy
-- prevents client accounts from reading their own AUTOS progress directly.
drop policy if exists client_journeys_hide_autos_from_clients on public.client_journeys;
create policy client_journeys_hide_autos_from_clients
on public.client_journeys as restrictive for select to authenticated
using (
    private.current_client_id() is null
    or private.current_client_id() <> client_id
    or (
        coalesce(journey_type, '') || ' ' || coalesce(service, '') || ' ' || coalesce(title, '')
    ) not ilike '%autos%'
    and (
        coalesce(journey_type, '') || ' ' || coalesce(service, '') || ' ' || coalesce(title, '')
    ) not ilike '%vehicle sourcing%'
);

create table if not exists public.client_journey_stage_history (
    id uuid primary key default gen_random_uuid(),
    journey_id uuid not null references public.client_journeys(id) on delete restrict,
    previous_stage text,
    new_stage text not null,
    previous_operational_status text,
    new_operational_status text not null,
    internal_note text not null default '',
    changed_by uuid,
    changed_by_name text not null default 'System',
    created_at timestamptz not null default now()
);

create index if not exists client_journey_stage_history_journey_created_idx
    on public.client_journey_stage_history(journey_id, created_at desc);

alter table public.client_journey_stage_history enable row level security;
revoke all on public.client_journey_stage_history from public, anon, authenticated;
grant select on public.client_journey_stage_history to authenticated;

drop policy if exists client_journey_stage_history_read_staff on public.client_journey_stage_history;
create policy client_journey_stage_history_read_staff
on public.client_journey_stage_history for select to authenticated
using (
    private.is_overall_admin()
    or (
        private.has_permission('journeys.read')
        and exists (
            select 1 from public.client_journeys journey
            where journey.id = client_journey_stage_history.journey_id
              and private.can_access_client(journey.client_id)
        )
    )
);

create or replace function private.record_client_journey_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_name text;
    change_note text := coalesce(current_setting('app.journey_change_note', true), '');
begin
    if tg_op = 'UPDATE'
       and new.stage is not distinct from old.stage
       and new.operational_status is not distinct from old.operational_status
       and nullif(btrim(change_note), '') is null then
        return new;
    end if;

    select coalesce(nullif(btrim(profile.display_name), ''), auth.uid()::text, 'System')
      into actor_name
    from public.staff_profiles profile
    where profile.user_id = auth.uid();
    actor_name := coalesce(actor_name, auth.uid()::text, 'System');

    insert into public.client_journey_stage_history (
        journey_id, previous_stage, new_stage,
        previous_operational_status, new_operational_status,
        internal_note, changed_by, changed_by_name, created_at
    ) values (
        new.id,
        case when tg_op = 'UPDATE' then old.stage else null end,
        new.stage,
        case when tg_op = 'UPDATE' then old.operational_status else null end,
        new.operational_status,
        btrim(change_note), auth.uid(), actor_name, now()
    );
    return new;
end;
$$;

revoke all on function private.record_client_journey_stage_change() from public, anon, authenticated;

drop trigger if exists client_journey_stage_history_record on public.client_journeys;
create trigger client_journey_stage_history_record
after insert or update of stage, operational_status on public.client_journeys
for each row execute function private.record_client_journey_stage_change();

create or replace function public.update_client_journey_progress(
    p_journey_id uuid,
    p_stage text,
    p_operational_status text,
    p_internal_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    journey_client_id uuid;
begin
    if auth.uid() is null
       or not private.has_permission('journeys.write') then
        raise exception 'Journey write permission is required.' using errcode = '42501';
    end if;

    if p_stage not in (
        'enquiry','assessment','planning','preparation','applications_approvals',
        'visa_processing','travel','arrival','completed',
        'enquiry_received','enquiry_reviewed','availability_confirmation',
        'quotation_preparation','quotation_sent','awaiting_customer_decision',
        'order_confirmed','payment_processing','vehicle_sourcing',
        'inspection_documentation','shipping_preparation','in_transit',
        'arrived_in_ghana','customs_clearing','delivery_arrangements',
        'delivered','autos_completed'
    ) or p_operational_status not in ('active','on_hold','completed','cancelled','unsuccessful')
       or length(coalesce(p_internal_note, '')) > 3000 then
        raise exception 'Journey stage, status or internal note is invalid.' using errcode = '22023';
    end if;

    select journey.client_id into journey_client_id
    from public.client_journeys journey
    where journey.id = p_journey_id
    for update;

    if not found or not private.can_access_client(journey_client_id) then
        raise exception 'Journey was not found or is outside your authorised client scope.' using errcode = '42501';
    end if;

    perform pg_catalog.set_config('app.journey_change_note', coalesce(p_internal_note, ''), true);
    update public.client_journeys
    set stage = p_stage, operational_status = p_operational_status, updated_at = now()
    where id = p_journey_id;
    perform pg_catalog.set_config('app.journey_change_note', '', true);

    return p_journey_id;
end;
$$;

revoke all on function public.update_client_journey_progress(uuid, text, text, text) from public, anon;
grant execute on function public.update_client_journey_progress(uuid, text, text, text) to authenticated;
