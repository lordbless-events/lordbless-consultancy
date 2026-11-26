-- Client questionnaire records linked to the original Education enquiry.
-- This is additive and does not alter payments, professional decisions,
-- journeys, or existing client records.

begin;

do $$
begin
    if to_regclass('public.clients') is null
       or to_regclass('public.enquiries') is null
       or to_regclass('public.client_accounts') is null
       or to_regclass('public.client_assessment_payments') is null
       or to_regclass('public.client_assessment_decisions') is null
       or to_regclass('public.staff_profiles') is null
       or to_regclass('public.client_desk_assignments') is null
       or to_regclass('public.staff_desks') is null
       or to_regclass('public.desks') is null
       or to_regprocedure('private.current_client_id()') is null
       or to_regprocedure('private.current_limited_client_id()') is null
       or to_regprocedure('private.has_permission(text)') is null
       or to_regprocedure('private.can_access_client(uuid)') is null then
        raise exception 'Required client, assessment payment, existing decision, desk, or permission structures are missing.';
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'enquiries' and column_name = 'client_id'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'client_assessment_payments' and column_name = 'verification_status'
    ) then
        raise exception 'Enquiry ownership and verified assessment payment fields are required.';
    end if;
end;
$$;

-- Assessment-only service classification. The existing form submits services as an array.
create function private.assessment_is_education(p_enquiry jsonb)
returns boolean language sql immutable set search_path = '' as $$
    select case
        when jsonb_typeof(p_enquiry->'services') = 'array' then
            (p_enquiry->'services' ? 'education')
            and not (p_enquiry->'services' ? 'autos')
        else coalesce(p_enquiry->>'service', '') = 'education'
    end;
$$;
revoke all on function private.assessment_is_education(jsonb) from public, anon, authenticated;

