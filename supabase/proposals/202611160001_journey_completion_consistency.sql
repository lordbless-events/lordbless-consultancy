-- REVIEW ONLY. Prevents future non-AUTOS journey writes from recording a
-- completed stage with a non-completed operational status, or the reverse.
-- Existing rows are intentionally not changed. AUTOS stages/statuses remain
-- governed by their separate operational rules. Do not apply without review.
begin;

create or replace function public.update_client_journey_progress(
    p_journey_id uuid,
    p_stage text,
    p_operational_status text,
    p_internal_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
    journey_record public.client_journeys%rowtype;
    autos_record boolean;
begin
    if auth.uid() is null or private.current_client_id() is not null then
        raise exception 'Active staff journey write permission is required.' using errcode = '42501';
    end if;
    if p_journey_id is null or p_stage is null or p_operational_status is null
       or p_stage not in (
            'enquiry','assessment','planning','preparation','applications_approvals',
            'visa_processing','travel','arrival','completed','enquiry_received',
            'enquiry_reviewed','availability_confirmation','quotation_preparation',
            'quotation_sent','awaiting_customer_decision','order_confirmed',
            'payment_processing','vehicle_sourcing','inspection_documentation',
            'shipping_preparation','in_transit','arrived_in_ghana','customs_clearing',
            'delivery_arrangements','delivered','autos_completed'
       )
       or p_operational_status not in ('active','on_hold','completed','cancelled','unsuccessful')
       or length(coalesce(p_internal_note,'')) > 3000 then
        raise exception 'Journey ID, stage, operational status or internal note is invalid.' using errcode = '22023';
    end if;

    select * into journey_record
    from public.client_journeys
    where id = p_journey_id
    for update;
    if not found then
        raise exception 'Journey was not found.' using errcode = '42501';
    end if;

    autos_record := private.is_autos_journey(journey_record.id);
    if not autos_record and ((p_stage = 'completed') is distinct from (p_operational_status = 'completed')) then
        raise exception 'For consultancy journeys, the Completed stage and completed operational status must be updated together.'
            using errcode = '22023';
    end if;

    if (autos_record and not private.can_manage_autos())
       or (not autos_record and (
            not private.has_permission('journeys.write')
            or not private.can_access_client(journey_record.client_id)
       )) then
        raise exception 'Journey is outside your authorised scope.' using errcode = '42501';
    end if;
    if autos_record and journey_record.enquiry_id is not null
       and not private.is_autos_enquiry_for_client(journey_record.enquiry_id,journey_record.client_id) then
        raise exception 'The AUTOS journey and enquiry client relationship is invalid.' using errcode = '23514';
    end if;

    perform pg_catalog.set_config('app.journey_change_note',coalesce(p_internal_note,''),true);
    update public.client_journeys
    set stage=p_stage, operational_status=p_operational_status, updated_at=pg_catalog.now()
    where id=p_journey_id;
    perform pg_catalog.set_config('app.journey_change_note','',true);
    return p_journey_id;
end;
$function$;

revoke all on function public.update_client_journey_progress(uuid,text,text,text) from public,anon;
grant execute on function public.update_client_journey_progress(uuid,text,text,text) to authenticated;

commit;
