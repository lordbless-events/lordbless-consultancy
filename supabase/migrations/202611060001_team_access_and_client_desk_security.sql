-- Team & Access administration and canonical client desk ownership.
-- Existing identities, roles, desk IDs, clients and finance records are kept.
-- The migration aborts before changing data if a client currently has more
-- than one desk assignment; those conflicts need an authorised decision.

begin;

do $$
begin
    if to_regclass('public.staff_profiles') is null
       or to_regclass('public.staff_role_catalog') is null
       or to_regclass('public.staff_roles') is null
       or to_regclass('public.permissions') is null
       or to_regclass('public.role_permissions') is null
       or to_regclass('public.staff_permissions') is null
       or to_regclass('public.desks') is null
       or to_regclass('public.staff_desks') is null
       or to_regclass('public.client_desk_assignments') is null
       or to_regclass('public.clients') is null
       or to_regclass('public.enquiries') is null
       or to_regclass('public.client_journeys') is null
       or to_regclass('public.client_journey_milestones') is null
       or to_regclass('public.client_documents') is null
       or to_regclass('public.document_requests') is null
       or to_regclass('public.document_review_history') is null
       or to_regclass('public.enquiry_requirements') is null
       or to_regclass('public.portal_followups') is null
       or to_regclass('public.client_journey_requests') is null
       or to_regclass('public.client_appointments') is null
       or to_regclass('public.client_appointment_notifications') is null
       or to_regclass('public.client_assessment_decisions') is null
       or to_regclass('public.client_assessment_decision_history') is null
       or to_regclass('public.client_assessment_payments') is null then
        raise exception 'A required identity, desk, client, enquiry, journey, document, follow-up, appointment, or finance table is missing.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'enquiries' and column_name = 'client_id'
    ) then
        raise exception 'public.enquiries.client_id is required for desk-scoped enquiry access.';
    end if;

    if exists (
        select 1 from public.client_desk_assignments
        group by client_id
        having count(*) > 1
    ) then
        raise exception 'Some clients have multiple desk assignments. Resolve and record those assignments before applying the one-primary-desk rule.';
    end if;

    if (select count(*) from public.desks where code in ('china', 'germany_europe', 'canada')) <> 3 then
        raise exception 'Expected existing China, Germany & Europe, and Canada desks were not all found; inspect desk codes before migration.';
    end if;
    if not exists (select 1 from public.staff_role_catalog where role_code = 'overall_admin')
       or not exists (select 1 from public.staff_role_catalog where role_code = 'finance_manager')
       or not exists (select 1 from public.staff_role_catalog where role_code = 'desk_staff') then
        raise exception 'Expected existing Overall Admin, Finance Manager, and Desk Staff roles were not all found.';
    end if;
end;
$$;

-- Preserve existing desk IDs and codes; only align their display names.
update public.desks set name = 'China Desk' where code = 'china';
update public.desks set name = 'Europe Desk' where code = 'germany_europe';
update public.desks set name = 'Canada & USA Desk' where code = 'canada';

-- Add the profiles that lack compatible legacy role codes while preserving
-- the finance_manager and desk_staff codes and existing assignments.
insert into public.staff_role_catalog (role_code, display_name, description)
values
    ('operations_client_services', 'Operations & Client Services', 'Client records, enquiries, assessments, journeys, and follow-ups within assigned desks.'),
    ('documentation_admissions', 'Documentation & Admissions', 'Document review and admissions/application decisions within assigned desks.')
on conflict (role_code) do update
set display_name = excluded.display_name,
    description = excluded.description;

update public.staff_role_catalog
set display_name = 'Finance & Administration',
    description = 'Global finance operations and financial reporting without general case access.'
where role_code = 'finance_manager';

update public.staff_role_catalog
set display_name = 'Desk Staff (legacy)',
    description = 'Legacy combined desk access retained for existing staff; use consolidated profiles for new assignments.'
where role_code = 'desk_staff';

insert into public.permissions (permission_code, description)
values
    ('followups.write', 'Create and manage follow-ups within authorized client scope.'),
    ('consultations.manage', 'Schedule and manage consultations within authorized client scope.')
