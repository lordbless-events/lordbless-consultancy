-- REVIEW ONLY. Do not apply until production migration state and every
-- legacy journey mapping have been reviewed. This is forward-only and keeps
-- the existing journey, milestone, and request rows.
--
-- Legacy status mapping that is safe from the old field alone:
--   planning -> stage planning, operational status active
--   completed -> stage completed, operational status completed
-- Legacy active rows have no stored stage. Legacy cancelled rows have no
-- equivalent in the approved three-state operational status. Supply reviewed
-- per-record mappings in the marked section below before applying.

begin;

do $$
begin
    if to_regclass('public.client_journeys') is null
       or to_regclass('public.client_journeys_internal_access') is null then
        raise exception 'Expected journey table and staff view were not found; inspect the live schema.';
    end if;

    if to_regclass('public.client_journey_requests') is null
       or to_regclass('public.client_journey_milestones') is null
       or to_regprocedure('public.assign_client_journey_request(uuid,text,text,text,text,text,uuid,uuid)') is null
       or to_regprocedure('public.save_client_journey_milestone(uuid,uuid,text,text,integer,date,text)') is null then
        raise exception 'Expected legacy request or milestone objects were not found; confirm migration state before proceeding.';
    end if;

    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'client_journeys'
          and column_name in ('stage', 'operational_status')
    ) then
        raise exception 'Journey stage/status migration appears partially or fully applied; inspect the live schema before proceeding.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'client_journeys'
          and column_name = 'status' and data_type = 'text'
    ) then
        raise exception 'Expected legacy client_journeys.status text column was not found.';
    end if;
end;
$$;

-- Remove only the legacy journey status check before converting its values.
do $$
declare
    constraint_name text;
begin
    for constraint_name in
        select c.conname
        from pg_constraint c
        where c.conrelid = 'public.client_journeys'::regclass
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%status%'
          and pg_get_constraintdef(c.oid) ilike '%planning%'
    loop
        execute format('alter table public.client_journeys drop constraint %I', constraint_name);
    end loop;
end;
$$;

alter table public.client_journeys rename column status to operational_status;
alter view public.client_journeys_internal_access
    rename column status to operational_status;
alter table public.client_journeys add column stage text;

-- Safe automatic mappings only. Active rows need a stage selected from the
-- agreed list; cancelled rows need an explicit operational decision.
update public.client_journeys
set stage = 'planning', operational_status = 'active'
where operational_status = 'planning';

update public.client_journeys
set stage = 'completed', operational_status = 'completed'
where operational_status = 'completed';

-- REVIEW REQUIRED: add explicit UPDATE statements here for every remaining
-- legacy active/cancelled journey, keyed by its journey UUID. Example only:
-- update public.client_journeys set stage = 'preparation'
-- where id = '<reviewed-journey-uuid>' and operational_status = 'active';
-- For legacy cancelled rows, choose an approved stage and one of active,
-- on_hold, or completed only after reviewing the underlying case.

do $$
declare
    unresolved_count bigint;
begin
    select count(*) into unresolved_count
    from public.client_journeys
    where stage is null
       or operational_status not in ('active', 'on_hold', 'completed');

    if unresolved_count > 0 then
        raise exception '% legacy journey rows still need reviewed stage/operational-status mappings; add explicit updates before applying.', unresolved_count;
    end if;
end;
$$;

alter table public.client_journeys
    alter column stage set default 'enquiry',
    alter column stage set not null,
    alter column operational_status set default 'active',
    alter column operational_status set not null,
    add constraint client_journeys_stage_check check (stage in (
        'enquiry', 'assessment', 'planning', 'preparation',
        'applications_approvals', 'visa_processing', 'travel', 'arrival', 'completed'
    )),
    add constraint client_journeys_operational_status_check
        check (operational_status in ('active', 'on_hold', 'completed'));

-- Keep the staff view's existing authorization and columns, expose the new
-- fields, and remove the old status output name.
create or replace view public.client_journeys_internal_access
with (security_barrier = true)
as
select
    journeys.id,
    journeys.client_id,
    journeys.enquiry_id,
    journeys.journey_type,
    journeys.title,
    journeys.destination,
    journeys.service,
    journeys.operational_status,
    journeys.created_at,
    journeys.updated_at,
    journeys.internal_assignee_id,
    journeys.desk_id,
    journeys.stage
from public.client_journeys as journeys
where
    private.is_overall_admin()
    or (
        private.has_permission('journeys.read')
        and (
            journeys.internal_assignee_id = auth.uid()
            or private.has_desk_access(journeys.desk_id)
            or (
                journeys.internal_assignee_id is null
                and journeys.desk_id is null
                and private.can_access_client(journeys.client_id)
            )
        )
    );

revoke all on public.client_journeys_internal_access from public, anon;
grant select on public.client_journeys_internal_access to authenticated;
grant select (stage) on public.client_journeys to authenticated;

-- Retain historical request rows and read access, but retire client creation,
-- staff review updates, request assignment, and their RPC write paths.
drop policy if exists client_journey_requests_create_active_client
    on public.client_journey_requests;
drop policy if exists client_journey_requests_staff_update_scoped
    on public.client_journey_requests;
revoke insert, update on public.client_journey_requests from public, anon, authenticated;

revoke all on function public.assign_client_journey_request(uuid, text, text, text, text, text, uuid, uuid)
    from public, anon, authenticated;

-- Preserve historical milestone rows and read policies, but stop the retired
-- milestone create/update RPC from writing new or changed rows.
revoke all on function public.save_client_journey_milestone(uuid, uuid, text, text, integer, date, text)
    from public, anon, authenticated;

commit;
