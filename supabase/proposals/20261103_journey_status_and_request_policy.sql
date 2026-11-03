
-- ============================================================
-- LORDBLESS CONSULTANCY
-- JOURNEY MANAGEMENT: NINE-STAGE MIGRATION
-- ============================================================
--
-- REVIEWED VERSION: 2026-11-03
--
-- IMPORTANT:
-- 1. Review before applying to production.
-- 2. Josephine's old Canton Fair journey and its associated
--    milestone have already been deleted and verified.
-- 3. The production journey table was therefore empty at the
--    time of the cleanup verification.
-- 4. This migration preserves remaining historical request
--    and milestone records.
-- 5. The old milestone and journey-request write workflows
--    are retired.
-- 6. Apply before activating the prepared frontend.
--
-- NEW JOURNEY STAGES:
-- enquiry
-- assessment
-- planning
-- preparation
-- applications_approvals
-- visa_processing
-- travel
-- arrival
-- completed
--
-- OPERATIONAL STATUSES:
-- active
-- on_hold
-- completed
--
-- This is a forward-only migration.
-- Do not run against an unverified schema.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. VERIFY EXPECTED PRODUCTION OBJECTS
-- ============================================================

DO $$
BEGIN

    IF to_regclass('public.client_journeys') IS NULL
       OR to_regclass('public.client_journeys_internal_access') IS NULL
    THEN
        RAISE EXCEPTION
            'Expected journey table and staff view were not found.';
    END IF;

    IF to_regclass('public.client_journey_requests') IS NULL
       OR to_regclass('public.client_journey_milestones') IS NULL
       OR to_regprocedure(
           'public.assign_client_journey_request(uuid,text,text,text,text,text,uuid,uuid)'
       ) IS NULL
       OR to_regprocedure(
           'public.save_client_journey_milestone(uuid,uuid,text,text,integer,date,text)'
       ) IS NULL
    THEN
        RAISE EXCEPTION
            'Expected legacy request or milestone objects were not found.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client_journeys'
          AND column_name IN ('stage', 'operational_status')
    )
    THEN
        RAISE EXCEPTION
            'Journey stage/status migration appears partially or fully applied.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client_journeys'
          AND column_name = 'status'
          AND data_type = 'text'
    )
    THEN
        RAISE EXCEPTION
            'Expected legacy client_journeys.status text column was not found.';
    END IF;

END;
$$;


-- ============================================================
-- 2. REMOVE THE LEGACY STATUS CHECK CONSTRAINT
-- ============================================================

DO $$
DECLARE
    constraint_name TEXT;
BEGIN

    FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.client_journeys'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%'
          AND pg_get_constraintdef(c.oid) ILIKE '%planning%'
    LOOP

        EXECUTE format(
            'ALTER TABLE public.client_journeys DROP CONSTRAINT %I',
            constraint_name
        );

    END LOOP;

END;
$$;


-- ============================================================
-- 3. RENAME LEGACY STATUS AND CREATE NEW STAGE COLUMN
-- ============================================================

ALTER TABLE public.client_journeys
    RENAME COLUMN status TO operational_status;

ALTER VIEW public.client_journeys_internal_access
    RENAME COLUMN status TO operational_status;

ALTER TABLE public.client_journeys
    ADD COLUMN stage TEXT;


-- ============================================================
-- 4. VALIDATE EXISTING JOURNEY RECORDS
-- ============================================================
--
-- Every existing journey must have an explicitly reviewed
-- stage and operational_status.
--
-- No automatic mapping from legacy status is permitted.
--
-- Josephine's old journey has already been deleted.
-- The production journey table was empty at cleanup verification.
--
-- If another journey exists before migration execution,
-- this validation will stop the migration until it is mapped.

DO $$
DECLARE
    unresolved_count BIGINT;
BEGIN

    SELECT COUNT(*)
    INTO unresolved_count
    FROM public.client_journeys
    WHERE stage IS NULL
       OR operational_status NOT IN (
           'active',
           'on_hold',
           'completed'
       );

    IF unresolved_count > 0 THEN

        RAISE EXCEPTION
            '% existing journey records require reviewed stage/status mappings.',
            unresolved_count;

    END IF;