on conflict (permission_code) do nothing;

insert into public.role_permissions (role_code, permission_code)
values
    ('operations_client_services', 'dashboard.read'),
    ('operations_client_services', 'clients.read'),
    ('operations_client_services', 'clients.write'),
    ('operations_client_services', 'enquiries.read'),
    ('operations_client_services', 'enquiries.write'),
    ('operations_client_services', 'applications.read'),
    ('operations_client_services', 'applications.write'),
    ('operations_client_services', 'journeys.read'),
    ('operations_client_services', 'journeys.write'),
    ('operations_client_services', 'followups.read'),
    ('operations_client_services', 'followups.write'),
    ('operations_client_services', 'consultations.manage'),
    ('documentation_admissions', 'dashboard.read'),
    ('documentation_admissions', 'clients.read'),
    ('documentation_admissions', 'enquiries.read'),
    ('documentation_admissions', 'applications.read'),
    ('documentation_admissions', 'applications.write'),
    ('documentation_admissions', 'documents.read'),
    ('documentation_admissions', 'documents.review')
on conflict (role_code, permission_code) do nothing;

-- Reassignment history is append-only for authenticated users and readable
-- only by Overall Admin. Existing assignments stay in the current relation.
create table if not exists public.client_desk_assignment_history (
    id bigint generated always as identity primary key,
    client_id uuid not null references public.clients(id) on delete restrict,
    previous_desk_id uuid references public.desks(id) on delete restrict,
    desk_id uuid not null references public.desks(id) on delete restrict,
    changed_by uuid references public.staff_profiles(user_id) on delete set null,
    changed_at timestamptz not null default now(),
    action text not null check (action in ('assigned', 'reassigned'))
);

-- Record the current allocation as the history baseline using its existing
-- assigned_at/assigned_by values. Earlier changes cannot be reconstructed.
insert into public.client_desk_assignment_history (
    client_id, previous_desk_id, desk_id, changed_by, changed_at, action
)
select a.client_id, null, a.desk_id, a.assigned_by, a.assigned_at, 'assigned'
from public.client_desk_assignments a
where not exists (
    select 1 from public.client_desk_assignment_history h
    where h.client_id = a.client_id
      and h.desk_id = a.desk_id
      and h.changed_at = a.assigned_at
      and h.action = 'assigned'
);

create index if not exists client_desk_assignment_history_client_changed_idx
    on public.client_desk_assignment_history (client_id, changed_at desc);

alter table public.client_desk_assignment_history enable row level security;
revoke all on public.client_desk_assignment_history from public, anon, authenticated;
grant select on public.client_desk_assignment_history to authenticated;
create policy client_desk_assignment_history_overall_admin_read
on public.client_desk_assignment_history for select to authenticated
using (private.is_overall_admin());

-- One current desk per client. The preflight above deliberately prevents an
-- arbitrary choice if the live data contains multiple desk assignments.
create unique index if not exists client_desk_assignments_one_desk_per_client_idx
    on public.client_desk_assignments (client_id);

