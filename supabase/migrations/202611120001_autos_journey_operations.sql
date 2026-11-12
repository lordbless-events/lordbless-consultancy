-- AUTOS journey stages and private journey change history.
-- Additive migration. Preserves existing journey rows and existing stage values.
-- Prerequisite: public.client_journeys.stage and operational_status already exist.
-- Apply through the project's normal Supabase migration process.

DO $preflight$
BEGIN
    IF to_regclass('public.client_journeys') IS NULL THEN
        RAISE EXCEPTION 'Required table public.client_journeys does not exist.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client_journeys'
          AND column_name = 'stage'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client_journeys'
          AND column_name = 'operational_status'
    ) THEN
        RAISE EXCEPTION 'The prerequisite journey stage and operational status migration must be applied first.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.client_journeys
        WHERE stage IS NULL
           OR operational_status IS NULL
           OR stage NOT IN (
                'enquiry', 'assessment', 'planning', 'preparation',
                'applications_approvals', 'visa_processing', 'travel',
                'arrival', 'completed',
                'enquiry_received', 'enquiry_reviewed',
                'availability_confirmation', 'quotation_preparation',
                'quotation_sent', 'awaiting_customer_decision',
                'order_confirmed', 'payment_processing', 'vehicle_sourcing',
                'inspection_documentation', 'shipping_preparation', 'in_transit',
                'arrived_in_ghana', 'customs_clearing', 'delivery_arrangements',
                'delivered', 'autos_completed'
           )
           OR operational_status NOT IN (
                'active', 'on_hold', 'completed', 'cancelled', 'unsuccessful'
           )
    ) THEN
        RAISE EXCEPTION 'A current journey has a NULL or unsupported stage/status. No migration changes have been made.';
    END IF;
END;
$preflight$;

-- Replace only the named stage/status constraints with the expanded value sets.
ALTER TABLE public.client_journeys
    DROP CONSTRAINT IF EXISTS client_journeys_stage_check,
    DROP CONSTRAINT IF EXISTS client_journeys_operational_status_check;

ALTER TABLE public.client_journeys
    ADD CONSTRAINT client_journeys_stage_check CHECK (
        stage IN (
            'enquiry', 'assessment', 'planning', 'preparation',
            'applications_approvals', 'visa_processing', 'travel',
            'arrival', 'completed',
            'enquiry_received', 'enquiry_reviewed',
            'availability_confirmation', 'quotation_preparation',
            'quotation_sent', 'awaiting_customer_decision',
            'order_confirmed', 'payment_processing', 'vehicle_sourcing',
            'inspection_documentation', 'shipping_preparation', 'in_transit',
            'arrived_in_ghana', 'customs_clearing', 'delivery_arrangements',
            'delivered', 'autos_completed'
        )
    ),
    ADD CONSTRAINT client_journeys_operational_status_check CHECK (
        operational_status IN ('active', 'on_hold', 'completed', 'cancelled', 'unsuccessful')
    );

-- Phase 1: prevent a client account from directly reading its own AUTOS journey.
-- Existing permissive journey policies and this restrictive policy work together.
DROP POLICY IF EXISTS client_journeys_hide_autos_from_clients
    ON public.client_journeys;

CREATE POLICY client_journeys_hide_autos_from_clients
ON public.client_journeys
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
    private.current_client_id() IS NULL
    OR private.current_client_id() <> client_id
    OR (
        (
            COALESCE(journey_type, '') || ' ' ||
            COALESCE(service, '') || ' ' ||
            COALESCE(title, '')
        ) NOT ILIKE '%autos%'
        AND
        (
            COALESCE(journey_type, '') || ' ' ||
            COALESCE(service, '') || ' ' ||
            COALESCE(title, '')
        ) NOT ILIKE '%vehicle sourcing%'
    )
);

-- Private audit history. The trigger function writes rows; authenticated users
-- receive SELECT only, with access controlled by the policy below.
CREATE TABLE IF NOT EXISTS public.client_journey_stage_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_id uuid NOT NULL
        REFERENCES public.client_journeys(id) ON DELETE RESTRICT,
    previous_stage text,
    new_stage text NOT NULL,
    previous_operational_status text,
    new_operational_status text NOT NULL,
    internal_note text NOT NULL DEFAULT '',
    changed_by uuid,
    changed_by_name text NOT NULL DEFAULT 'System',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_journey_stage_history_journey_created_idx
    ON public.client_journey_stage_history (journey_id, created_at DESC);

ALTER TABLE public.client_journey_stage_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_journey_stage_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_journey_stage_history TO authenticated;

DROP POLICY IF EXISTS client_journey_stage_history_read_staff
    ON public.client_journey_stage_history;

