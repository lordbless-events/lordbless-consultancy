-- Persistent journey milestone progress for assigned client journeys.
-- Client ownership and staff scope are inherited from client_journeys.

-- Do not silently adopt a production object with an incompatible shape.
do $$
declare
    matching_columns integer;
    unexpected_policies integer;
begin
    if to_regclass('public.client_journey_milestones') is not null then
        select count(*) into matching_columns
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'client_journey_milestones'
          and (column_name, data_type) in (
              ('id', 'uuid'),
              ('journey_id', 'uuid'),
              ('title', 'text'),
              ('description', 'text'),
              ('sort_order', 'integer'),
              ('status', 'text'),
              ('due_date', 'date'),
              ('completed_at', 'timestamp with time zone'),
              ('updated_by', 'uuid'),
              ('created_at', 'timestamp with time zone'),
              ('updated_at', 'timestamp with time zone')
          );

        if matching_columns <> 11 then
            raise exception 'public.client_journey_milestones already exists with an incompatible schema; inspect the live table before applying this migration.';
        end if;

        select count(*) into unexpected_policies
        from pg_policies
        where schemaname = 'public'
          and tablename = 'client_journey_milestones'
          and policyname <> 'client_journey_milestones_read_owner_or_scoped_staff';

        if unexpected_policies > 0 then
            raise exception 'public.client_journey_milestones has existing policies; inspect the live authorization rules before applying this migration.';
        end if;
    end if;
end;
$$;

create table if not exists public.client_journey_milestones (
    id uuid primary key default gen_random_uuid(),
    journey_id uuid not null references public.client_journeys(id) on delete cascade,
    title text not null check (length(btrim(title)) > 0),
    description text not null default '',
    sort_order integer not null default 0,
    status text not null default 'pending'
        check (status in ('pending', 'in_progress', 'completed', 'blocked')),
    due_date date,
    completed_at timestamptz,
    updated_by uuid references public.staff_profiles(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint client_journey_milestones_completion_check check (
        (status = 'completed' and completed_at is not null)
        or (status <> 'completed' and completed_at is null)
    )
);

create index if not exists client_journey_milestones_journey_order_idx
    on public.client_journey_milestones (journey_id, sort_order, created_at);

drop trigger if exists client_journey_milestones_set_updated_at
    on public.client_journey_milestones;
create trigger client_journey_milestones_set_updated_at
before update on public.client_journey_milestones
for each row execute function private.set_updated_at();

alter table public.client_journey_milestones enable row level security;
revoke all on public.client_journey_milestones from public, anon, authenticated;
grant select (
    id, journey_id, title, description, sort_order, status,
    due_date, completed_at, created_at, updated_at
) on public.client_journey_milestones to authenticated;

drop policy if exists client_journey_milestones_read_owner_or_scoped_staff
    on public.client_journey_milestones;
create policy client_journey_milestones_read_owner_or_scoped_staff
on public.client_journey_milestones for select to authenticated
using (
    exists (
        select 1
        from public.client_journeys journey
        where journey.id = client_journey_milestones.journey_id
          and (
              private.current_client_id() = journey.client_id
              or private.is_overall_admin()
              or (
                  private.has_permission('journeys.read')
                  and private.can_access_client(journey.client_id)
              )
          )
    )
);

create or replace function public.save_client_journey_milestone(
    p_milestone_id uuid,
    p_journey_id uuid,
    p_title text,
    p_description text,
    p_sort_order integer,
    p_due_date date,
    p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    journey_client_id uuid;
    saved_id uuid;
begin
    if auth.uid() is null or not (
        private.is_overall_admin()
        or private.has_permission('journeys.write')
    ) then
        raise exception 'Journey management permission is required.' using errcode = '42501';
    end if;

    select client_id into journey_client_id
    from public.client_journeys
    where id = p_journey_id;

    if journey_client_id is null or not private.can_access_client(journey_client_id) then
        raise exception 'Journey not found or access denied.' using errcode = '42501';
    end if;

    if p_title is null or length(btrim(p_title)) = 0
       or p_status not in ('pending', 'in_progress', 'completed', 'blocked') then
        raise exception 'Enter a milestone title and valid status.' using errcode = '22023';
    end if;

    if p_milestone_id is null then
        insert into public.client_journey_milestones (
            journey_id, title, description, sort_order, status,
            due_date, completed_at, updated_by
        ) values (
            p_journey_id, btrim(p_title), btrim(coalesce(p_description, '')),
            greatest(coalesce(p_sort_order, 0), 0), p_status, p_due_date,
            case when p_status = 'completed' then pg_catalog.now() else null end,
            auth.uid()
        ) returning id into saved_id;
    else
        update public.client_journey_milestones
        set title = btrim(p_title),
            description = btrim(coalesce(p_description, '')),
            sort_order = greatest(coalesce(p_sort_order, 0), 0),
            status = p_status,
            due_date = p_due_date,
            completed_at = case when p_status = 'completed'
                then coalesce(completed_at, pg_catalog.now()) else null end,
            updated_by = auth.uid()
        where id = p_milestone_id
          and journey_id = p_journey_id
        returning id into saved_id;

        if saved_id is null then
            raise exception 'Milestone not found for this journey.' using errcode = 'P0002';
        end if;
    end if;

    return saved_id;
end;
$$;

revoke all on function public.save_client_journey_milestone(uuid, uuid, text, text, integer, date, text)
    from public, anon;
grant execute on function public.save_client_journey_milestone(uuid, uuid, text, text, integer, date, text)
    to authenticated;
