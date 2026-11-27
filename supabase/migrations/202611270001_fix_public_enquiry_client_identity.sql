-- ============================================================
-- LORDBLESS CONSULTANCY
-- PUBLIC ENQUIRY CLIENT IDENTITY CORRECTION
-- Date: 27 November 2026
-- ============================================================
--
-- Purpose:
-- Prevent public enquiries from automatically merging clients
-- or overwriting existing registered client information.
--
-- Root cause:
-- Previous implementation matched clients by email and
-- WhatsApp number and updated existing client profiles.
--
-- Corrected behaviour:
-- Each public enquiry creates an independent prospective
-- client record.
--
-- Existing client association requires an authorised process.
--
-- Production correction already applied manually.
-- This migration records the corrected production function
-- in the local project repository.
--
-- No changes to:
-- Authentication
-- Client portal activation
-- Finance and payments
-- Documents
-- Assessments
-- Messaging
-- Notices
-- Journey management
-- ============================================================

begin;

create or replace function private.submit_initial_enquiry(
    p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$

declare

    v_client_id uuid;
    v_enquiry_id uuid;
    v_reference text;

    v_full_name text;
    v_email text;
    v_whatsapp text;
    v_current_country text;
    v_nationality text;

    v_services text[];

    v_destination text;
    v_timeframe text;
    v_additional_information text;
    v_preferred_contact text;

    v_education jsonb;
    v_careers jsonb;
    v_travel jsonb;
    v_business jsonb;
    v_mobility jsonb;
    v_general jsonb;

begin

    /* BASIC DATA EXTRACTION */

    v_full_name :=
        nullif(trim(p_data ->> 'full_name'), '');

    v_email :=
        nullif(lower(trim(p_data ->> 'email')), '');

    v_whatsapp :=
        nullif(trim(p_data ->> 'whatsapp'), '');

    v_current_country :=
        nullif(trim(p_data ->> 'current_country'), '');

    v_nationality :=
        nullif(trim(p_data ->> 'nationality'), '');

    /* VALIDATION */

    if v_full_name is null then
        raise exception 'Full name is required';
    end if;

    if length(v_full_name) > 150 then
        raise exception 'Full name is too long';
    end if;

    if v_whatsapp is null then
        raise exception 'WhatsApp number is required';
    end if;

    if length(v_whatsapp) > 50 then
        raise exception 'WhatsApp number is too long';
    end if;

    if v_email is not null
       and length(v_email) > 254 then
        raise exception 'Email address is too long';
    end if;

    /* SERVICES */

    v_services :=
        array(
            select distinct lower(trim(value))
            from jsonb_array_elements_text(
                coalesce(
                    p_data -> 'services',
                    '[]'::jsonb
                )
            )
        );

    if coalesce(cardinality(v_services), 0) = 0 then
        raise exception
            'At least one service must be selected';
    end if;

    if exists (
        select 1
        from unnest(v_services) as service
        where service not in (
            'education',
            'careers',
            'travel',
            'business',
            'mobility',
            'unsure'
        )
    ) then
        raise exception 'Invalid service selected';
    end if;

    /* UNIVERSAL JOURNEY DATA */

    v_destination :=
        nullif(trim(
            p_data #>> '{journey,destination}'
        ), '');

    v_timeframe :=
        nullif(trim(
            p_data #>> '{journey,timeframe}'
        ), '');

    v_additional_information :=
        nullif(trim(
            p_data #>> '{journey,additionalInformation}'
        ), '');

    v_preferred_contact :=
        nullif(trim(
            p_data #>> '{journey,preferredContact}'
        ), '');

    if v_additional_information is not null
       and length(v_additional_information) > 5000 then
        raise exception
            'Additional information is too long';
    end if;

    /* SERVICE-SPECIFIC DATA */

    v_education :=
        coalesce(p_data -> 'education', '{}'::jsonb);

    v_careers :=
        coalesce(p_data -> 'careers', '{}'::jsonb);

    v_travel :=
        coalesce(p_data -> 'travel', '{}'::jsonb);

    v_business :=
        coalesce(p_data -> 'business', '{}'::jsonb);

    v_mobility :=
        coalesce(p_data -> 'mobility', '{}'::jsonb);

    v_general :=
        coalesce(p_data -> 'general', '{}'::jsonb);

    /* ========================================================
       CLIENT IDENTITY PROTECTION

       Public enquiries must not automatically identify,
       merge or overwrite existing clients.

       Shared email addresses or WhatsApp numbers do not
       establish authenticated client ownership.

       Existing client associations require a separate
       authorised identity confirmation process.
       ======================================================== */

    insert into public.clients (
        full_name,
        email,
        whatsapp,
        current_country,
        nationality
    )
    values (
        v_full_name,
        v_email,
        v_whatsapp,
        v_current_country,
        v_nationality
    )
    returning id into v_client_id;

    /* CREATE ENQUIRY */

    insert into public.enquiries (
        client_id,
        services,
        destination,
        timeframe,
        additional_information,
        preferred_contact,
        education,
        careers,
        travel,
        business,
        mobility,
        general,
        source,
        status
    )
    values (
        v_client_id,
        v_services,
        v_destination,
        v_timeframe,
        v_additional_information,
        v_preferred_contact,
        v_education,
        v_careers,
        v_travel,
        v_business,
        v_mobility,
        v_general,
        'website',
        'new'
    )
    returning
        id,
        enquiry_reference
    into
        v_enquiry_id,
        v_reference;

    /* RETURN SAFE PUBLIC RESPONSE */

    return jsonb_build_object(
        'success', true,
        'enquiry_id', v_enquiry_id,
        'reference', v_reference
    );

end;

$function$;

commit;