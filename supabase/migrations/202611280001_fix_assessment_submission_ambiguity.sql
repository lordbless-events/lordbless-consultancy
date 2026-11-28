begin;

create or replace function public.submit_my_client_assessment(
    p_enquiry_id uuid,
    p_responses jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
    own_client_id uuid;
    v_assessment_id uuid;
    existing_status text;
    next_revision integer;
begin
    own_client_id := private.current_client_id();

    if auth.uid() is null or own_client_id is null then
        raise exception 'An active client account is required.'
            using errcode = '42501';
    end if;

    if p_responses is null
       or jsonb_typeof(p_responses) <> 'object'
       or octet_length(p_responses::text) > 50000 then
        raise exception 'Assessment responses are invalid.'
            using errcode = '22023';
    end if;

    -- Preserve the existing questionnaire response contract.
    if jsonb_typeof(p_responses->'goals') is distinct from 'object'
       or jsonb_typeof(p_responses->'financial') is distinct from 'object'
       or jsonb_typeof(p_responses->'readiness') is distinct from 'object' then
        raise exception 'Complete all three assessment sections.'
            using errcode = '22023';
    end if;

    if coalesce(p_responses #>> '{goals,pathway}', '') not in (
        'bachelors',
        'masters',
        'phd',
        'ausbildung',
        'nursing_ausbildung',
        'specialist_healthcare',
        'language_preparation',
        'conferences',
        'other',
        'undecided'
    )
    or jsonb_typeof(p_responses #> '{goals,destination}')
        is distinct from 'string'
    or nullif(btrim(p_responses #>> '{goals,destination}'), '') is null then
        raise exception 'Choose an intended pathway and preferred destination, or Not yet decided.'
            using errcode = '22023';
    end if;

    if coalesce(p_responses #>> '{financial,funding_source}', '') not in (
        'Self-funded',
        'Parent',
        'Guardian',
        'Spouse',
        'Other family member',
        'Employer or organisation',
        'Scholarship or sponsorship',
        'Multiple funding sources',
        'Funding arrangements not yet determined'
    )
    or coalesce(p_responses #>> '{financial,financial_preparation}', '') not in (
        'Fully prepared',
        'Partially prepared',
        'Currently saving',
        'My sponsor has committed to providing funds',
        'Seeking scholarship or sponsorship',
        'Not yet financially prepared'
    )
    or coalesce(p_responses #>> '{financial,consultancy_readiness}', '') not in (
        'Yes, I am ready to proceed',
        'Yes, subject to the proposed quotation',
        'My sponsor will cover these services',
        'I require additional time',
        'I would like to discuss the available arrangements'
    ) then
        raise exception 'Complete the required financial readiness questions.'
            using errcode = '22023';
    end if;

    if coalesce(p_responses #>> '{readiness,start_timing}', '') not in (
        'Immediately',
        'Within 1 to 3 months',
        'Within 3 to 6 months',
        'Within 6 to 12 months',
        'Not yet decided'
    ) then
        raise exception 'Choose your intended starting timeframe.'
            using errcode = '22023';
    end if;

    -- Preserve the verified payment requirement.
    if not exists (
        select 1
        from public.client_assessment_payments p
        where p.client_id = own_client_id
          and p.purpose = 'initial_assessment_consultation'
          and p.status = 'paid'
          and p.verification_status = 'verified'
    ) then
        raise exception 'Your assessment is available after the initial consultation and assessment payment is verified.'
            using errcode = '42501';
    end if;

    -- Preserve enquiry ownership and Education eligibility.
    if not exists (
        select 1
        from public.enquiries e
        where e.id = p_enquiry_id
          and e.client_id = own_client_id
          and private.assessment_is_education(to_jsonb(e))
    ) then
        raise exception 'The Education enquiry was not found for this account.'
            using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_enquiry_id::text, 0)
    );

    select a.id, a.status
    into v_assessment_id, existing_status
    from public.client_assessments a
    where a.enquiry_id = p_enquiry_id
      and a.client_id = own_client_id
    for update;

    if existing_status in (
        'submitted',
        'under_review',
        'assessment_completed'
    ) then
        raise exception 'This assessment has already been submitted.'
            using errcode = '23505';
    end if;

    if v_assessment_id is null then

        insert into public.client_assessments (
            client_id,
            enquiry_id,
            responses,
            current_step
        )
        values (
            own_client_id,
            p_enquiry_id,
            p_responses,
            4
        )
        returning id into v_assessment_id;

    else

        update public.client_assessments
        set responses = p_responses,
            current_step = 4
        where id = v_assessment_id;

    end if;

    -- Corrected ambiguous variable reference.
    select coalesce(max(h.revision), 0) + 1
    into next_revision
    from public.client_assessment_submission_history h
    where h.assessment_id = v_assessment_id;

    insert into public.client_assessment_submission_history (
        assessment_id,
        client_id,
        revision,
        responses,
        submitted_by
    )
    values (
        v_assessment_id,
        own_client_id,
        next_revision,
        p_responses,
        auth.uid()
    );

    update public.client_assessments
    set status = 'submitted',
        submitted_at = now(),
        updated_at = now()
    where id = v_assessment_id;

    return v_assessment_id;

end;
$function$;

commit;