-- The directory exposes Auth email only through an Overall Admin checked RPC;
-- authenticated users never receive direct access to auth.users.
create or replace function public.list_staff_directory()
returns table (user_id uuid, display_name text, email text, active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not private.is_overall_admin() then
        raise exception 'Overall Admin access is required to view the staff directory.' using errcode = '42501';
    end if;

    return query
    select sp.user_id, sp.display_name, au.email::text, sp.active
    from public.staff_profiles sp
    join auth.users au on au.id = sp.user_id
    order by lower(coalesce(sp.display_name, '')), lower(coalesce(au.email, ''));
end;
$$;

create or replace function public.set_staff_role(
    p_staff_user_id uuid,
    p_role_code text,
    p_assigned boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    active_overall_admins integer;
begin
    if auth.uid() is null or not private.is_overall_admin() then
        raise exception 'Overall Admin access is required to manage staff roles.' using errcode = '42501';
    end if;
    if p_staff_user_id is null or p_staff_user_id = auth.uid() then
        raise exception 'You cannot change your own staff roles.' using errcode = '42501';
    end if;
    if p_assigned is null then
        raise exception 'Choose whether to assign or remove the role.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.staff_profiles where user_id = p_staff_user_id) then
        raise exception 'Staff profile not found.' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.staff_role_catalog where role_code = p_role_code) then
        raise exception 'The selected staff role does not exist.' using errcode = '22023';
    end if;
    if p_assigned and p_role_code = 'desk_staff' then
        raise exception 'The legacy Desk Staff role cannot be newly assigned. Choose a consolidated role.' using errcode = '22023';
    end if;

    if p_assigned then
        insert into public.staff_roles (user_id, role_code, is_primary)
        values (
            p_staff_user_id,
            p_role_code,
            not exists (select 1 from public.staff_roles where user_id = p_staff_user_id)
        )
        on conflict (user_id, role_code) do nothing;
    else
        if p_role_code = 'overall_admin' then
            select count(*) into active_overall_admins
            from public.staff_profiles sp
            where sp.active
              and (
                  exists (select 1 from public.staff_roles sr where sr.user_id = sp.user_id and sr.role_code = 'overall_admin')
                  or exists (select 1 from public.staff_permissions up where up.user_id = sp.user_id and up.permission_code = 'admin.all')
                  or exists (select 1 from public.staff_roles sr join public.role_permissions rp on rp.role_code = sr.role_code where sr.user_id = sp.user_id and rp.permission_code = 'admin.all')
              );
            if active_overall_admins <= 1 and exists (
                select 1 from public.staff_profiles where user_id = p_staff_user_id and active
            ) then
                raise exception 'The last active Overall Admin cannot be removed.' using errcode = '42501';
            end if;
        end if;
        delete from public.staff_roles
        where user_id = p_staff_user_id and role_code = p_role_code;
        update public.staff_roles
        set is_primary = true
        where user_id = p_staff_user_id
          and role_code = (
              select sr.role_code from public.staff_roles sr
              where sr.user_id = p_staff_user_id
              order by sr.created_at, sr.role_code limit 1
          )
          and not exists (select 1 from public.staff_roles sr where sr.user_id = p_staff_user_id and sr.is_primary);
    end if;
end;
$$;

create or replace function public.set_staff_active(
    p_staff_user_id uuid,
    p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    active_overall_admins integer;
begin
    if auth.uid() is null or not private.is_overall_admin() then
        raise exception 'Overall Admin access is required to manage staff status.' using errcode = '42501';
    end if;
    if p_staff_user_id is null or p_staff_user_id = auth.uid() then
        raise exception 'You cannot change your own staff status.' using errcode = '42501';
    end if;
    if p_active is null then
        raise exception 'Choose an active or inactive status.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.staff_profiles where user_id = p_staff_user_id) then
        raise exception 'Staff profile not found.' using errcode = 'P0002';
    end if;

    if not p_active and exists (
        select 1 from public.staff_profiles sp
        where sp.user_id = p_staff_user_id and sp.active
          and (
              exists (select 1 from public.staff_roles sr where sr.user_id = sp.user_id and sr.role_code = 'overall_admin')
              or exists (select 1 from public.staff_permissions up where up.user_id = sp.user_id and up.permission_code = 'admin.all')
              or exists (select 1 from public.staff_roles sr join public.role_permissions rp on rp.role_code = sr.role_code where sr.user_id = sp.user_id and rp.permission_code = 'admin.all')
          )
    ) then
        select count(*) into active_overall_admins
        from public.staff_profiles sp
        where sp.active
          and (
              exists (select 1 from public.staff_roles sr where sr.user_id = sp.user_id and sr.role_code = 'overall_admin')
              or exists (select 1 from public.staff_permissions up where up.user_id = sp.user_id and up.permission_code = 'admin.all')
              or exists (select 1 from public.staff_roles sr join public.role_permissions rp on rp.role_code = sr.role_code where sr.user_id = sp.user_id and rp.permission_code = 'admin.all')
          );
        if active_overall_admins <= 1 then
            raise exception 'The last active Overall Admin cannot be deactivated.' using errcode = '42501';
        end if;
    end if;

    update public.staff_profiles set active = p_active where user_id = p_staff_user_id;
end;
$$;

create or replace function public.set_staff_desks(
    p_staff_user_id uuid,
    p_desk_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_ids uuid[] := coalesce(p_desk_ids, array[]::uuid[]);
begin
    if auth.uid() is null or not private.is_overall_admin() then
        raise exception 'Overall Admin access is required to manage staff desk assignments.' using errcode = '42501';
    end if;
    if p_staff_user_id is null or p_staff_user_id = auth.uid() then
        raise exception 'You cannot change your own desk assignments.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.staff_profiles where user_id = p_staff_user_id) then
        raise exception 'Staff profile not found.' using errcode = 'P0002';
    end if;
    if cardinality(selected_ids) <> (select count(distinct requested.desk_id) from unnest(selected_ids) as requested(desk_id)) then
        raise exception 'Duplicate desk assignments were supplied.' using errcode = '22023';
    end if;
    if exists (
        select 1 from unnest(selected_ids) requested(desk_id)
        left join public.desks d on d.id = requested.desk_id and d.active
        where d.id is null
    ) then
        raise exception 'Every selected desk must exist and be active.' using errcode = '22023';
    end if;

    delete from public.staff_desks sd
    where sd.user_id = p_staff_user_id
      and not (sd.desk_id = any(selected_ids));

    insert into public.staff_desks (user_id, desk_id, assigned_by)
    select p_staff_user_id, requested.desk_id, auth.uid()
    from unnest(selected_ids) requested(desk_id)
    on conflict (user_id, desk_id) do update set assigned_by = excluded.assigned_by, assigned_at = now();
end;
$$;

create or replace function public.assign_client_to_desk(
    p_client_id uuid,
    p_desk_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_desk_id uuid;
begin
    if auth.uid() is null or not private.is_overall_admin() then
        raise exception 'Overall Admin access is required to allocate clients to desks.' using errcode = '42501';
    end if;
    if p_client_id is null or p_desk_id is null then
        raise exception 'A client and desk are required.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.clients where id = p_client_id) then
        raise exception 'Client not found.' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.desks where id = p_desk_id and active) then
        raise exception 'The selected desk does not exist or is inactive.' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));
    select cda.desk_id into current_desk_id
    from public.client_desk_assignments cda
    where cda.client_id = p_client_id
    for update;

    if current_desk_id = p_desk_id then
        return pg_catalog.jsonb_build_object('client_id', p_client_id, 'desk_id', p_desk_id, 'changed', false);
    end if;

    if current_desk_id is null then
        insert into public.client_desk_assignments (client_id, desk_id, assigned_by)
        values (p_client_id, p_desk_id, auth.uid());
        insert into public.client_desk_assignment_history (client_id, previous_desk_id, desk_id, changed_by, action)
        values (p_client_id, null, p_desk_id, auth.uid(), 'assigned');
    else
        update public.client_desk_assignments
        set desk_id = p_desk_id, assigned_by = auth.uid(), assigned_at = now()
        where client_id = p_client_id;
        insert into public.client_desk_assignment_history (client_id, previous_desk_id, desk_id, changed_by, action)
        values (p_client_id, current_desk_id, p_desk_id, auth.uid(), 'reassigned');
    end if;

    return pg_catalog.jsonb_build_object('client_id', p_client_id, 'previous_desk_id', current_desk_id, 'desk_id', p_desk_id, 'changed', true);
end;
$$;

-- Functional permissions remain independent from desk membership. Overall
-- Admin's existing admin.all authority includes finance; finance grants stay
-- limited to finance operations and do not imply client case permissions.
create or replace function private.has_finance_permission(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
    select p_permission_code in (
        'finance.read', 'finance.requests', 'finance.reminders',
        'finance.verify', 'finance.receipts'
    ) and private.has_permission(p_permission_code);
$$;

revoke all on function private.has_finance_permission(text) from public, anon;
grant execute on function private.has_finance_permission(text) to authenticated;

drop policy if exists client_assessment_payments_finance_read on public.client_assessment_payments;
create policy client_assessment_payments_finance_read
on public.client_assessment_payments for select to authenticated
using (private.has_finance_permission('finance.read'));

-- Keep finance adjustments global to finance roles and Overall Admin while
-- leaving client-owned data policies independent. The finance proposal may
-- already have created these tables; no finance records are changed here.
do $$
begin
    if to_regclass('public.finance_adjustments') is not null then
        drop policy if exists finance_adjustments_read_authorized on public.finance_adjustments;
        drop policy if exists finance_adjustments_create_authorized on public.finance_adjustments;
        drop policy if exists finance_adjustments_update_authorized on public.finance_adjustments;
        create policy finance_adjustments_read_authorized on public.finance_adjustments
            for select to authenticated using (private.has_finance_permission('finance.read'));
        create policy finance_adjustments_create_authorized on public.finance_adjustments
            for insert to authenticated with check (
                private.has_finance_permission('finance.requests')
                and created_by = (select auth.uid()) and updated_by = (select auth.uid())
            );
        create policy finance_adjustments_update_authorized on public.finance_adjustments
            for update to authenticated using (private.has_finance_permission('finance.requests'))
            with check (private.has_finance_permission('finance.requests') and updated_by = (select auth.uid()));
    end if;
    if to_regclass('public.finance_adjustment_history') is not null then
        drop policy if exists finance_adjustment_history_read_authorized on public.finance_adjustment_history;
        create policy finance_adjustment_history_read_authorized on public.finance_adjustment_history
            for select to authenticated using (private.has_finance_permission('finance.read'));
    end if;
end;
$$;

-- Enquiries have a permissive policy for authorised desk staff and clients,
-- plus a restrictive ownership guard so any older permissive policy cannot
-- expose an unassigned or cross-desk enquiry.
grant select on public.enquiries to authenticated;
revoke all on public.enquiries from public, anon;
drop policy if exists enquiries_select_overall_admin on public.enquiries;
drop policy if exists enquiries_read_authorized on public.enquiries;
create policy enquiries_read_authorized on public.enquiries for select to authenticated
using (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.current_limited_client_id() = client_id
    or (private.has_permission('enquiries.read') and private.can_access_client(client_id))
);
drop policy if exists enquiries_client_scope_guard on public.enquiries;
create policy enquiries_client_scope_guard on public.enquiries as restrictive for select to authenticated
using (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.current_limited_client_id() = client_id
    or private.can_access_client(client_id)
);

-- Journey desk/assignee metadata can no longer grant access independently
-- from the client's canonical desk allocation.
drop policy if exists client_journeys_read_authorized on public.client_journeys;
create policy client_journeys_read_authorized on public.client_journeys for select to authenticated
using (
    private.current_client_id() = client_id
    or private.is_overall_admin()
    or (private.has_permission('journeys.read') and private.can_access_client(client_id))
);
drop policy if exists client_journeys_create_authorized on public.client_journeys;
create policy client_journeys_create_authorized on public.client_journeys for insert to authenticated
with check (
    private.is_overall_admin()
    or (private.has_permission('journeys.write') and private.can_access_client(client_id))
);
drop policy if exists client_journeys_update_authorized on public.client_journeys;
create policy client_journeys_update_authorized on public.client_journeys for update to authenticated
using (
    private.is_overall_admin()
    or (private.has_permission('journeys.write') and private.can_access_client(client_id))
)
with check (
    private.is_overall_admin()
    or (private.has_permission('journeys.write') and private.can_access_client(client_id))
);
drop policy if exists client_journeys_client_scope_guard on public.client_journeys;
create policy client_journeys_client_scope_guard on public.client_journeys as restrictive for all to authenticated
using (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.can_access_client(client_id)
)
with check (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.can_access_client(client_id)
);

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
where private.is_overall_admin()
   or (private.has_permission('journeys.read') and private.can_access_client(journeys.client_id));
revoke all on public.client_journeys_internal_access from public, anon;
grant select on public.client_journeys_internal_access to authenticated;

-- Restrictive ownership guards make the existing functional permission
-- policies authoritative even if another permissive policy is later added.
drop policy if exists client_documents_client_scope_guard on public.client_documents;
create policy client_documents_client_scope_guard on public.client_documents as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists clients_client_scope_guard on public.clients;
create policy clients_client_scope_guard on public.clients as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = id or private.current_limited_client_id() = id or private.can_access_client(id))
with check (private.is_overall_admin() or private.current_client_id() = id or private.current_limited_client_id() = id or private.can_access_client(id));

drop policy if exists document_requests_client_scope_guard on public.document_requests;
create policy document_requests_client_scope_guard on public.document_requests as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists portal_followups_client_scope_guard on public.portal_followups;
create policy portal_followups_client_scope_guard on public.portal_followups as restrictive for all to authenticated
using (private.is_overall_admin() or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.can_access_client(client_id));

-- Follow-up assignees must be active staff assigned to the same desk as the
-- client. Overall Admin may manage the record, but cannot create a cross-desk
-- assignment that the named staff member would be unable to access.
drop policy if exists portal_followups_create_scoped on public.portal_followups;
create policy portal_followups_create_scoped on public.portal_followups
for insert to authenticated
with check (
    private.has_permission('followups.write')
    and private.can_access_client(client_id)
    and created_by = (select auth.uid())
    and (
        assigned_to is null
        or assigned_to = (select auth.uid())
        or exists (
            select 1
            from public.staff_desks assignee_desk
            join public.client_desk_assignments client_desk
              on client_desk.desk_id = assignee_desk.desk_id
            join public.staff_profiles assignee_profile
              on assignee_profile.user_id = assignee_desk.user_id
            where assignee_desk.user_id = portal_followups.assigned_to
              and client_desk.client_id = portal_followups.client_id
              and assignee_profile.active = true
        )
    )
);

drop policy if exists portal_followups_update_scoped on public.portal_followups;
create policy portal_followups_update_scoped on public.portal_followups
for update to authenticated
using (
    private.has_permission('followups.write')
    and private.can_access_client(client_id)
)
with check (
    private.has_permission('followups.write')
    and private.can_access_client(client_id)
    and (
        assigned_to is null
        or assigned_to = (select auth.uid())
        or exists (
            select 1
            from public.staff_desks assignee_desk
            join public.client_desk_assignments client_desk
              on client_desk.desk_id = assignee_desk.desk_id
            join public.staff_profiles assignee_profile
              on assignee_profile.user_id = assignee_desk.user_id
            where assignee_desk.user_id = portal_followups.assigned_to
              and client_desk.client_id = portal_followups.client_id
              and assignee_profile.active = true
        )
    )
);


drop policy if exists client_assessment_decisions_client_scope_guard on public.client_assessment_decisions;
create policy client_assessment_decisions_client_scope_guard on public.client_assessment_decisions as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists client_assessment_decision_history_client_scope_guard on public.client_assessment_decision_history;
create policy client_assessment_decision_history_client_scope_guard on public.client_assessment_decision_history as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists document_review_history_client_scope_guard on public.document_review_history;
create policy document_review_history_client_scope_guard on public.document_review_history as restrictive for all to authenticated
using (
    private.is_overall_admin()
    or exists (select 1 from public.client_documents d where d.id = document_id
        and (private.current_client_id() = d.client_id or private.can_access_client(d.client_id)))
)
with check (
    private.is_overall_admin()
    or exists (select 1 from public.client_documents d where d.id = document_id
        and (private.current_client_id() = d.client_id or private.can_access_client(d.client_id)))
);

drop policy if exists enquiry_requirements_client_scope_guard on public.enquiry_requirements;
create policy enquiry_requirements_client_scope_guard on public.enquiry_requirements as restrictive for all to authenticated
using (
    private.is_overall_admin()
    or exists (
        select 1 from public.enquiries e
        where e.id = enquiry_id
          and (private.current_client_id() = e.client_id or private.current_limited_client_id() = e.client_id or private.can_access_client(e.client_id))
    )
)
with check (
    private.is_overall_admin()
    or exists (
        select 1 from public.enquiries e
        where e.id = enquiry_id
          and (private.current_client_id() = e.client_id or private.current_limited_client_id() = e.client_id or private.can_access_client(e.client_id))
    )
);

drop policy if exists client_journey_requests_client_scope_guard on public.client_journey_requests;
create policy client_journey_requests_client_scope_guard on public.client_journey_requests as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists client_appointments_client_scope_guard on public.client_appointments;
create policy client_appointments_client_scope_guard on public.client_appointments as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists client_appointment_notifications_client_scope_guard on public.client_appointment_notifications;
create policy client_appointment_notifications_client_scope_guard on public.client_appointment_notifications as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id or private.current_limited_client_id() = client_id or private.can_access_client(client_id))
with check (private.is_overall_admin() or private.current_client_id() = client_id or private.current_limited_client_id() = client_id or private.can_access_client(client_id));

