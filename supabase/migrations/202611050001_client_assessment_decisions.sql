-- Internal administrative assessment decisions.
-- These records are intentionally separate from enquiry status, client
-- journeys, consultation payments, and document reviews.

do $$
begin
    if to_regclass('public.clients') is null
       or to_regclass('public.enquiries') is null
       or to_regclass('public.staff_profiles') is null
       or to_regprocedure('private.has_permission(text)') is null
       or to_regprocedure('private.can_access_client(uuid)') is null then
        raise exception 'Apply the existing identity and client/enquiry foundations before this migration.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'enquiries'
          and column_name = 'client_id' and udt_name = 'uuid'
    ) then
        raise exception 'Expected public.enquiries.client_id uuid ownership column was not found.';
    end if;
end;
$$;

create table if not exists public.client_assessment_decisions (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null unique references public.clients(id) on delete restrict,
    decision text not null check (decision in ('approved', 'on_hold', 'rejected')),
    assessment_reason text,
    admin_comments text not null default '',
    reviewer_id uuid not null references public.staff_profiles(user_id) on delete restrict,
    reviewer_name text not null check (length(btrim(reviewer_name)) > 0),
    reviewed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint client_assessment_decision_reason_check check (
        decision = 'approved' or nullif(btrim(assessment_reason), '') is not null
    ),
    constraint client_assessment_decision_reason_length check (
        assessment_reason is null or length(assessment_reason) <= 4000
    ),
    constraint client_assessment_decision_comments_length check (
        length(admin_comments) <= 8000
    )
);

create table if not exists public.client_assessment_decision_history (
    id uuid primary key default gen_random_uuid(),
    assessment_decision_id uuid not null
        references public.client_assessment_decisions(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    previous_decision text check (previous_decision in ('approved', 'on_hold', 'rejected')),
    decision text not null check (decision in ('approved', 'on_hold', 'rejected')),
    previous_reason text,
    assessment_reason text,
    previous_comments text,
    admin_comments text not null default '',
    reviewer_id uuid not null references public.staff_profiles(user_id) on delete restrict,
    reviewer_name text not null check (length(btrim(reviewer_name)) > 0),
    changed_at timestamptz not null default now(),
    constraint client_assessment_history_reason_check check (
        decision = 'approved' or nullif(btrim(assessment_reason), '') is not null
    )
);

create index if not exists client_assessment_decisions_status_updated_idx
    on public.client_assessment_decisions(decision, updated_at desc);
create index if not exists client_assessment_decision_history_client_changed_idx
    on public.client_assessment_decision_history(client_id, changed_at desc);
create index if not exists client_assessment_decision_history_decision_changed_idx
    on public.client_assessment_decision_history(assessment_decision_id, changed_at desc);

alter table public.client_assessment_decisions enable row level security;
alter table public.client_assessment_decision_history enable row level security;

revoke all on public.client_assessment_decisions,
    public.client_assessment_decision_history from public, anon, authenticated;
grant select on public.client_assessment_decisions,
    public.client_assessment_decision_history to authenticated;

drop policy if exists client_assessment_decisions_read_scoped on public.client_assessment_decisions;
create policy client_assessment_decisions_read_scoped
on public.client_assessment_decisions for select to authenticated
using (
    private.has_permission('applications.read')
    and private.can_access_client(client_id)
);

drop policy if exists client_assessment_decision_history_read_scoped on public.client_assessment_decision_history;
create policy client_assessment_decision_history_read_scoped
on public.client_assessment_decision_history for select to authenticated
using (
    private.has_permission('applications.read')
    and private.can_access_client(client_id)
);

create or replace function private.stamp_client_assessment_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_reviewer_name text;
begin
    if auth.uid() is null
       or not private.has_permission('applications.write')
       or not private.can_access_client(new.client_id) then
        raise exception 'Assessment write permission is required for this client.'
            using errcode = '42501';
    end if;

    select nullif(btrim(sp.display_name), '')
    into current_reviewer_name
    from public.staff_profiles sp
    where sp.user_id = auth.uid()
      and sp.active;

    if current_reviewer_name is null then
        raise exception 'An active staff profile is required to record an assessment decision.'
            using errcode = '42501';
    end if;

    new.reviewer_id := auth.uid();
    new.reviewer_name := current_reviewer_name;
    new.reviewed_at := now();
    new.updated_at := now();

    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
           or new.client_id is distinct from old.client_id then
            raise exception 'An assessment decision cannot be moved to another client.'
                using errcode = '22023';
        end if;
        new.created_at := old.created_at;
    end if;

    return new;
end;
$$;

create or replace function private.audit_client_assessment_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.client_assessment_decision_history (
        assessment_decision_id,
        client_id,
        previous_decision,
        decision,
        previous_reason,
        assessment_reason,
        previous_comments,
        admin_comments,
        reviewer_id,
        reviewer_name,
        changed_at
    ) values (
        new.id,
        new.client_id,
        case when tg_op = 'UPDATE' then old.decision else null end,
        new.decision,
        case when tg_op = 'UPDATE' then old.assessment_reason else null end,
        new.assessment_reason,
        case when tg_op = 'UPDATE' then old.admin_comments else null end,
        new.admin_comments,
        new.reviewer_id,
        new.reviewer_name,
        new.reviewed_at
    );
    return new;
end;
$$;

revoke all on function private.stamp_client_assessment_decision() from public, anon, authenticated;
revoke all on function private.audit_client_assessment_decision() from public, anon, authenticated;
drop trigger if exists client_assessment_decisions_stamp on public.client_assessment_decisions;
create trigger client_assessment_decisions_stamp
before insert or update on public.client_assessment_decisions
for each row execute function private.stamp_client_assessment_decision();
drop trigger if exists client_assessment_decisions_audit on public.client_assessment_decisions;
create trigger client_assessment_decisions_audit
after insert or update on public.client_assessment_decisions
for each row execute function private.audit_client_assessment_decision();

create or replace function public.list_client_assessment_queue()
returns table (
    client_id uuid,
    client_name text,
    client_code text,
    enquiries jsonb,
    decision_id uuid,
    decision text,
    assessment_reason text,
    admin_comments text,
    reviewer_id uuid,
    reviewer_name text,
    reviewed_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not private.has_permission('applications.read') then
        raise exception 'Assessment read permission is required.' using errcode = '42501';
    end if;

    return query
    select
        c.id,
        coalesce(nullif(c.full_name, ''), 'Client'),
        to_jsonb(c)->>'client_code',
        enquiry_data.items,
        d.id,
        d.decision,
        d.assessment_reason,
        d.admin_comments,
        d.reviewer_id,
        d.reviewer_name,
        d.reviewed_at,
        d.created_at,
        d.updated_at
    from public.clients c
    join lateral (
        select jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
                'id', e.id,
                'reference', coalesce(row_data->>'reference', row_data->>'enquiry_reference'),
                'created_at', coalesce(row_data->>'created_at', row_data->>'submitted_at'),
                'services', row_data->'services',
                'details', row_data->'details',
                'education', row_data->'education',
                'careers', row_data->'careers',
                'travel', row_data->'travel',
                'business', row_data->'business',
                'mobility', row_data->'mobility',
                'general', row_data->'general'
            ))
            order by coalesce(row_data->>'created_at', row_data->>'submitted_at') desc nulls last
        ) as items
        from public.enquiries e
        cross join lateral (select to_jsonb(e) as row_data) source_row
        where e.client_id = c.id
          and private.can_access_client(c.id)
    ) enquiry_data on enquiry_data.items is not null
    left join public.client_assessment_decisions d on d.client_id = c.id
    where private.can_access_client(c.id)
    order by (d.id is null) desc, d.updated_at desc nulls last, c.full_name;
