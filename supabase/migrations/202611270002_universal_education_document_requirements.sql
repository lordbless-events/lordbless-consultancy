
/* ============================================================
   LORDBLESS CONSULTANCY

   UNIVERSAL GLOBAL EDUCATION DOCUMENT REQUIREMENTS

   Migration: 202611270002
   Date: 27 November 2026

   Guiding principle:
   Maximum automation, minimum administration.

   Production status:
   All constituent SQL changes already executed successfully.
   This consolidated migration preserves the local SQL history.
============================================================ */

begin;


/* ============================================================
   1. JOURNEY PATHWAY COLUMN
============================================================ */

alter table public.client_journeys
add column if not exists pathway_code text;

comment on column public.client_journeys.pathway_code is
'Confirmed consultancy pathway used to determine applicable document requirements.';


/* ============================================================
   2. UNIVERSAL PATHWAY DOCUMENT TEMPLATE CONFIGURATION
============================================================ */

create table if not exists public.pathway_document_templates (

    id uuid primary key default gen_random_uuid(),

    journey_type text not null,

    destination text not null,

    pathway_code text not null,

    document_type text not null,

    document_name text not null,

    category text not null default 'General',

    requirement_class text not null default 'basic'
        check (
            requirement_class in (
                'basic',
                'conditional',
                'agency_prepared',
                'later_stage'
            )
        ),

    instructions text not null default '',

    allow_automatic_reuse boolean not null default false,

    sort_order integer not null default 0,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint pathway_document_templates_unique
        unique (
            journey_type,
            destination,
            pathway_code,
            document_type,
            document_name
        )
);

alter table public.pathway_document_templates
enable row level security;

revoke all on public.pathway_document_templates
from anon, authenticated;


/* ============================================================
   3. UNIVERSAL GLOBAL EDUCATION TEMPLATE POPULATION

   Destination ALL applies across all countries.

   Supported pathways:
   - Bachelor's Degree
   - Master's Degree
   - PhD
   - General Ausbildung
   - Nursing Ausbildung
   - Specialist Healthcare Education
   - Language and Academic Preparation
   - International Conferences and CPD
============================================================ */


/* ------------------------------------------------------------
   3.1 PASSPORT AND CV FOR ALL PATHWAYS
------------------------------------------------------------ */

insert into public.pathway_document_templates (
    journey_type,
    destination,
    pathway_code,
    document_type,
    document_name,
    category,
    requirement_class,
    instructions,
    allow_automatic_reuse,
    sort_order
)
select
    'Education',
    'ALL',
    pathway_code,
    document_type,
    document_name,
    category,
    'basic',
    instructions,
    allow_automatic_reuse,
    sort_order
from (
    values
        ('bachelors'),
        ('masters'),
        ('phd'),
        ('general_ausbildung'),
        ('nursing_ausbildung'),
        ('specialist_healthcare'),
        ('language_preparation'),
        ('conference_cpd')
) as pathways(pathway_code)
cross join (
    values
        (
            'passport',
            'International Passport',
            'Identity',
            'Upload your valid international passport.',
            true,
            10
        ),
        (
            'cv',
            'CV / Résumé',
            'Career',
            'Upload your current CV.',
            false,
            20
        )
) as documents(
    document_type,
    document_name,
    category,
    instructions,
    allow_automatic_reuse,
    sort_order
)
on conflict do nothing;


/* ------------------------------------------------------------
   3.2 SECONDARY SCHOOL QUALIFICATIONS
------------------------------------------------------------ */

insert into public.pathway_document_templates (
    journey_type,
    destination,
    pathway_code,
    document_type,
    document_name,
    category,
    requirement_class,
    instructions,
    sort_order
)
select
    'Education',
    'ALL',
    pathway_code,
    'academic_certificate',
    'Secondary School Certificate / WASSCE',
    'Education',
    'basic',
    'Upload your secondary school certificate or equivalent results.',
    30
from (
    values
        ('bachelors'),
        ('masters'),
        ('phd'),
        ('general_ausbildung'),
        ('nursing_ausbildung'),
        ('language_preparation')
) as pathways(pathway_code)
on conflict do nothing;


/* ------------------------------------------------------------
   3.3 UNDERGRADUATE QUALIFICATIONS FOR MASTER'S AND PHD
------------------------------------------------------------ */

insert into public.pathway_document_templates (
    journey_type,
    destination,
    pathway_code,
    document_type,
    document_name,
    category,
    requirement_class,
    instructions,
    sort_order
)
select
    'Education',
    'ALL',
    pathway_code,
    document_type,
    document_name,
    'Education',
    'basic',
    instructions,
    sort_order
from (
    values
        ('masters'),
        ('phd')
) as pathways(pathway_code)
cross join (
    values
        (
            'academic_certificate',
            'Bachelor''s Degree Certificate',
            'Upload your Bachelor''s Degree certificate.',
            40
        ),
        (
            'academic_transcript',
            'Undergraduate Academic Transcript',
            'Upload your undergraduate academic transcript.',
            50
        )
) as documents(
    document_type,
    document_name,
    instructions,
    sort_order
)
on conflict do nothing;