drop policy if exists client_journey_milestones_client_scope_guard on public.client_journey_milestones;
create policy client_journey_milestones_client_scope_guard on public.client_journey_milestones as restrictive for all to authenticated
using (
    exists (select 1 from public.client_journeys j where j.id = journey_id
        and (private.is_overall_admin() or private.current_client_id() = j.client_id or private.can_access_client(j.client_id)))
)
with check (
    exists (select 1 from public.client_journeys j where j.id = journey_id
        and (private.is_overall_admin() or private.current_client_id() = j.client_id or private.can_access_client(j.client_id)))
);

-- The history table is writable only by the checked allocation RPC.
revoke insert, update, delete on public.client_desk_assignments from public, anon, authenticated;
revoke insert, update, delete on public.staff_profiles, public.staff_roles,
    public.staff_permissions, public.staff_desks, public.role_permissions,
    public.permissions, public.staff_role_catalog from authenticated;

revoke all on function public.list_staff_directory() from public, anon;
revoke all on function public.set_staff_role(uuid, text, boolean) from public, anon;
revoke all on function public.set_staff_active(uuid, boolean) from public, anon;
revoke all on function public.set_staff_desks(uuid, uuid[]) from public, anon;
revoke all on function public.assign_client_to_desk(uuid, uuid) from public, anon;
grant execute on function public.list_staff_directory() to authenticated;
grant execute on function public.set_staff_role(uuid, text, boolean) to authenticated;
grant execute on function public.set_staff_active(uuid, boolean) to authenticated;
grant execute on function public.set_staff_desks(uuid, uuid[]) to authenticated;
grant execute on function public.assign_client_to_desk(uuid, uuid) to authenticated;