end;
$$;

create or replace function public.save_client_assessment_decision(
    p_client_id uuid,
    p_decision text,
    p_assessment_reason text,
    p_admin_comments text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    saved_decision_id uuid;
begin
    if auth.uid() is null
       or not private.has_permission('applications.write')
       or not private.can_access_client(p_client_id) then
        raise exception 'Assessment write permission is required for this client.'
            using errcode = '42501';
    end if;

    if p_decision not in ('approved', 'on_hold', 'rejected') then
        raise exception 'Choose an approved, on-hold, or rejected decision.'
            using errcode = '22023';
    end if;

    if p_decision in ('on_hold', 'rejected')
       and nullif(btrim(p_assessment_reason), '') is null then
        raise exception 'A reason is required for an on-hold or rejected decision.'
            using errcode = '22023';
    end if;

    if length(coalesce(p_assessment_reason, '')) > 4000
       or length(coalesce(p_admin_comments, '')) > 8000 then
        raise exception 'Assessment reason or comments exceed the allowed length.'
            using errcode = '22023';
    end if;

    insert into public.client_assessment_decisions (
        client_id, decision, assessment_reason, admin_comments,
        reviewer_id, reviewer_name
    ) values (
        p_client_id, p_decision, nullif(btrim(p_assessment_reason), ''),
        coalesce(p_admin_comments, ''), auth.uid(), 'Pending reviewer stamp'
    )
    on conflict (client_id) do update set
        decision = excluded.decision,
        assessment_reason = excluded.assessment_reason,
        admin_comments = excluded.admin_comments
    returning id into saved_decision_id;

    return saved_decision_id;
end;
$$;

revoke all on function public.list_client_assessment_queue() from public, anon;
grant execute on function public.list_client_assessment_queue() to authenticated;
revoke all on function public.save_client_assessment_decision(uuid, text, text, text) from public, anon;
grant execute on function public.save_client_assessment_decision(uuid, text, text, text) to authenticated;

comment on table public.client_assessment_decisions is
    'Internal assessment outcome per client; independent from enquiry, payment, document, and journey statuses.';
comment on table public.client_assessment_decision_history is
    'Append-only before/after history for each internal assessment decision revision.';