create table public.client_assessments (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete restrict,
    enquiry_id uuid not null unique references public.enquiries(id) on delete restrict,
    status text not null default 'in_progress'
        check (status in ('in_progress', 'submitted', 'under_review', 'clarification_required', 'assessment_completed')),
    responses jsonb not null default '{}'::jsonb check (jsonb_typeof(responses) = 'object'),
    current_step smallint not null default 1 check (current_step between 1 and 4),
    submitted_at timestamptz,
    reviewed_by uuid references public.staff_profiles(user_id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint client_assessments_submission_state_check check (
        (status in ('submitted', 'under_review', 'assessment_completed') and submitted_at is not null)
        or status in ('in_progress', 'clarification_required')
    )
);

create table public.client_assessment_submission_history (
    id bigint generated always as identity primary key,
    assessment_id uuid not null references public.client_assessments(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    revision integer not null check (revision > 0),
    responses jsonb not null check (jsonb_typeof(responses) = 'object'),
    submitted_by uuid references auth.users(id) on delete set null,
    submitted_at timestamptz not null default now(),
    unique (assessment_id, revision)
);

create table public.client_assessment_consultation_notes (
    enquiry_id uuid primary key references public.enquiries(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    notes jsonb not null default '{}'::jsonb check (jsonb_typeof(notes) = 'object'),
    updated_by uuid references public.staff_profiles(user_id) on delete set null,
    updated_at timestamptz not null default now()
);

create index client_assessments_client_updated_idx
    on public.client_assessments (client_id, updated_at desc);
create index client_assessments_status_updated_idx
    on public.client_assessments (status, updated_at desc);
create index client_assessment_submission_history_client_idx
    on public.client_assessment_submission_history (client_id, submitted_at desc);

create or replace function private.client_assessment_payment_verified(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(auth.uid() is not null and (
        private.current_client_id() = p_client_id
        or (private.has_permission('applications.read') and private.can_access_client(p_client_id))
    ), false) and exists (
        select 1 from public.client_assessment_payments p
        where p.client_id = p_client_id
          and p.purpose = 'initial_assessment_consultation'
          and p.status = 'paid'
          and p.verification_status = 'verified'
    );
$$;

revoke all on function private.client_assessment_payment_verified(uuid) from public, anon;
grant execute on function private.client_assessment_payment_verified(uuid) to authenticated;

alter table public.client_assessments enable row level security;
alter table public.client_assessment_submission_history enable row level security;
alter table public.client_assessment_consultation_notes enable row level security;

revoke all on public.client_assessments,
    public.client_assessment_submission_history,
    public.client_assessment_consultation_notes from public, anon, authenticated;
grant select on public.client_assessments,
    public.client_assessment_submission_history,
    public.client_assessment_consultation_notes to authenticated;

create policy client_assessments_read_scoped on public.client_assessments
for select to authenticated using (
    (private.has_permission('applications.read') and private.can_access_client(client_id))
    or (
        private.current_client_id() = client_id
        and private.client_assessment_payment_verified(client_assessments.client_id)
    )
);

create policy client_assessment_submission_history_read_staff on public.client_assessment_submission_history
for select to authenticated using (
    private.has_permission('applications.read') and private.can_access_client(client_id)
);

create policy client_assessment_consultation_notes_read_staff on public.client_assessment_consultation_notes
for select to authenticated using (
    private.has_permission('applications.read') and private.can_access_client(client_id)
);

create or replace function private.prevent_client_assessment_submission_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    raise exception 'Submitted client assessment history is append-only.' using errcode = '42501';
end;
$$;

create trigger client_assessment_submission_history_immutable
before update or delete on public.client_assessment_submission_history
for each row execute function private.prevent_client_assessment_submission_history_mutation();

create or replace function public.get_my_client_assessments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    own_client_id uuid;
    client_row jsonb;
    payment_authorized boolean;
    enquiry_rows jsonb;
begin
    own_client_id := coalesce(private.current_client_id(), private.current_limited_client_id());
    if auth.uid() is null or own_client_id is null then
        raise exception 'An active or limited client account is required.' using errcode = '42501';
    end if;

    select jsonb_strip_nulls(jsonb_build_object(
        'id', c.id,
        'client_code', to_jsonb(c)->>'client_code',
        'full_name', c.full_name,
        'email', coalesce(to_jsonb(c)->>'email', auth.jwt()->>'email'),
        'whatsapp', to_jsonb(c)->>'whatsapp',
        'nationality', to_jsonb(c)->>'nationality',
        'current_country', to_jsonb(c)->>'current_country'
    )) into client_row
    from public.clients c where c.id = own_client_id;

    select private.current_client_id() = own_client_id and exists (
        select 1 from public.client_assessment_payments p
        where p.client_id = own_client_id
          and p.purpose = 'initial_assessment_consultation'
          and p.status = 'paid'
          and p.verification_status = 'verified'
    ) into payment_authorized;
    payment_authorized := coalesce(payment_authorized, false);

    select coalesce(jsonb_agg(item order by created_at desc nulls last), '[]'::jsonb)
    into enquiry_rows
    from (
        select
            e.created_at,
            jsonb_build_object(
                'id', e.id,
                'reference', coalesce(to_jsonb(e)->>'reference', to_jsonb(e)->>'enquiry_reference'),
                'created_at', e.created_at,
                'services', to_jsonb(e)->'services',
                'service', to_jsonb(e)->'service',
                'destination', to_jsonb(e)->'destination',
                'enquiry', jsonb_strip_nulls(jsonb_build_object(
                    'education', to_jsonb(e)->'education',
                    'journey', to_jsonb(e)->'journey',
                    'details', to_jsonb(e)->'details',
                    'general', to_jsonb(e)->'general'
                )),
                'payment_authorized', payment_authorized,
                'assessment', case
                    when payment_authorized and a.id is not null then jsonb_build_object(
                        'id', a.id, 'status', a.status, 'responses', a.responses,
                        'current_step', a.current_step, 'submitted_at', a.submitted_at,
                        'updated_at', a.updated_at
                    )
                    when payment_authorized then jsonb_build_object('status', 'ready_to_begin')
                    else jsonb_build_object('status', 'awaiting_payment')
                end
            ) as item
        from public.enquiries e
        left join public.client_assessments a on a.enquiry_id = e.id and a.client_id = own_client_id
        where e.client_id = own_client_id
          and private.assessment_is_education(to_jsonb(e))
    ) eligible;

    return jsonb_build_object(
        'client', coalesce(client_row, '{}'::jsonb),
        'payment_authorized', payment_authorized,
        'enquiries', enquiry_rows
    );
end;
$$;

create or replace function public.save_my_client_assessment_draft(
    p_enquiry_id uuid,
    p_responses jsonb,
    p_current_step smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    own_client_id uuid;
    assessment_id uuid;
    existing_status text;
begin
    own_client_id := private.current_client_id();
    if auth.uid() is null or own_client_id is null then
        raise exception 'An active client account is required.' using errcode = '42501';
    end if;
    if p_responses is null or jsonb_typeof(p_responses) <> 'object'
       or octet_length(p_responses::text) > 50000
       or p_current_step is null or p_current_step not between 1 and 4 then
        raise exception 'Assessment responses or step are invalid.' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.client_assessment_payments p
        where p.client_id = own_client_id and p.purpose = 'initial_assessment_consultation'
          and p.status = 'paid' and p.verification_status = 'verified'
    ) then
        raise exception 'Your assessment is available after the initial consultation and assessment payment is verified.' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.enquiries e
        where e.id = p_enquiry_id and e.client_id = own_client_id
          and private.assessment_is_education(to_jsonb(e))
    ) then
        raise exception 'The Education enquiry was not found for this account.' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enquiry_id::text, 0));
    select a.id, a.status into assessment_id, existing_status
    from public.client_assessments a
    where a.enquiry_id = p_enquiry_id and a.client_id = own_client_id
    for update;

    if existing_status in ('submitted', 'under_review', 'assessment_completed') then
        raise exception 'This assessment has been submitted and is read-only.' using errcode = '42501';
    end if;
    if assessment_id is null then
        insert into public.client_assessments (client_id, enquiry_id, responses, current_step)
        values (own_client_id, p_enquiry_id, p_responses, p_current_step)
        returning id into assessment_id;
    else
        update public.client_assessments
        set responses = p_responses,
            current_step = p_current_step,
            status = case when existing_status = 'clarification_required' then existing_status else 'in_progress' end,
            updated_at = now()
        where id = assessment_id;
    end if;
    return assessment_id;
end;
$$;

create or replace function public.submit_my_client_assessment(p_enquiry_id uuid, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    own_client_id uuid;
    assessment_id uuid;
    existing_status text;
    next_revision integer;
begin
    own_client_id := private.current_client_id();
    if auth.uid() is null or own_client_id is null then
        raise exception 'An active client account is required.' using errcode = '42501';
    end if;
    if p_responses is null or jsonb_typeof(p_responses) <> 'object'
       or octet_length(p_responses::text) > 50000 then
        raise exception 'Assessment responses are invalid.' using errcode = '22023';
    end if;
    -- Match the actual nested questionnaire response contract.
    if jsonb_typeof(p_responses->'goals') is distinct from 'object'
       or jsonb_typeof(p_responses->'financial') is distinct from 'object'
       or jsonb_typeof(p_responses->'readiness') is distinct from 'object' then
        raise exception 'Complete all three assessment sections.' using errcode = '22023';
    end if;
    if coalesce(p_responses #>> '{goals,pathway}', '') not in (
        'bachelors','masters','phd','ausbildung','nursing_ausbildung','specialist_healthcare',
        'language_preparation','conferences','other','undecided')
       or jsonb_typeof(p_responses #> '{goals,destination}') is distinct from 'string'
       or nullif(btrim(p_responses #>> '{goals,destination}'), '') is null then
        raise exception 'Choose an intended pathway and preferred destination, or Not yet decided.' using errcode = '22023';
    end if;
    if coalesce(p_responses #>> '{financial,funding_source}', '') not in (
        'Self-funded','Parent','Guardian','Spouse','Other family member','Employer or organisation',
        'Scholarship or sponsorship','Multiple funding sources','Funding arrangements not yet determined')
       or coalesce(p_responses #>> '{financial,financial_preparation}', '') not in (
        'Fully prepared','Partially prepared','Currently saving','My sponsor has committed to providing funds',
        'Seeking scholarship or sponsorship','Not yet financially prepared')
       or coalesce(p_responses #>> '{financial,consultancy_readiness}', '') not in (
        'Yes, I am ready to proceed','Yes, subject to the proposed quotation','My sponsor will cover these services',
        'I require additional time','I would like to discuss the available arrangements') then
        raise exception 'Complete the required financial readiness questions.' using errcode = '22023';
    end if;
    if coalesce(p_responses #>> '{readiness,start_timing}', '') not in (
        'Immediately','Within 1 to 3 months','Within 3 to 6 months','Within 6 to 12 months','Not yet decided') then
        raise exception 'Choose your intended starting timeframe.' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.client_assessment_payments p
        where p.client_id = own_client_id and p.purpose = 'initial_assessment_consultation'
          and p.status = 'paid' and p.verification_status = 'verified'
    ) then
        raise exception 'Your assessment is available after the initial consultation and assessment payment is verified.' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.enquiries e
        where e.id = p_enquiry_id and e.client_id = own_client_id
          and private.assessment_is_education(to_jsonb(e))
    ) then
        raise exception 'The Education enquiry was not found for this account.' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enquiry_id::text, 0));
    select a.id, a.status into assessment_id, existing_status
    from public.client_assessments a
    where a.enquiry_id = p_enquiry_id and a.client_id = own_client_id
    for update;
    if existing_status in ('submitted', 'under_review', 'assessment_completed') then
        raise exception 'This assessment has already been submitted.' using errcode = '23505';
    end if;
    if assessment_id is null then
        insert into public.client_assessments (client_id, enquiry_id, responses, current_step)
        values (own_client_id, p_enquiry_id, p_responses, 4)
        returning id into assessment_id;
    else
        update public.client_assessments
        set responses = p_responses, current_step = 4
        where id = assessment_id;
    end if;

    select coalesce(max(h.revision), 0) + 1 into next_revision
    from public.client_assessment_submission_history h where h.assessment_id = assessment_id;
    insert into public.client_assessment_submission_history (
        assessment_id, client_id, revision, responses, submitted_by
    ) values (assessment_id, own_client_id, next_revision, p_responses, auth.uid());

    update public.client_assessments
    set status = 'submitted', submitted_at = now(), updated_at = now()
    where id = assessment_id;
    return assessment_id;
end;
$$;

create or replace function public.mark_client_assessment_under_review(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    update public.client_assessments a
    set status = 'under_review', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where a.id = p_assessment_id
      and private.can_access_client(a.client_id)
      and a.status = 'submitted';
    if not found and not exists (
        select 1 from public.client_assessments a
        where a.id = p_assessment_id and a.status = 'under_review'
          and private.can_access_client(a.client_id)
    ) then
        raise exception 'Assessment not found, inaccessible, or not submitted.' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.save_client_assessment_consultation_notes(
    p_enquiry_id uuid,
    p_notes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    assessment_client_id uuid;
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' or octet_length(p_notes::text) > 20000 then
        raise exception 'Consultation notes are invalid or exceed the allowed size.' using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_each(p_notes) entry
        where entry.key not in (
            'academic_findings', 'language_readiness', 'financial_readiness', 'consultation_notes',
            'recommended_destination', 'recommended_pathway', 'preparation_requirements', 'recommended_next_action'
        )
        or jsonb_typeof(entry.value) <> 'string'
        or length(entry.value #>> '{}') > 4000
    ) then
        raise exception 'Consultation notes contain an unsupported or overlong field.' using errcode = '22023';
    end if;
    select e.client_id into assessment_client_id
    from public.enquiries e
    where e.id = p_enquiry_id
      and private.assessment_is_education(to_jsonb(e));
    if assessment_client_id is null or not private.can_access_client(assessment_client_id) then
        raise exception 'Education enquiry not found or access denied.' using errcode = '42501';
    end if;
    insert into public.client_assessment_consultation_notes (
        enquiry_id, client_id, notes, updated_by, updated_at
    ) values (p_enquiry_id, assessment_client_id, p_notes, auth.uid(), now())
    on conflict (enquiry_id) do update set
        notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

create or replace function public.reopen_client_assessment_for_clarification(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    update public.client_assessments a
    set status = 'clarification_required', updated_at = now()
    where a.id = p_assessment_id
      and private.can_access_client(a.client_id)
      and a.status in ('submitted', 'under_review', 'assessment_completed');
    if not found then
        raise exception 'A submitted assessment could not be reopened.' using errcode = 'P0002';
    end if;
end;
$$;

-- Professional decisions remain independent of questionnaire status.

-- Explicit questionnaire-only review completion; independent of professional decisions.
create or replace function public.complete_client_assessment_review(p_assessment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    update public.client_assessments a
    set status = 'assessment_completed', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where a.id = p_assessment_id and private.can_access_client(a.client_id)
      and a.status in ('submitted','under_review') and a.submitted_at is not null;
    if not found then
        raise exception 'A submitted assessment could not be completed.' using errcode = 'P0002';
    end if;
end;
$$;
revoke all on function public.complete_client_assessment_review(uuid) from public, anon;
grant execute on function public.complete_client_assessment_review(uuid) to authenticated;



-- Enrich the established queue response in its existing JSON payload. Its
-- return signature and decision-save RPC remain unchanged.
create or replace function public.list_client_assessment_queue()
returns table (
    client_id uuid, client_name text, client_code text, enquiries jsonb,
    decision_id uuid, decision text, assessment_reason text, admin_comments text,
    reviewer_id uuid, reviewer_name text, reviewed_at timestamptz,
    created_at timestamptz, updated_at timestamptz
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
    select c.id, coalesce(nullif(c.full_name, ''), 'Client'), to_jsonb(c)->>'client_code', enquiry_data.items,
        d.id, d.decision, d.assessment_reason, d.admin_comments, d.reviewer_id, d.reviewer_name,
        d.reviewed_at, d.created_at, d.updated_at
    from public.clients c
    left join public.client_assessment_decisions d on d.client_id = c.id
    left join lateral (
        select jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
                'id', e.id,
                'reference', coalesce(row_data->>'reference', row_data->>'enquiry_reference'),
                'created_at', coalesce(row_data->>'created_at', row_data->>'submitted_at'),
                'services', row_data->'services',
                'service', row_data->'service',
                'destination', row_data->'destination',
                'details', row_data->'details',
                'education', row_data->'education',
                'careers', row_data->'careers',
                'travel', row_data->'travel',
                'business', row_data->'business',
                'mobility', row_data->'mobility',
                'general', row_data->'general',
                'is_education', private.assessment_is_education(row_data),
                'desk_names', desk_data.names,
                'client_assessment', case when private.assessment_is_education(row_data)
                then jsonb_build_object(
                    'id', a.id,
                    'status', case
                        when a.id is not null then a.status
                        when exists (
                            select 1 from public.client_assessment_payments p
                            where p.client_id = c.id and p.purpose = 'initial_assessment_consultation'
                              and p.status = 'paid' and p.verification_status = 'verified'
                        ) then 'ready_to_begin'
                        else 'awaiting_payment'
                    end,
                    'submitted_at', a.submitted_at,
                    'updated_at', a.updated_at, 'current_step', a.current_step,
                    'payment_authorized', exists (
                        select 1 from public.client_assessment_payments p
                        where p.client_id = c.id and p.purpose = 'initial_assessment_consultation'
                          and p.status = 'paid' and p.verification_status = 'verified'
                    )
                ) end
            )) order by coalesce(row_data->>'created_at', row_data->>'submitted_at') desc nulls last
        ) as items
        from public.enquiries e
        cross join lateral (select to_jsonb(e) as row_data) source_row
        left join public.client_assessments a on a.enquiry_id = e.id and a.client_id = c.id
        left join lateral (
            select jsonb_agg(distinct desk.name) as names
            from public.client_desk_assignments cda
            join public.desks desk on desk.id = cda.desk_id and desk.active
            where cda.client_id = c.id
        ) desk_data on true
        where e.client_id = c.id and private.can_access_client(c.id)
    ) enquiry_data on true
    where private.can_access_client(c.id)
      and (enquiry_data.items is not null or d.id is not null)
    order by (d.id is null) desc, d.updated_at desc nulls last, c.full_name;
end;
$$;

create or replace function public.get_client_assessment_review(p_enquiry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    enquiry_client_id uuid;
    enquiry_row jsonb;
    assessment_row public.client_assessments%rowtype;
    assessment_notes jsonb;
    previous_submissions jsonb;
    payment_authorized boolean;
begin
    if auth.uid() is null or not private.has_permission('applications.read') then
        raise exception 'Assessment read permission is required.' using errcode = '42501';
    end if;
    select e.client_id, to_jsonb(e) into enquiry_client_id, enquiry_row
    from public.enquiries e where e.id = p_enquiry_id;
    if enquiry_client_id is null or not private.can_access_client(enquiry_client_id) then
        raise exception 'Education assessment was not found or access is denied.' using errcode = '42501';
    end if;
    if not private.assessment_is_education(enquiry_row) then
        raise exception 'The selected enquiry is not an Education assessment.' using errcode = '22023';
    end if;

    select * into assessment_row from public.client_assessments a
    where a.enquiry_id = p_enquiry_id and a.client_id = enquiry_client_id;
    select coalesce(n.notes, '{}'::jsonb) into assessment_notes
    from public.client_assessment_consultation_notes n
    where n.enquiry_id = p_enquiry_id and n.client_id = enquiry_client_id;
    assessment_notes := coalesce(assessment_notes, '{}'::jsonb);
    select coalesce(jsonb_agg(jsonb_build_object(
        'revision', h.revision, 'responses', h.responses, 'submitted_at', h.submitted_at
    ) order by h.revision desc), '[]'::jsonb)
    into previous_submissions
    from public.client_assessment_submission_history h
    where h.assessment_id = assessment_row.id;
    payment_authorized := private.client_assessment_payment_verified(enquiry_client_id);

    return jsonb_build_object(
        'enquiry_id', p_enquiry_id,
        'client_id', enquiry_client_id,
        'payment_authorized', payment_authorized,
        'assessment', case when assessment_row.id is null then jsonb_build_object(
            'status', case when payment_authorized then 'ready_to_begin' else 'awaiting_payment' end
        ) else jsonb_build_object(
            'id', assessment_row.id, 'status', assessment_row.status,
            'responses', assessment_row.responses, 'current_step', assessment_row.current_step,
            'submitted_at', assessment_row.submitted_at, 'updated_at', assessment_row.updated_at
        ) end,
        'consultation_notes', assessment_notes,
        'submission_history', previous_submissions
    );
end;
$$;

revoke all on function public.get_my_client_assessments() from public, anon;
grant execute on function public.get_my_client_assessments() to authenticated;
revoke all on function public.save_my_client_assessment_draft(uuid, jsonb, smallint) from public, anon;
grant execute on function public.save_my_client_assessment_draft(uuid, jsonb, smallint) to authenticated;
revoke all on function public.submit_my_client_assessment(uuid, jsonb) from public, anon;
grant execute on function public.submit_my_client_assessment(uuid, jsonb) to authenticated;
revoke all on function public.mark_client_assessment_under_review(uuid) from public, anon;
grant execute on function public.mark_client_assessment_under_review(uuid) to authenticated;
revoke all on function public.save_client_assessment_consultation_notes(uuid, jsonb) from public, anon;
grant execute on function public.save_client_assessment_consultation_notes(uuid, jsonb) to authenticated;
revoke all on function public.reopen_client_assessment_for_clarification(uuid) from public, anon;
grant execute on function public.reopen_client_assessment_for_clarification(uuid) to authenticated;
revoke all on function public.list_client_assessment_queue() from public, anon;
grant execute on function public.list_client_assessment_queue() to authenticated;
revoke all on function public.get_client_assessment_review(uuid) from public, anon;
grant execute on function public.get_client_assessment_review(uuid) to authenticated;
revoke all on function private.prevent_client_assessment_submission_history_mutation() from public, anon, authenticated;

commit;