-- Preserve the existing self/Overall Admin directory visibility even if an
-- older permissive policy is present on one of the identity tables.
drop policy if exists staff_profiles_self_admin_guard on public.staff_profiles;
create policy staff_profiles_self_admin_guard on public.staff_profiles as restrictive for select to authenticated
using (user_id = auth.uid() or private.is_overall_admin());

drop policy if exists staff_roles_self_admin_guard on public.staff_roles;
create policy staff_roles_self_admin_guard on public.staff_roles as restrictive for select to authenticated
using (user_id = auth.uid() or private.is_overall_admin());

drop policy if exists staff_permissions_self_admin_guard on public.staff_permissions;
create policy staff_permissions_self_admin_guard on public.staff_permissions as restrictive for select to authenticated
using (user_id = auth.uid() or private.is_overall_admin());

drop policy if exists staff_desks_self_admin_guard on public.staff_desks;
create policy staff_desks_self_admin_guard on public.staff_desks as restrictive for select to authenticated
using (user_id = auth.uid() or private.is_overall_admin());

drop policy if exists client_desk_assignments_desk_scope_guard on public.client_desk_assignments;
create policy client_desk_assignments_desk_scope_guard on public.client_desk_assignments as restrictive for select to authenticated
using (private.is_overall_admin() or private.has_desk_access(desk_id));

commit;