/* ------------------------------------------------------------
   3.4 SPECIALIST AND CONDITIONAL QUALIFICATIONS
------------------------------------------------------------ */

insert into public.pathway_document_templates (
    journey_type,
    destination,
    pathway_code,
    document_type,
    document_name,
    category,
    requirement_class,
    instructions,
    sort_order
)
values
(
    'Education',
    'ALL',
    'specialist_healthcare',
    'professional_certificate',
    'Professional Qualification Certificate',
    'Education',
    'basic',
    'Upload your professional qualification certificate.',
    30
),
(
    'Education',
    'ALL',
    'specialist_healthcare',
    'academic_transcript',
    'Academic Transcript',
    'Education',
    'basic',
    'Upload your academic transcript.',
    40
),
(
    'Education',
    'ALL',
    'conference_cpd',
    'professional_certificate',
    'Professional Qualification Certificate',
    'Education',
    'conditional',
    'Upload your relevant professional qualification, if applicable.',
    30
),
(
    'Education',
    'ALL',
    'phd',
    'academic_certificate',
    'Master''s Degree Certificate',
    'Education',
    'conditional',
    'Upload your Master''s Degree certificate, if available.',
    60
),
(
    'Education',
    'ALL',
    'phd',
    'academic_transcript',
    'Postgraduate Academic Transcript',
    'Education',
    'conditional',
    'Upload your postgraduate transcript, if available.',
    70
)
on conflict do nothing;


/* ============================================================
   4. AUTOMATIC JOURNEY DOCUMENT REQUIREMENT GENERATION

   Responsibilities:
   - Validate staff permissions.
   - Validate journey and enquiry ownership.
   - Save the confirmed pathway.
   - Generate basic document requirements.
   - Reuse eligible approved passports.
   - Avoid duplicate matching requests.
   - Reuse the existing document request RPC.
   - Return a generation summary.
============================================================ */

