-- Persistent internal follow-ups and client journey requests.
-- Existing client_journeys remain staff-created assigned cases.

insert into public.permissions (permission_code, description)
values ('followups.write', 'Create and manage follow-ups within authorized client scope.')
on conflict (permission_code) do nothing;

insert into public.role_permissions (role_code, permission_code)
values ('desk_staff', 'followups.write')
on conflict do nothing;

create table if not exists public.portal_followups (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    enquiry_id uuid references public.enquiries(id) on delete set null,
    assigned_to uuid references public.staff_profiles(user_id) on delete set null,
    created_by uuid not null references public.staff_profiles(user_id) on delete restrict,
    due_date date not null,
    priority text not null default 'normal'
        check (priority in ('low', 'normal', 'high', 'urgent')),
    task_type text not null
        check (task_type in ('enquiry_contact', 'payment_reminder', 'missing_document', 'consultation', 'client_decision', 'other')),
    notes text not null default '',
    status text not null default 'open'
        check (status in ('open', 'in_progress', 'completed', 'cancelled')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists portal_followups_due_status_idx
    on public.portal_followups (status, due_date);
create index if not exists portal_followups_client_idx
    on public.portal_followups (client_id, due_date);
create index if not exists portal_followups_assignee_idx
    on public.portal_followups (assigned_to, due_date);

drop trigger if exists portal_followups_set_updated_at on public.portal_followups;
create trigger portal_followups_set_updated_at
before update on public.portal_followups
for each row execute function private.set_updated_at();

alter table public.portal_followups enable row level security;
revoke all on public.portal_followups from public, anon;
grant select, insert, update on public.portal_followups to authenticated;

drop policy if exists portal_followups_read_scoped on public.portal_followups;
create policy portal_followups_read_scoped
on public.portal_followups for select to authenticated
using (
    private.has_permission('followups.read')
    and private.can_access_client(client_id)
);

drop policy if exists portal_followups_create_scoped on public.portal_followups;
create policy portal_followups_create_scoped
on public.portal_followups for insert to authenticated
with check (
    private.has_permission('followups.write')
    and private.can_access_client(client_id)
    and created_by = auth.uid()
    and (
        assigned_to is null
        or assigned_to = auth.uid()
        or private.is_overall_admin()
        or exists (
            select 1
            from public.staff_desks assignee_desk
            join public.client_desk_assignments client_desk
              on client_desk.desk_id = assignee_desk.desk_id
            where assignee_desk.user_id = assigned_to
              and client_desk.client_id = client_id
              and private.has_desk_access(assignee_desk.desk_id)
        )
    )
);

drop policy if exists portal_followups_update_scoped on public.portal_followups;
create policy portal_followups_update_scoped
on public.portal_followups for update to authenticated
using (
    private.has_permission('followups.write')
    and private.can_access_client(client_id)
)
with check (
    private.has_permission('followups.write')
    and private.can_access_client(client_id)
    and (
        assigned_to is null
        or assigned_to = auth.uid()
        or private.is_overall_admin()
        or exists (
            select 1
            from public.staff_desks assignee_desk
            join public.client_desk_assignments client_desk
              on client_desk.desk_id = assignee_desk.desk_id
            where assignee_desk.user_id = assigned_to
              and client_desk.client_id = client_id
              and private.has_desk_access(assignee_desk.desk_id)
        )
    )
);

create table if not exists public.client_journey_requests (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    requested_by uuid not null references auth.users(id) on delete restrict,
    service text not null check (length(btrim(service)) > 0),
    destination text not null default '',
    details jsonb not null default '{}'::jsonb,
    status text not null default 'requested'
        check (status in ('requested', 'in_review', 'approved', 'rejected', 'assigned', 'cancelled')),
    assigned_journey_id uuid references public.client_journeys(id) on delete set null,
    reviewed_by uuid references public.staff_profiles(user_id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists client_journey_requests_client_created_idx
    on public.client_journey_requests (client_id, created_at desc);
create index if not exists client_journey_requests_status_created_idx
    on public.client_journey_requests (status, created_at);

drop trigger if exists client_journey_requests_set_updated_at on public.client_journey_requests;
create trigger client_journey_requests_set_updated_at
before update on public.client_journey_requests
for each row execute function private.set_updated_at();

alter table public.client_journey_requests enable row level security;
revoke all on public.client_journey_requests from public, anon;
grant select, insert, update on public.client_journey_requests to authenticated;

drop policy if exists client_journey_requests_read_client_or_scoped_staff on public.client_journey_requests;
create policy client_journey_requests_read_client_or_scoped_staff
on public.client_journey_requests for select to authenticated
using (
    private.current_client_id() = client_id
    or private.is_overall_admin()
    or (
        private.has_permission('journeys.read')
        and private.can_access_client(client_id)
    )
);

drop policy if exists client_journey_requests_create_active_client on public.client_journey_requests;
create policy client_journey_requests_create_active_client
on public.client_journey_requests for insert to authenticated
with check (
    private.current_client_id() = client_id
    and requested_by = auth.uid()
    and status = 'requested'
    and assigned_journey_id is null
    and exists (
        select 1
        from public.client_accounts account
        where account.auth_user_id = auth.uid()
          and account.client_id = client_id
          and account.access_status = 'active'
    )
);

drop policy if exists client_journey_requests_staff_update_scoped on public.client_journey_requests;
create policy client_journey_requests_staff_update_scoped
on public.client_journey_requests for update to authenticated
using (
    private.is_overall_admin()
    or (
        private.has_permission('journeys.write')
        and private.can_access_client(client_id)
    )
)
with check (
    private.is_overall_admin()
    or (
        private.has_permission('journeys.write')
        and private.can_access_client(client_id)
    )
);

create or replace function public.assign_client_journey_request(
    p_request_id uuid,
    p_journey_type text,
    p_title text,
    p_destination text,
    p_service text,
    p_status text default 'planning',
    p_internal_assignee_id uuid default null,
    p_desk_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    request_row public.client_journey_requests%rowtype;
    new_journey_id uuid;
begin
    if auth.uid() is null or not (
        private.is_overall_admin()
        or private.has_permission('journeys.write')
    ) then
        raise exception 'Journey management permission is required.' using errcode = '42501';
    end if;

    select * into request_row
    from public.client_journey_requests
    where id = p_request_id
    for update;

    if not found then
        raise exception 'Journey request not found.' using errcode = 'P0002';
    end if;

    if not private.can_access_client(request_row.client_id) then
        raise exception 'Access to this client is not permitted.' using errcode = '42501';
    end if;

    if request_row.assigned_journey_id is not null or request_row.status = 'assigned' then
        raise exception 'This journey request has already been assigned.' using errcode = '23505';
    end if;

    if request_row.status not in ('requested', 'in_review', 'approved') then
        raise exception 'Only an open or approved journey request can be assigned.' using errcode = '22023';
    end if;

    if p_status not in ('planning', 'active', 'completed', 'cancelled') then
        raise exception 'Unsupported journey status.' using errcode = '22023';
    end if;

    if p_desk_id is not null
       and not private.is_overall_admin()
       and not private.has_desk_access(p_desk_id) then
        raise exception 'You cannot assign work to this desk.' using errcode = '42501';
    end if;

    if p_internal_assignee_id is not null
       and p_internal_assignee_id <> auth.uid()
       and not private.is_overall_admin()
       and not exists (
           select 1
           from public.staff_desks target_desk
           join public.client_desk_assignments client_desk
             on client_desk.desk_id = target_desk.desk_id
           where target_desk.user_id = p_internal_assignee_id
             and client_desk.client_id = request_row.client_id
             and private.has_desk_access(target_desk.desk_id)
       ) then
        raise exception 'The assignee is not authorized for this client.' using errcode = '42501';
    end if;

    insert into public.client_journeys (
        client_id, enquiry_id, journey_type, title, destination, service,
        status, internal_assignee_id, desk_id
    ) values (
        request_row.client_id, null, p_journey_type, p_title,
        p_destination, p_service, p_status,
        p_internal_assignee_id, p_desk_id
    ) returning id into new_journey_id;

    update public.client_journey_requests
    set status = 'assigned',
        assigned_journey_id = new_journey_id,
        reviewed_by = auth.uid(),
        reviewed_at = pg_catalog.now()
    where id = request_row.id;

    return new_journey_id;
end;
$$;

revoke all on function public.assign_client_journey_request(uuid, text, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.assign_client_journey_request(uuid, text, text, text, text, text, uuid, uuid) to authenticated;
