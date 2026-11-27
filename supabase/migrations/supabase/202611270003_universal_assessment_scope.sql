-- Universal assessment scope, revised against production schema audit.
-- Apply once after review; no client or finance data changes.
begin;

do $$
begin
    if to_regclass('public.enquiries') is null
       or to_regclass('public.clients') is null
       or to_regclass('public.client_assessments') is null
       or to_regclass('public.client_assessment_payments') is null
       or to_regclass('public.client_assessment_decisions') is null
       or to_regclass('public.client_assessment_decision_history') is null
       or to_regclass('public.client_assessment_consultation_notes') is null
       or to_regclass('public.client_assessment_submission_history') is null
       or to_regclass('public.staff_profiles') is null
       or to_regclass('public.client_desk_assignments') is null
       or to_regclass('public.desks') is null
       or to_regprocedure('private.has_permission(text)') is null
       or to_regprocedure('private.can_access_client(uuid)') is null
       or to_regprocedure('private.current_client_id()') is null
       or to_regprocedure('private.current_limited_client_id()') is null
       or to_regprocedure('private.assessment_is_education(jsonb)') is null then
        raise exception 'Required assessment, enquiry, identity, or permission structures are missing.';
    end if;
end;
$$;

alter table public.client_assessment_decisions
    add column if not exists enquiry_id uuid references public.enquiries(id) on delete restrict,
    add column if not exists service_code text;
alter table public.client_assessment_decision_history
    add column if not exists enquiry_id uuid references public.enquiries(id) on delete restrict,
    add column if not exists service_code text;

-- Replace the original one-decision-per-client constraint with separate
-- uniqueness for legacy rows and enquiry-specific decisions.
do $$
declare
    unique_constraint record;
begin
    for unique_constraint in
        select conname
        from pg_constraint
        where conrelid = 'public.client_assessment_decisions'::regclass
          and contype = 'u'
          and pg_get_constraintdef(oid) = 'UNIQUE (client_id)'
    loop
        execute format('alter table public.client_assessment_decisions drop constraint %I', unique_constraint.conname);
    end loop;
end;
$$;

create unique index if not exists client_assessment_decisions_legacy_client_uidx
    on public.client_assessment_decisions(client_id) where enquiry_id is null;
create unique index if not exists client_assessment_decisions_client_enquiry_service_uidx
    on public.client_assessment_decisions(client_id, enquiry_id, service_code)
    where enquiry_id is not null and service_code is not null;
create index if not exists client_assessment_decisions_enquiry_updated_idx
    on public.client_assessment_decisions(enquiry_id, updated_at desc) where enquiry_id is not null;
create index if not exists client_assessment_decision_history_enquiry_changed_idx
    on public.client_assessment_decision_history(enquiry_id, changed_at desc) where enquiry_id is not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.client_assessment_decisions'::regclass
        and conname = 'client_assessment_decisions_service_scope_check') then
        alter table public.client_assessment_decisions add constraint client_assessment_decisions_service_scope_check
            check ((enquiry_id is null) = (service_code is null));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.client_assessment_decision_history'::regclass
        and conname = 'client_assessment_decision_history_service_scope_check') then
        alter table public.client_assessment_decision_history add constraint client_assessment_decision_history_service_scope_check
            check ((enquiry_id is null) = (service_code is null));
    end if;