END;
$$;


-- ============================================================
-- 5. APPLY NEW COLUMN DEFAULTS AND CONSTRAINTS
-- ============================================================

ALTER TABLE public.client_journeys

    ALTER COLUMN stage
        SET DEFAULT 'enquiry',

    ALTER COLUMN stage
        SET NOT NULL,

    ALTER COLUMN operational_status
        SET DEFAULT 'active',

    ALTER COLUMN operational_status
        SET NOT NULL,

    ADD CONSTRAINT client_journeys_stage_check
        CHECK (
            stage IN (
                'enquiry',
                'assessment',
                'planning',
                'preparation',
                'applications_approvals',
                'visa_processing',
                'travel',
                'arrival',
                'completed'
            )
        ),

    ADD CONSTRAINT client_journeys_operational_status_check
        CHECK (
            operational_status IN (
                'active',
                'on_hold',
                'completed'
            )
        );


-- ============================================================
-- 6. REBUILD STAFF ACCESS VIEW
-- ============================================================
--
-- Preserve the existing authorization conditions.
-- Expose operational_status and stage.
-- Keep the view read-only for authenticated users.

CREATE OR REPLACE VIEW public.client_journeys_internal_access

WITH (security_barrier = true)

AS

SELECT
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

FROM public.client_journeys AS journeys

WHERE

    private.is_overall_admin()

    OR (

        private.has_permission('journeys.read')

        AND (

            journeys.internal_assignee_id = auth.uid()

            OR private.has_desk_access(journeys.desk_id)

            OR (
                journeys.internal_assignee_id IS NULL
                AND journeys.desk_id IS NULL
                AND private.can_access_client(journeys.client_id)
            )

        )

    );


-- ============================================================
-- 7. CORRECT STAFF VIEW PRIVILEGES
-- ============================================================

REVOKE ALL
ON public.client_journeys_internal_access
FROM public, anon, authenticated;

GRANT SELECT
ON public.client_journeys_internal_access
TO authenticated;


-- ============================================================
-- 8. CORRECT JOURNEY TABLE COLUMN PRIVILEGES
-- ============================================================
--
-- The renamed operational_status column retains the old
-- status column's privileges.
--
-- Explicitly grant access to both new fields to avoid
-- depending on inherited or implicit privileges.

GRANT SELECT (
    stage,
    operational_status
)
ON public.client_journeys
TO authenticated;

GRANT INSERT (
    stage,
    operational_status
)
ON public.client_journeys
TO authenticated;

GRANT UPDATE (
    stage,
    operational_status
)
ON public.client_journeys
TO authenticated;


-- ============================================================
-- 9. RETIRE LEGACY JOURNEY REQUEST WRITE WORKFLOWS
-- ============================================================
--
-- Preserve historical request records and read policies.
-- Remove client request creation and staff review updates.
-- Retain read access.

DROP POLICY IF EXISTS
    client_journey_requests_create_active_client
ON public.client_journey_requests;

DROP POLICY IF EXISTS
    client_journey_requests_staff_update_scoped
ON public.client_journey_requests;

REVOKE INSERT, UPDATE
ON public.client_journey_requests
FROM public, anon, authenticated;


-- Retire the old journey assignment RPC.

REVOKE ALL
ON FUNCTION public.assign_client_journey_request(
    uuid,
    text,
    text,
    text,
    text,
    text,
    uuid,
    uuid
)
FROM public, anon, authenticated, service_role;


-- ============================================================
-- 10. RETIRE LEGACY MILESTONE WRITE WORKFLOW
-- ============================================================
--
-- Preserve historical milestone records and read policies.
-- Retire the old create/update RPC.
--
-- The nine-stage journey is now the authoritative progression.
-- No parallel milestone management is introduced.

REVOKE ALL
ON FUNCTION public.save_client_journey_milestone(
    uuid,
    uuid,
    text,
    text,
    integer,
    date,
    text
)
FROM public, anon, authenticated, service_role;


-- ============================================================
-- 11. COMPLETE MIGRATION
-- ============================================================

COMMIT;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
