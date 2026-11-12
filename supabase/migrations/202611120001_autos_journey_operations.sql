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