end;
$$;

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
        raise exception 'Assessment write permission is required for this client.' using errcode = '42501';
    end if;

    if not private.client_assessment_payment_verified(new.client_id) then
        raise exception 'Initial Consultation and Assessment payment must be verified.' using errcode = '42501';
    end if;

    if (new.enquiry_id is null) is distinct from (new.service_code is null) then
        raise exception 'A service decision requires both its enquiry and service code.' using errcode = '23514';
    end if;
    if new.enquiry_id is not null and not exists (
        select 1 from public.enquiries e
        where e.id = new.enquiry_id and e.client_id = new.client_id
          and length(btrim(new.service_code)) between 1 and 100
          and new.service_code = any(e.services)
          and new.service_code <> 'autos'
    ) then
        raise exception 'The selected service does not belong to this client enquiry.' using errcode = '23514';
    end if;

    select nullif(btrim(sp.display_name), '') into current_reviewer_name
    from public.staff_profiles sp where sp.user_id = auth.uid() and sp.active;
    if current_reviewer_name is null then
        raise exception 'An active staff profile is required to record an assessment decision.' using errcode = '42501';
    end if;

    new.reviewer_id := auth.uid();
    new.reviewer_name := current_reviewer_name;
    new.reviewed_at := now();
    new.updated_at := now();
    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id
           or new.client_id is distinct from old.client_id
           or new.enquiry_id is distinct from old.enquiry_id
           or new.service_code is distinct from old.service_code then
            raise exception 'An assessment decision cannot be moved to another client or enquiry.' using errcode = '22023';
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
        assessment_decision_id, client_id, enquiry_id, service_code,
        previous_decision, decision, previous_reason, assessment_reason,
        previous_comments, admin_comments, reviewer_id, reviewer_name, changed_at
    ) values (
        new.id, new.client_id, new.enquiry_id, new.service_code,
        case when tg_op = 'UPDATE' then old.decision else null end,
        new.decision,
        case when tg_op = 'UPDATE' then old.assessment_reason else null end,
        new.assessment_reason,
        case when tg_op = 'UPDATE' then old.admin_comments else null end,
        new.admin_comments, new.reviewer_id, new.reviewer_name, new.reviewed_at
    );
    return new;
end;
$$;

drop trigger if exists client_assessment_decisions_stamp on public.client_assessment_decisions;
create trigger client_assessment_decisions_stamp
before insert or update on public.client_assessment_decisions
for each row execute function private.stamp_client_assessment_decision();
drop trigger if exists client_assessment_decisions_audit on public.client_assessment_decisions;
create trigger client_assessment_decisions_audit
after insert or update on public.client_assessment_decisions
for each row execute function private.audit_client_assessment_decision();

