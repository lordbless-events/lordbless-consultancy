
-- ============================================================
-- LORDBLESS CONSULTANCY
-- FINANCE MANAGEMENT RECORDS
-- Migration: 202611040002
--
-- PURPOSE:
-- Additional organisational income and expense management.
--
-- SECURITY:
-- Finance access uses a finance-only permission allowlist. Overall Admin
-- retains full access through the existing private.has_permission() rule;
-- Finance permissions do not grant unrelated client-case access.
--
-- Finance permissions:
--   finance.read
--   finance.requests
--
-- Existing verified client assessment payments remain in:
--   public.client_assessment_payments
--
-- No staff accounts or permissions are created here.
-- No existing client, payment, receipt, document or Autos
-- records are modified.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PRODUCTION PREREQUISITE CHECKS
-- ============================================================

DO $$
DECLARE
    staff_user_id_attnum smallint;
BEGIN
    IF to_regclass('public.staff_profiles') IS NULL THEN
        RAISE EXCEPTION 'Missing public.staff_profiles';
    END IF;

    IF to_regclass('public.client_assessment_payments') IS NULL THEN
        RAISE EXCEPTION 'Missing public.client_assessment_payments';
    END IF;

    IF to_regclass('public.staff_permissions') IS NULL THEN
        RAISE EXCEPTION 'Missing public.staff_permissions';
    END IF;

    IF to_regclass('public.staff_roles') IS NULL THEN
        RAISE EXCEPTION 'Missing public.staff_roles';
    END IF;

    IF to_regclass('public.role_permissions') IS NULL THEN
        RAISE EXCEPTION 'Missing public.role_permissions';
    END IF;

    IF to_regprocedure('private.has_permission(text)') IS NULL THEN
        RAISE EXCEPTION 'Missing private.has_permission(text)';
    END IF;

    SELECT attnum
    INTO staff_user_id_attnum
    FROM pg_attribute
    WHERE attrelid = 'public.staff_profiles'::regclass
      AND attname = 'user_id'
      AND NOT attisdropped;

    IF staff_user_id_attnum IS NULL THEN
        RAISE EXCEPTION 'Missing staff_profiles.user_id';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.staff_profiles'::regclass
          AND contype = 'p'
          AND conkey = ARRAY[staff_user_id_attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION
            'staff_profiles.user_id must be the primary key';
    END IF;
END;
$$;

-- ============================================================
-- 2. DEDICATED FINANCE PERMISSION FUNCTION
-- ============================================================

-- Limit this helper to finance permissions, while preserving Overall
-- Admin's existing admin.all authority through private.has_permission().

CREATE OR REPLACE FUNCTION private.has_finance_permission(
    p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
AS $function$

    SELECT
        CASE
            WHEN p_permission_code NOT IN (
                'finance.read',
                'finance.requests',
                'finance.reminders',
                'finance.verify',
                'finance.receipts'
            )
            OR p_permission_code IS NULL
            THEN false

            ELSE private.has_permission(p_permission_code)
        END;

$function$;

-- Only authenticated users need to call this function
-- through the Finance RLS policies.

REVOKE ALL ON FUNCTION
    private.has_finance_permission(text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
    private.has_finance_permission(text)
TO authenticated;

-- ============================================================
-- 3. FINANCE ADJUSTMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finance_adjustments (

    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    entry_type text NOT NULL
        CHECK (entry_type IN ('income', 'expense')),

    entry_date date NOT NULL,

    category text NOT NULL,

    description text NOT NULL
        CHECK (
            length(btrim(description))
            BETWEEN 1 AND 240
        ),

    amount numeric(12,2) NOT NULL
        CHECK (amount > 0),

    additional_amount numeric(12,2) NOT NULL DEFAULT 0
        CHECK (additional_amount >= 0),

    currency text NOT NULL
        CHECK (currency IN ('EUR', 'USD', 'GHS')),

    payment_method text,
    payment_reference text,
    remarks text,

    staff_name text,
    payment_period text,

    created_by uuid NOT NULL DEFAULT auth.uid()
        REFERENCES public.staff_profiles(user_id)
        ON DELETE RESTRICT,

    updated_by uuid NOT NULL DEFAULT auth.uid()
        REFERENCES public.staff_profiles(user_id)
        ON DELETE RESTRICT,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT finance_adjustments_staff_fields_check
    CHECK (
        (
            category IN (
                'staff_remuneration',
                'staff_allowances'
            )
            AND entry_type = 'expense'
            AND nullif(btrim(staff_name), '') IS NOT NULL
            AND nullif(btrim(payment_period), '') IS NOT NULL
        )
        OR category NOT IN (
            'staff_remuneration',
            'staff_allowances'
        )
    ),

    CONSTRAINT finance_adjustments_income_category_check
    CHECK (
        entry_type <> 'income'
        OR category IN (
            'other_organisational_income',
            'investment_income',
            'refund_recovery',
            'other_income'
        )
    ),

    CONSTRAINT finance_adjustments_expense_category_check
    CHECK (
        entry_type <> 'expense'
        OR category IN (
            'internet_wifi',
            'ai_subscriptions',
            'software_subscriptions',
            'electricity',
            'office_expenses',
            'staff_remuneration',
            'staff_allowances',
            'marketing_advertising',
            'transport_logistics',
            'professional_services',
            'equipment_maintenance',
            'other_expenses'
        )
    )
);

-- ============================================================
-- 4. FINANCE AUDIT HISTORY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finance_adjustment_history (

    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    adjustment_id uuid NOT NULL
        REFERENCES public.finance_adjustments(id)
        ON DELETE RESTRICT,

    action text NOT NULL
        CHECK (action IN ('created', 'updated')),

    before_record jsonb,
    after_record jsonb NOT NULL,

    changed_by uuid
        REFERENCES public.staff_profiles(user_id)
        ON DELETE SET NULL,

    changed_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS
    finance_adjustments_date_currency_idx
ON public.finance_adjustments (
    entry_date DESC,
    currency,
    entry_type
);

CREATE INDEX IF NOT EXISTS
    finance_adjustment_history_record_changed_idx
ON public.finance_adjustment_history (
    adjustment_id,
    changed_at DESC
);

-- ============================================================
-- 6. ROW LEVEL SECURITY AND TABLE PRIVILEGES
-- ============================================================

ALTER TABLE public.finance_adjustments
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_adjustment_history
ENABLE ROW LEVEL SECURITY;

-- Remove existing table privileges before granting only
-- the privileges required by the Finance application.

REVOKE ALL ON TABLE
    public.finance_adjustments,
    public.finance_adjustment_history
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.finance_adjustments
TO authenticated;

GRANT SELECT
ON TABLE public.finance_adjustment_history
TO authenticated;

-- No DELETE privilege is granted.

-- ============================================================
-- 7. FINANCE ADJUSTMENT RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS
    finance_adjustments_read_authorized
ON public.finance_adjustments;

CREATE POLICY finance_adjustments_read_authorized
ON public.finance_adjustments
FOR SELECT
TO authenticated
USING (
    private.has_finance_permission('finance.read')
);

DROP POLICY IF EXISTS
    finance_adjustments_create_authorized
ON public.finance_adjustments;

CREATE POLICY finance_adjustments_create_authorized
ON public.finance_adjustments
FOR INSERT
TO authenticated
WITH CHECK (
    private.has_finance_permission('finance.requests')
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
);

DROP POLICY IF EXISTS
    finance_adjustments_update_authorized
ON public.finance_adjustments;

CREATE POLICY finance_adjustments_update_authorized
ON public.finance_adjustments
FOR UPDATE
TO authenticated
USING (
    private.has_finance_permission('finance.requests')
)
WITH CHECK (
    private.has_finance_permission('finance.requests')
    AND updated_by = (SELECT auth.uid())
);

-- ============================================================
-- 8. FINANCE HISTORY RLS POLICY
-- ============================================================

DROP POLICY IF EXISTS
    finance_adjustment_history_read_authorized
ON public.finance_adjustment_history;

CREATE POLICY finance_adjustment_history_read_authorized
ON public.finance_adjustment_history
FOR SELECT
TO authenticated
USING (
    private.has_finance_permission('finance.read')
);

-- History INSERT operations are performed by the
-- security-definer audit trigger below.

-- ============================================================
-- 9. PREPARE FINANCE ADJUSTMENT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION private.prepare_finance_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
AS $function$

BEGIN

    IF TG_OP = 'UPDATE' THEN

        NEW.id := OLD.id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;

        NEW.updated_by := auth.uid();
        NEW.updated_at := now();

        RETURN NEW;

    END IF;

    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();

    RETURN NEW;

END;

$function$;

-- ============================================================
-- 10. AUDIT HISTORY TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION private.record_finance_adjustment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
AS $function$

BEGIN

    IF TG_OP = 'UPDATE' THEN

        INSERT INTO public.finance_adjustment_history (
            adjustment_id,
            action,
            before_record,
            after_record,
            changed_by
        )
        VALUES (
            NEW.id,
            'updated',
            to_jsonb(OLD),
            to_jsonb(NEW),
            auth.uid()
        );

    ELSE

        INSERT INTO public.finance_adjustment_history (
            adjustment_id,
            action,
            after_record,
            changed_by
        )
        VALUES (
            NEW.id,
            'created',
            to_jsonb(NEW),
            auth.uid()
        );

    END IF;

    RETURN NEW;

END;

$function$;

-- Trigger functions cannot be called directly by application users.

REVOKE ALL ON FUNCTION
    private.prepare_finance_adjustment()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
    private.record_finance_adjustment_history()
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 11. INSTALL FINANCE TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS
    finance_adjustments_prepare
ON public.finance_adjustments;

CREATE TRIGGER finance_adjustments_prepare
BEFORE INSERT OR UPDATE
ON public.finance_adjustments
FOR EACH ROW
EXECUTE FUNCTION private.prepare_finance_adjustment();

DROP TRIGGER IF EXISTS
    finance_adjustments_audit
ON public.finance_adjustments;

CREATE TRIGGER finance_adjustments_audit
AFTER INSERT OR UPDATE
ON public.finance_adjustments
FOR EACH ROW
EXECUTE FUNCTION private.record_finance_adjustment_history();

-- ============================================================
-- 12. DELETE RESTRICTION
--
-- No DELETE privilege or DELETE policy is provided.
-- Financial corrections are made through authorised updates.
-- All changes are retained in the audit history.
-- ============================================================

COMMIT;

-- ============================================================
-- END OF FINANCE MANAGEMENT MIGRATION
-- ============================================================