CREATE POLICY client_journey_stage_history_read_staff
ON public.client_journey_stage_history
FOR SELECT
TO authenticated
USING (
    private.is_overall_admin()
    OR (
        private.current_client_id() IS NULL
        AND private.has_permission('journeys.read')
        AND EXISTS (
            SELECT 1
            FROM public.client_journeys AS journey
            WHERE journey.id = client_journey_stage_history.journey_id
              AND private.can_access_client(journey.client_id)
        )
    )
);

-- Record inserts and changes to stage/status. The note is transaction-local
-- and is set only by the controlled RPC below.
CREATE OR REPLACE FUNCTION private.record_client_journey_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    actor_name text;
    change_note text := COALESCE(
        pg_catalog.current_setting('app.journey_change_note', true),
        ''
    );
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.stage IS NOT DISTINCT FROM OLD.stage
       AND NEW.operational_status IS NOT DISTINCT FROM OLD.operational_status
       AND NULLIF(pg_catalog.btrim(change_note), '') IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(
        NULLIF(pg_catalog.btrim(profile.display_name), ''),
        auth.uid()::text,
        'System'
    )
    INTO actor_name
    FROM public.staff_profiles AS profile
    WHERE profile.user_id = auth.uid();

    actor_name := COALESCE(actor_name, auth.uid()::text, 'System');

    INSERT INTO public.client_journey_stage_history (
        journey_id,
        previous_stage,
        new_stage,
        previous_operational_status,
        new_operational_status,
        internal_note,
        changed_by,
        changed_by_name,
        created_at
    )
    VALUES (
        NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage ELSE NULL END,
        NEW.stage,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.operational_status ELSE NULL END,
        NEW.operational_status,
        pg_catalog.btrim(change_note),
        auth.uid(),
        actor_name,
        pg_catalog.now()
    );

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_client_journey_stage_change()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS client_journey_stage_history_record
    ON public.client_journeys;

CREATE TRIGGER client_journey_stage_history_record
AFTER INSERT OR UPDATE OF stage, operational_status
ON public.client_journeys
FOR EACH ROW
EXECUTE FUNCTION private.record_client_journey_stage_change();

-- Controlled staff update entry point. SECURITY DEFINER is paired with explicit
-- staff, permission, and client-assignment checks so it cannot bypass the
-- existing client_journeys access model.
CREATE OR REPLACE FUNCTION public.update_client_journey_progress(
    p_journey_id uuid,
    p_stage text,
    p_operational_status text,
    p_internal_note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    journey_client_id uuid;
BEGIN
    -- Client accounts must not use this staff-only operation, even if an
    -- account is accidentally granted a similarly named permission.
    IF auth.uid() IS NULL
       OR private.current_client_id() IS NOT NULL
       OR NOT private.has_permission('journeys.write') THEN
        RAISE EXCEPTION 'Active staff journey write permission is required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_journey_id IS NULL
       OR p_stage IS NULL
       OR p_operational_status IS NULL
       OR p_stage NOT IN (
            'enquiry', 'assessment', 'planning', 'preparation',
            'applications_approvals', 'visa_processing', 'travel',
            'arrival', 'completed',
            'enquiry_received', 'enquiry_reviewed',
            'availability_confirmation', 'quotation_preparation',
            'quotation_sent', 'awaiting_customer_decision',
            'order_confirmed', 'payment_processing', 'vehicle_sourcing',
            'inspection_documentation', 'shipping_preparation', 'in_transit',
            'arrived_in_ghana', 'customs_clearing', 'delivery_arrangements',
            'delivered', 'autos_completed'
       )
       OR p_operational_status NOT IN (
            'active', 'on_hold', 'completed', 'cancelled', 'unsuccessful'
       )
       OR pg_catalog.length(COALESCE(p_internal_note, '')) > 3000 THEN
        RAISE EXCEPTION 'Journey ID, stage, operational status or internal note is invalid.'
            USING ERRCODE = '22023';
    END IF;

    SELECT journey.client_id
    INTO journey_client_id
    FROM public.client_journeys AS journey
    WHERE journey.id = p_journey_id
    FOR UPDATE;

    IF NOT FOUND
       OR journey_client_id IS NULL
       OR NOT private.can_access_client(journey_client_id) THEN
        RAISE EXCEPTION 'Journey was not found or is outside your authorised client scope.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.set_config(
        'app.journey_change_note',
        COALESCE(p_internal_note, ''),
        true
    );

    UPDATE public.client_journeys
    SET stage = p_stage,
        operational_status = p_operational_status,
        updated_at = pg_catalog.now()
    WHERE id = p_journey_id;

    -- Clear the transaction-local note immediately after the audited update.
    PERFORM pg_catalog.set_config('app.journey_change_note', '', true);

    RETURN p_journey_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_client_journey_progress(uuid, text, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_client_journey_progress(uuid, text, text, text)
    TO authenticated;