create or replace function public.save_client_assessment_service_decision(
    p_client_id uuid,
    p_enquiry_id uuid,
    p_service_code text,
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
        raise exception 'Assessment write permission is required for this client.' using errcode = '42501';
    end if;
    if p_client_id is null or p_enquiry_id is null or nullif(btrim(p_service_code), '') is null or not exists (
        select 1 from public.enquiries e
        where e.id = p_enquiry_id and e.client_id = p_client_id and length(btrim(p_service_code)) <= 100
          and p_service_code = any(e.services)
          and p_service_code <> 'autos'
    ) then
        raise exception 'Select an enquiry belonging to this client.' using errcode = '23514';
    end if;
    if p_decision is null or p_decision not in ('approved', 'on_hold', 'rejected') then
        raise exception 'Choose an approved, on-hold, or rejected decision.' using errcode = '22023';
    end if;
    if p_decision in ('on_hold', 'rejected') and nullif(btrim(p_assessment_reason), '') is null then
        raise exception 'A reason is required for an on-hold or rejected decision.' using errcode = '22023';
    end if;
    if length(coalesce(p_assessment_reason, '')) > 4000 or length(coalesce(p_admin_comments, '')) > 8000 then
        raise exception 'Assessment reason or comments exceed the allowed length.' using errcode = '22023';
    end if;

    insert into public.client_assessment_decisions (
        client_id, enquiry_id, service_code, decision, assessment_reason, admin_comments,
        reviewer_id, reviewer_name
    ) values (
        p_client_id, p_enquiry_id, btrim(p_service_code), p_decision, nullif(btrim(p_assessment_reason), ''),
        coalesce(p_admin_comments, ''), auth.uid(), 'Pending reviewer stamp'
    )
    on conflict (client_id, enquiry_id, service_code) where enquiry_id is not null and service_code is not null
    do update set decision = excluded.decision,
                  assessment_reason = excluded.assessment_reason,
                  admin_comments = excluded.admin_comments
    returning id into saved_decision_id;
    return saved_decision_id;
end;
$$;

revoke all on function public.save_client_assessment_service_decision(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.save_client_assessment_service_decision(uuid, uuid, text, text, text, text) to authenticated;
-- Preserve legacy endpoint during coordinated deployment. Its writes are payment-gated by the trigger.
CREATE OR REPLACE FUNCTION public.save_client_assessment_decision(p_client_id uuid, p_decision text, p_assessment_reason text, p_admin_comments text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    saved_decision_id uuid;
begin
    if auth.uid() is null
       or not private.has_permission('applications.write')
       or not private.can_access_client(p_client_id) then
        raise exception 'Assessment write permission is required for this client.'
            using errcode = '42501';
    end if;

    if p_decision is null or p_decision not in ('approved', 'on_hold', 'rejected') then
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
    on conflict (client_id) where enquiry_id is null do update set
        decision = excluded.decision,
        assessment_reason = excluded.assessment_reason,
        admin_comments = excluded.admin_comments
    returning id into saved_decision_id;

    return saved_decision_id;
end;
$function$
;

-- Keep the existing queue's return type and legacy decision fields stable.
-- Enquiry-scoped decisions are loaded separately by the permission-checked Admin frontend.
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
    left join lateral (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', e.id,
            'reference', coalesce(source_row.row_data->>'reference', source_row.row_data->>'enquiry_reference'),
            'created_at', coalesce(source_row.row_data->>'created_at', source_row.row_data->>'submitted_at'),
            'services', source_row.row_data->'services', 'service', source_row.row_data->'service',
            'destination', source_row.row_data->'destination', 'details', source_row.row_data->'details',
            'education', source_row.row_data->'education', 'careers', source_row.row_data->'careers',
            'travel', source_row.row_data->'travel', 'business', source_row.row_data->'business',
            'mobility', source_row.row_data->'mobility', 'general', source_row.row_data->'general',
            'is_education', private.assessment_is_education(source_row.row_data),
            'desk_names', desk_data.names,
            'client_assessment', case when private.assessment_is_education(source_row.row_data) then
                jsonb_build_object(
                    'id', a.id,
                    'status', case when a.id is not null then a.status
                        when exists (select 1 from public.client_assessment_payments p
                            where p.client_id = c.id and p.purpose = 'initial_assessment_consultation'
                              and p.status = 'paid' and p.verification_status = 'verified') then 'ready_to_begin'
                        else 'awaiting_payment' end,
                    'submitted_at', a.submitted_at, 'updated_at', a.updated_at, 'current_step', a.current_step,
                    'payment_authorized', exists (select 1 from public.client_assessment_payments p
                        where p.client_id = c.id and p.purpose = 'initial_assessment_consultation'
                          and p.status = 'paid' and p.verification_status = 'verified')
                ) else jsonb_build_object('status', 'not_applicable', 'payment_authorized', private.client_assessment_payment_verified(c.id)) end
        )) order by coalesce(source_row.row_data->>'created_at', source_row.row_data->>'submitted_at') desc nulls last) as items
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
    left join public.client_assessment_decisions d on d.client_id = c.id and d.enquiry_id is null
    where private.can_access_client(c.id) and (enquiry_data.items is not null or d.id is not null)
    order by (d.id is null) desc, d.updated_at desc nulls last, c.full_name;
end;
$$;

revoke all on function public.list_client_assessment_queue() from public, anon;
grant execute on function public.list_client_assessment_queue() to authenticated;

create or replace function public.save_client_assessment_consultation_notes(p_enquiry_id uuid, p_notes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare assessment_client_id uuid;
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    if p_notes is null or jsonb_typeof(p_notes) <> 'object' or octet_length(p_notes::text) > 20000 then
        raise exception 'Consultation notes are invalid or exceed the allowed size.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(p_notes) entry
        where entry.key not in ('academic_findings','language_readiness','financial_readiness','consultation_notes',
            'recommended_destination','recommended_pathway','preparation_requirements','recommended_next_action')
          or jsonb_typeof(entry.value) <> 'string' or length(entry.value #>> '{}') > 4000) then
        raise exception 'Consultation notes contain an unsupported or overlong field.' using errcode = '22023';
    end if;
    select e.client_id into assessment_client_id from public.enquiries e where e.id = p_enquiry_id;
    if assessment_client_id is null or not private.can_access_client(assessment_client_id) then
        raise exception 'Enquiry not found or access denied.' using errcode = '42501';
    end if;
    insert into public.client_assessment_consultation_notes(enquiry_id, client_id, notes, updated_by, updated_at)
    values (p_enquiry_id, assessment_client_id, p_notes, auth.uid(), now())
    on conflict (enquiry_id) do update set notes = public.client_assessment_consultation_notes.notes || excluded.notes, updated_by = excluded.updated_by, updated_at = now();
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
    education_enquiry boolean;
begin
    if auth.uid() is null or not private.has_permission('applications.read') then
        raise exception 'Assessment read permission is required.' using errcode = '42501';
    end if;
    select e.client_id, to_jsonb(e) into enquiry_client_id, enquiry_row from public.enquiries e where e.id = p_enquiry_id;
    if enquiry_client_id is null or not private.can_access_client(enquiry_client_id) then
        raise exception 'Enquiry was not found or access is denied.' using errcode = '42501';
    end if;
    education_enquiry := private.assessment_is_education(enquiry_row);
    if education_enquiry then
        select * into assessment_row from public.client_assessments a
        where a.enquiry_id = p_enquiry_id and a.client_id = enquiry_client_id;
        select coalesce(jsonb_agg(jsonb_build_object('revision', h.revision, 'responses', h.responses, 'submitted_at', h.submitted_at)
            order by h.revision desc), '[]'::jsonb) into previous_submissions
        from public.client_assessment_submission_history h where h.assessment_id = assessment_row.id;
        payment_authorized := private.client_assessment_payment_verified(enquiry_client_id);
    else
        assessment_row.id := null;
        previous_submissions := '[]'::jsonb;
        payment_authorized := private.client_assessment_payment_verified(enquiry_client_id);
    end if;
    select coalesce(n.notes, '{}'::jsonb) into assessment_notes from public.client_assessment_consultation_notes n
    where n.enquiry_id = p_enquiry_id and n.client_id = enquiry_client_id;
    return jsonb_build_object(
        'enquiry_id', p_enquiry_id, 'client_id', enquiry_client_id,
        'is_education', education_enquiry, 'payment_authorized', payment_authorized,
        'assessment', case when not education_enquiry then jsonb_build_object('status','not_applicable')
            when assessment_row.id is null then jsonb_build_object('status',case when payment_authorized then 'ready_to_begin' else 'awaiting_payment' end)
            else jsonb_build_object('id',assessment_row.id,'status',assessment_row.status,'responses',assessment_row.responses,
                'current_step',assessment_row.current_step,'submitted_at',assessment_row.submitted_at,'updated_at',assessment_row.updated_at) end,
        'consultation_notes', coalesce(assessment_notes, '{}'::jsonb),
        'submission_history', coalesce(previous_submissions, '[]'::jsonb)
    );
end;
$$;

revoke all on function public.get_client_assessment_review(uuid) from public, anon;
grant execute on function public.get_client_assessment_review(uuid) to authenticated;
revoke all on function public.save_client_assessment_consultation_notes(uuid, jsonb) from public, anon;
grant execute on function public.save_client_assessment_consultation_notes(uuid, jsonb) to authenticated;

-- Client-owned RPC: returns service-specific outcomes only. Internal notes,
-- decision reasons and administrator comments are not exposed to clients.
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
        'id', c.id, 'client_code', to_jsonb(c)->>'client_code', 'full_name', c.full_name,
        'email', coalesce(to_jsonb(c)->>'email', auth.jwt()->>'email'),
        'whatsapp', to_jsonb(c)->>'whatsapp', 'nationality', to_jsonb(c)->>'nationality',
        'current_country', to_jsonb(c)->>'current_country'
    )) into client_row from public.clients c where c.id = own_client_id;
    select private.current_client_id() = own_client_id and exists (
        select 1 from public.client_assessment_payments p where p.client_id = own_client_id
          and p.purpose = 'initial_assessment_consultation' and p.status = 'paid' and p.verification_status = 'verified'
    ) into payment_authorized;
    payment_authorized := coalesce(payment_authorized, false);

    select coalesce(jsonb_agg(item order by created_at desc nulls last), '[]'::jsonb) into enquiry_rows
    from (
        select e.created_at,
            jsonb_build_object(
                'id', e.id,
                'reference', coalesce(to_jsonb(e)->>'reference', to_jsonb(e)->>'enquiry_reference'),
                'created_at', e.created_at, 'services', to_jsonb(e)->'services',
                'service', to_jsonb(e)->'service', 'destination', to_jsonb(e)->'destination',
                'is_education', private.assessment_is_education(to_jsonb(e)),
                'enquiry', jsonb_strip_nulls(jsonb_build_object(
                    'education', to_jsonb(e)->'education', 'journey', to_jsonb(e)->'journey', 'careers', to_jsonb(e)->'careers',
                    'travel', to_jsonb(e)->'travel', 'business', to_jsonb(e)->'business',
                    'mobility', to_jsonb(e)->'mobility', 'general', to_jsonb(e)->'general',
                    'details', to_jsonb(e)->'details'
                )),
                'payment_authorized', payment_authorized,
                'assessment', case when not private.assessment_is_education(to_jsonb(e)) then jsonb_build_object('status','not_applicable')
                    when payment_authorized and a.id is not null then jsonb_build_object('id',a.id,'status',a.status,'responses',a.responses,
                        'current_step',a.current_step,'submitted_at',a.submitted_at,'updated_at',a.updated_at)
                    when payment_authorized then jsonb_build_object('status','ready_to_begin')
                    else jsonb_build_object('status','awaiting_payment') end,
                'professional_decisions', (
                    select coalesce(jsonb_agg(jsonb_build_object(
                        'service_code', d.service_code, 'decision', d.decision, 'reviewed_at', d.reviewed_at
                    ) order by d.service_code), '[]'::jsonb)
                    from public.client_assessment_decisions d
                    where d.client_id = own_client_id and d.enquiry_id = e.id and d.service_code is not null
                )
            ) as item
        from public.enquiries e
        left join public.client_assessments a on a.enquiry_id = e.id and a.client_id = own_client_id
        where e.client_id = own_client_id
    ) eligible;
    return jsonb_build_object('client',coalesce(client_row,'{}'::jsonb),
        'payment_authorized',payment_authorized,'enquiries',enquiry_rows,
        'legacy_professional_decision', (select jsonb_build_object('decision',d.decision,'reviewed_at',d.reviewed_at)
            from public.client_assessment_decisions d where d.client_id = own_client_id and d.enquiry_id is null));
end;
$$;

revoke all on function public.get_my_client_assessments() from public, anon;
grant execute on function public.get_my_client_assessments() to authenticated;

comment on table public.client_assessment_decisions is
    'Internal professional decision. New decisions are scoped to one client enquiry and service; legacy client-level decisions remain unscoped and are not applied to services.';
comment on table public.client_assessment_decision_history is
    'Append-only before/after history for legacy client-level and enquiry/service-scoped professional decisions.';

-- Existing questionnaire review actions also require verified payment.
CREATE OR REPLACE FUNCTION public.complete_client_assessment_review(p_assessment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    update public.client_assessments a
    set status = 'assessment_completed', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where a.id = p_assessment_id and private.can_access_client(a.client_id)
      and private.client_assessment_payment_verified(a.client_id)
      and a.status in ('submitted','under_review') and a.submitted_at is not null;
    if not found then
        raise exception 'A submitted assessment could not be completed.' using errcode = 'P0002';
    end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_client_assessment_under_review(p_assessment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    update public.client_assessments a
    set status = 'under_review', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where a.id = p_assessment_id
      and private.can_access_client(a.client_id)
      and private.client_assessment_payment_verified(a.client_id)
      and a.status = 'submitted';
    if not found and not exists (
        select 1 from public.client_assessments a
        where a.id = p_assessment_id and a.status = 'under_review'
          and private.can_access_client(a.client_id)
      and private.client_assessment_payment_verified(a.client_id)
    ) then
        raise exception 'Assessment not found, inaccessible, or not submitted.' using errcode = 'P0002';
    end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reopen_client_assessment_for_clarification(p_assessment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    if auth.uid() is null or not private.has_permission('applications.write') then
        raise exception 'Assessment write permission is required.' using errcode = '42501';
    end if;
    update public.client_assessments a
    set status = 'clarification_required', updated_at = now()
    where a.id = p_assessment_id
      and private.can_access_client(a.client_id)
      and private.client_assessment_payment_verified(a.client_id)
      and a.status in ('submitted', 'under_review', 'assessment_completed');
    if not found then
        raise exception 'A submitted assessment could not be reopened.' using errcode = 'P0002';
    end if;
end;
$function$
;

commit;