create or replace function public.generate_journey_document_requirements(
    p_journey_id uuid,
    p_pathway_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$

declare

    journey_record public.client_journeys%rowtype;

    template_record record;

    requirement_record public.enquiry_requirements%rowtype;

    v_requirement_id uuid;

    v_document_id uuid;

    v_created integer := 0;

    v_reused integer := 0;

    v_existing integer := 0;

begin


    /* --------------------------------------------------------
       4.1 STAFF PERMISSIONS
    -------------------------------------------------------- */

    if auth.uid() is null
       or private.current_client_id() is not null
       or not private.has_permission('journeys.write')
       or not private.has_permission('documents.review')
    then

        raise exception 'Staff permission required.'
        using errcode = '42501';

    end if;


    /* --------------------------------------------------------
       4.2 VALIDATE JOURNEY
    -------------------------------------------------------- */

    select *
    into journey_record
    from public.client_journeys
    where id = p_journey_id
    for update;

    if not found then

        raise exception 'Journey not found.';

    end if;

    if not private.can_access_client(journey_record.client_id) then

        raise exception 'Client access denied.'
        using errcode = '42501';

    end if;

    if lower(journey_record.journey_type) <> 'education'
       or journey_record.operational_status <> 'active'
       or journey_record.enquiry_id is null
    then

        raise exception
        'An active, enquiry-linked Education journey is required.';

    end if;

    perform 1
    from public.enquiries
    where id = journey_record.enquiry_id
      and client_id = journey_record.client_id
    for update;

    if not found then

        raise exception
        'Invalid journey and enquiry relationship.';

    end if;

    if private.is_autos_enquiry(journey_record.enquiry_id) then

        raise exception 'AUTOS enquiries are not supported.';

    end if;


    /* --------------------------------------------------------
       4.3 VALIDATE PATHWAY
    -------------------------------------------------------- */

    if not exists (
        select 1
        from public.pathway_document_templates
        where journey_type = 'Education'
          and destination = 'ALL'
          and pathway_code = p_pathway_code
          and requirement_class = 'basic'
          and active = true
    ) then

        raise exception 'Unsupported Education pathway.';

    end if;

    if journey_record.pathway_code is not null
       and journey_record.pathway_code <> p_pathway_code
    then

        raise exception
        'An existing pathway must be reviewed before changing it.';

    end if;


    /* --------------------------------------------------------
       4.4 SAVE CONFIRMED PATHWAY
    -------------------------------------------------------- */

    update public.client_journeys
    set pathway_code = p_pathway_code,
        updated_at = now()
    where id = p_journey_id;


    /* --------------------------------------------------------
       4.5 GENERATE BASIC DOCUMENT REQUIREMENTS
    -------------------------------------------------------- */

    for template_record in

        select *
        from public.pathway_document_templates
        where journey_type = 'Education'
          and destination = 'ALL'
          and pathway_code = p_pathway_code
          and requirement_class = 'basic'
          and active = true
        order by sort_order

    loop

        v_requirement_id := null;

        v_document_id := null;


        /* ----------------------------------------------------
           FIND EXISTING REQUIREMENT
        ---------------------------------------------------- */

        select *
        into requirement_record
        from public.enquiry_requirements
        where enquiry_id = journey_record.enquiry_id
          and document_type = template_record.document_type
          and document_name = template_record.document_name
        order by created_at, id
        limit 1;

        if found then

            v_requirement_id := requirement_record.id;

            if requirement_record.status in (
                'satisfied',
                'reviewing'
            ) then

                v_existing := v_existing + 1;

                continue;

            end if;

        end if;


        /* ----------------------------------------------------
           PREVENT DUPLICATE REQUESTS
        ---------------------------------------------------- */

        if exists (
            select 1
            from public.document_requests
            where client_id = journey_record.client_id
              and enquiry_id = journey_record.enquiry_id
              and (
                  requirement_id = v_requirement_id
                  or (
                      document_type = template_record.document_type
                      and document_name = template_record.document_name
                  )
              )
              and status <> 'cancelled'
        ) then

            v_existing := v_existing + 1;

            continue;

        end if;


        /* ----------------------------------------------------
           REUSE ELIGIBLE APPROVED PASSPORT
        ---------------------------------------------------- */

        if template_record.allow_automatic_reuse
           and template_record.document_type = 'passport'
        then

            select id
            into v_document_id
            from public.client_documents
            where client_id = journey_record.client_id
              and document_type = 'passport'
              and status = 'approved'
              and is_current = true
              and is_reusable = true
              and (
                  valid_from is null
                  or valid_from <= current_date
              )
              and valid_until >= current_date
            order by approved_at desc nulls last, id
            limit 1;

        end if;


        /* ----------------------------------------------------
           CREATE REQUIREMENT
        ---------------------------------------------------- */

        if v_requirement_id is null then

            insert into public.enquiry_requirements (
                enquiry_id,
                document_type,
                document_name,
                category,
                required,
                status
            )
            values (
                journey_record.enquiry_id,
                template_record.document_type,
                template_record.document_name,
                template_record.category,
                true,
                'required'
            )
            returning id into v_requirement_id;

        end if;


        /* ----------------------------------------------------
           SATISFY REQUIREMENT WITH EXISTING DOCUMENT
        ---------------------------------------------------- */

        if v_document_id is not null then

            update public.enquiry_requirements
            set client_document_id = v_document_id,
                status = 'satisfied',
                satisfied_at = now(),
                updated_at = now()
            where id = v_requirement_id;

            v_reused := v_reused + 1;

            continue;

        end if;


        /* ----------------------------------------------------
           CREATE REQUEST USING EXISTING PRODUCTION RPC
        ---------------------------------------------------- */

        perform public.create_document_request(
            journey_record.client_id,
            journey_record.enquiry_id,
            v_requirement_id,
            template_record.document_type,
            template_record.document_name,
            'missing',
            template_record.instructions,
            false,
            true,
            false
        );

        v_created := v_created + 1;

    end loop;


    /* --------------------------------------------------------
       4.6 RETURN GENERATION SUMMARY
    -------------------------------------------------------- */

    return jsonb_build_object(
        'success', true,
        'pathway', p_pathway_code,
        'requests_created', v_created,
        'documents_reused', v_reused,
        'existing_requirements', v_existing
    );

end;

$function$;


/* ------------------------------------------------------------
   4.7 FUNCTION EXECUTION PERMISSIONS
------------------------------------------------------------ */

revoke all on function
public.generate_journey_document_requirements(uuid, text)
from public, anon, authenticated;

grant execute on function
public.generate_journey_document_requirements(uuid, text)
to authenticated;


/* ============================================================
   5. JOURNEY PATHWAY ACCESS PERMISSIONS
============================================================ */

grant select (pathway_code)
on public.client_journeys
to authenticated;


/* ============================================================
   6. UPDATE EXISTING ADMIN JOURNEY ACCESS VIEW

   Existing permission conditions are preserved.
   Only pathway_code is appended.
============================================================ */

create or replace view public.client_journeys_internal_access as

select
    id,
    client_id,
    enquiry_id,
    journey_type,
    title,
    destination,
    service,
    operational_status,
    created_at,
    updated_at,
    internal_assignee_id,
    desk_id,
    stage,
    pathway_code

from public.client_journeys j

where (
    private.is_overall_admin()
    or (
        private.has_permission('journeys.read')
        and private.can_access_client(client_id)
        and not private.is_autos_journey(id)
    )
    or (
        private.can_manage_autos()
        and private.is_autos_journey(id)
    )
);


/* ============================================================
   END OF MIGRATION

   Universal Global Education:
   - 8 supported pathways
   - 31 document template entries
   - 28 basic requirements
   - 3 conditional requirements
   - 1 generation engine
   - Existing Document Centre preserved
============================================================ */

commit;
