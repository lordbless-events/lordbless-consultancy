-- AUTOS staff access boundary. Additive and data-preserving; prepare for review
-- and a separately authorised production application. Does not grant roles or
-- change existing client assignments.
begin;

do $preflight$
begin
    if to_regclass('public.enquiries') is null
       or to_regclass('public.clients') is null
       or to_regclass('public.client_journeys') is null
       or to_regclass('public.client_journey_stage_history') is null
       or to_regclass('public.client_journey_milestones') is null
       or to_regclass('public.client_journey_requests') is null
       or to_regclass('public.portal_followups') is null
       or to_regclass('public.client_documents') is null
       or to_regclass('public.document_requests') is null
       or to_regclass('public.document_review_history') is null
       or to_regclass('public.enquiry_requirements') is null
       or to_regclass('public.autos_vehicles') is null
       or to_regclass('public.autos_vehicle_photos') is null then
        raise exception 'An expected existing AUTOS, client, journey, follow-up or document table is missing.';
    end if;
    if to_regclass('storage.objects') is null
       or to_regclass('public.desks') is null
       or to_regclass('public.staff_desks') is null then
        raise exception 'Storage or desk authorization tables are missing.';
    end if;
    if not exists (select 1 from public.desks where code = 'china' and active) then
        raise exception 'The active China Desk was not found; no changes have been made.';
    end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='client_documents'
                     and column_name='document_request_id') then
        raise exception 'The production document request linkage is required before applying this migration.';
    end if;
end;
$preflight$;

-- AUTOS classification reads only existing enquiry/journey relationships.
-- These helpers are SECURITY DEFINER so policy checks do not recurse through
-- the same RLS policies they protect.
create or replace function private.can_manage_autos()
returns boolean language sql stable security definer set search_path = '' as $$
    select private.is_overall_admin()
        or (
            private.is_current_staff()
            and private.current_client_id() is null
            and private.has_permission('autos.manage')
            and exists (
                select 1
                from public.staff_desks sd
                join public.desks d on d.id = sd.desk_id
                where sd.user_id = auth.uid()
                  and d.code = 'china'
                  and d.active
            )
        );
$$;

create or replace function private.is_autos_enquiry_data(p_row jsonb)
returns boolean language sql stable set search_path = '' as $$
    select p_row is not null and (
        lower(pg_catalog.concat_ws(' ', p_row->>'service',(p_row->'services')::text,
            (p_row->'business')::text,p_row->>'business_type',p_row->>'product_category',
            p_row->>'journey_type',p_row->>'reference',p_row->>'enquiry_reference')) like '%lordbless autos%'
        or lower(pg_catalog.concat_ws(' ', p_row->>'service',(p_row->'services')::text,
            (p_row->'business')::text,p_row->>'business_type',p_row->>'product_category',
            p_row->>'journey_type')) like '%vehicle sourcing%'
        or lower(coalesce(p_row->>'reference','') || ' ' || coalesce(p_row->>'enquiry_reference','')) like '%lbc-car-%'
    );
$$;

create or replace function private.is_autos_enquiry(p_enquiry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_enquiry_id is not null and exists (
        select 1 from public.enquiries e where e.id=p_enquiry_id
            and private.is_autos_enquiry_data(pg_catalog.to_jsonb(e))
    );
$$;

create or replace function private.is_autos_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_client_id is not null and exists (
        select 1 from public.enquiries e
        where e.client_id = p_client_id and private.is_autos_enquiry(e.id)
    );
$$;

create or replace function private.is_autos_enquiry_for_client(p_enquiry_id uuid,p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_enquiry_id is not null and p_client_id is not null and exists (
        select 1 from public.enquiries e
        where e.id=p_enquiry_id and e.client_id=p_client_id and private.is_autos_enquiry(e.id)
    );
$$;

create or replace function private.is_autos_journey(p_journey_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_journey_id is not null and exists (
        select 1 from public.client_journeys j
        where j.id = p_journey_id and (
            private.is_autos_enquiry(j.enquiry_id)
            or lower(coalesce(j.journey_type,'') || ' ' || coalesce(j.service,'') || ' ' || coalesce(j.title,''))
                like '%autos%'
            or lower(coalesce(j.journey_type,'') || ' ' || coalesce(j.service,'') || ' ' || coalesce(j.title,''))
                like '%vehicle sourcing%'
        )
    );
$$;

create or replace function private.is_autos_document_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_request_id is not null and exists (
        select 1 from public.document_requests r
        where r.id = p_request_id and private.is_autos_enquiry(r.enquiry_id)
    );
$$;

create or replace function private.is_autos_document(p_document_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_document_id is not null and exists (
        select 1 from public.client_documents d
        where d.id = p_document_id and (
            exists (select 1 from public.document_requests r
                where (pg_catalog.to_jsonb(d)->>'document_request_id')=r.id::text
                  and private.is_autos_enquiry(r.enquiry_id))
            or exists (select 1 from public.client_journeys j
                where ((pg_catalog.to_jsonb(d)->>'journey_id')=j.id::text
                    or (pg_catalog.to_jsonb(d)->>'client_journey_id')=j.id::text)
                  and private.is_autos_journey(j.id))
            or exists (select 1 from public.enquiries e
                where (pg_catalog.to_jsonb(d)->>'enquiry_id')=e.id::text
                  and private.is_autos_enquiry(e.id))
        )
    );
$$;

create or replace function private.is_autos_journey_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select p_request_id is not null and exists (
        select 1 from public.client_journey_requests r
        where r.id = p_request_id and (
            lower(coalesce(r.service,'') || ' ' || coalesce(r.details::text,'')) like '%autos%'
            or lower(coalesce(r.service,'') || ' ' || coalesce(r.details::text,'')) like '%vehicle sourcing%'
        )
    );
$$;

revoke all on function private.can_manage_autos() from public, anon;
revoke all on function private.is_autos_enquiry(uuid) from public, anon;
revoke all on function private.is_autos_enquiry_data(jsonb) from public, anon;
revoke all on function private.is_autos_client(uuid) from public, anon;
revoke all on function private.is_autos_enquiry_for_client(uuid,uuid) from public, anon;
revoke all on function private.is_autos_journey(uuid) from public, anon;
revoke all on function private.is_autos_document_request(uuid) from public, anon;
revoke all on function private.is_autos_document(uuid) from public, anon;
revoke all on function private.is_autos_journey_request(uuid) from public, anon;
grant execute on function private.can_manage_autos() to authenticated;
grant execute on function private.is_autos_enquiry(uuid) to authenticated;
grant execute on function private.is_autos_enquiry_data(jsonb) to authenticated;
grant execute on function private.is_autos_client(uuid) to authenticated;
grant execute on function private.is_autos_enquiry_for_client(uuid,uuid) to authenticated;
grant execute on function private.is_autos_journey(uuid) to authenticated;
grant execute on function private.is_autos_document_request(uuid) to authenticated;
grant execute on function private.is_autos_document(uuid) to authenticated;
grant execute on function private.is_autos_journey_request(uuid) to authenticated;

-- Catalogue and supplier data. Public catalogue views remain unchanged.
drop policy if exists autos_vehicles_manage on public.autos_vehicles;
create policy autos_vehicles_manage on public.autos_vehicles for all to authenticated
using (private.can_manage_autos()) with check (private.can_manage_autos());
drop policy if exists autos_vehicle_photos_manage on public.autos_vehicle_photos;
create policy autos_vehicle_photos_manage on public.autos_vehicle_photos for all to authenticated
using (private.can_manage_autos()) with check (private.can_manage_autos());

drop policy if exists autos_staff_photos_read on storage.objects;
create policy autos_staff_photos_read on storage.objects for select to authenticated
using (bucket_id = 'lordbless-autos-catalogue' and (
    private.can_manage_autos()
    or exists (select 1 from public.autos_public_vehicle_photo_paths p where p.storage_path = storage.objects.name)
));
drop policy if exists autos_staff_photos_insert on storage.objects;
create policy autos_staff_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'lordbless-autos-catalogue' and private.can_manage_autos()
    and exists (select 1 from public.autos_vehicles v where v.id::text = split_part(storage.objects.name,'/',1)));
drop policy if exists autos_staff_photos_update on storage.objects;
create policy autos_staff_photos_update on storage.objects for update to authenticated
using (bucket_id = 'lordbless-autos-catalogue' and private.can_manage_autos())
with check (bucket_id = 'lordbless-autos-catalogue' and private.can_manage_autos()
    and exists (select 1 from public.autos_vehicles v where v.id::text = split_part(storage.objects.name,'/',1)));
drop policy if exists autos_staff_photos_delete on storage.objects;
create policy autos_staff_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'lordbless-autos-catalogue' and private.can_manage_autos()
    and exists (select 1 from public.autos_vehicles v where v.id::text = split_part(storage.objects.name,'/',1)));

-- Enquiries and minimal client identity needed for AUTOS operations.
drop policy if exists enquiries_read_authorized on public.enquiries;
create policy enquiries_read_authorized on public.enquiries for select to authenticated using (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.current_limited_client_id() = client_id
    or (private.has_permission('enquiries.read') and private.can_access_client(client_id) and not private.is_autos_enquiry(id))
    or (private.can_manage_autos() and private.is_autos_enquiry(id))
);
drop policy if exists enquiries_client_scope_guard on public.enquiries;
create policy enquiries_client_scope_guard on public.enquiries as restrictive for select to authenticated using (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.current_limited_client_id() = client_id
    or (not private.is_autos_enquiry(id) and private.can_access_client(client_id))
    or (private.is_autos_enquiry(id) and private.can_manage_autos())
);
drop policy if exists enquiries_autos_all_scope_guard on public.enquiries;
create policy enquiries_autos_all_scope_guard on public.enquiries as restrictive for all to authenticated
using (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.current_limited_client_id() = client_id
    or (not private.is_autos_enquiry(id) and private.can_access_client(client_id))
    or (private.is_autos_enquiry(id) and private.can_manage_autos())
)
with check (
    private.is_overall_admin()
    or private.current_client_id() = client_id
    or private.current_limited_client_id() = client_id
    or (not private.is_autos_enquiry_data(pg_catalog.to_jsonb(enquiries)) and private.can_access_client(client_id))
    or (private.is_autos_enquiry_data(pg_catalog.to_jsonb(enquiries)) and private.can_manage_autos())
);

drop policy if exists clients_read_autos_scope on public.clients;
create policy clients_read_autos_scope on public.clients for select to authenticated
using (private.can_manage_autos() and private.is_autos_client(id));
drop policy if exists clients_client_scope_guard on public.clients;
create policy clients_client_scope_select_guard on public.clients as restrictive for select to authenticated
using (private.is_overall_admin() or private.current_client_id() = id or private.current_limited_client_id() = id
    or private.can_access_client(id) or (private.can_manage_autos() and private.is_autos_client(id)));
create policy clients_client_scope_write_guard on public.clients as restrictive for update to authenticated
using (private.is_overall_admin() or private.current_client_id() = id or private.current_limited_client_id() = id or private.can_access_client(id))
with check (private.is_overall_admin() or private.current_client_id() = id or private.current_limited_client_id() = id or private.can_access_client(id));

-- Journey records and history: AUTOS-specific staff access is independent of
-- the client's general desk assignment. Client hiding policy remains intact.
drop policy if exists client_journeys_read_authorized on public.client_journeys;
create policy client_journeys_read_authorized on public.client_journeys for select to authenticated using (
    private.current_client_id() = client_id or private.is_overall_admin()
    or (private.has_permission('journeys.read') and private.can_access_client(client_id) and not private.is_autos_journey(id))
    or (private.can_manage_autos() and private.is_autos_journey(id))
);
drop policy if exists client_journeys_create_authorized on public.client_journeys;
create policy client_journeys_create_authorized on public.client_journeys for insert to authenticated with check (
    (private.is_overall_admin() and not (private.is_autos_enquiry(enquiry_id)
        or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%autos%'
        or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%vehicle sourcing%'))
    or ((private.is_overall_admin() or private.has_permission('journeys.write')) and private.can_access_client(client_id)
        and not (private.is_autos_enquiry(enquiry_id)
            or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%autos%'
            or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%vehicle sourcing%'))
    or (private.can_manage_autos() and private.is_autos_enquiry_for_client(enquiry_id,client_id)
        and exists (select 1 from public.desks d where d.id=desk_id and d.code='china' and d.active)
        and (internal_assignee_id is null or exists (
            select 1 from public.staff_desks sd join public.desks d on d.id=sd.desk_id
            join public.staff_profiles sp on sp.user_id=sd.user_id
            where sd.user_id=internal_assignee_id and d.code='china' and d.active and sp.active
        )))
);
drop policy if exists client_journeys_update_authorized on public.client_journeys;
create policy client_journeys_update_authorized on public.client_journeys for update to authenticated
using (private.is_overall_admin()
    or (private.has_permission('journeys.write') and private.can_access_client(client_id)
        and not (private.is_autos_enquiry(enquiry_id)
            or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%autos%'
            or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%vehicle sourcing%'))
    or (private.can_manage_autos() and private.is_autos_journey(id)))
with check ((private.is_overall_admin() and not (private.is_autos_enquiry(enquiry_id)
        or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%autos%'
        or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%vehicle sourcing%'))
    or ((private.is_overall_admin() or private.has_permission('journeys.write')) and private.can_access_client(client_id)
        and not (private.is_autos_enquiry(enquiry_id)
            or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%autos%'
            or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%vehicle sourcing%'))
    or (private.can_manage_autos() and private.is_autos_enquiry_for_client(enquiry_id,client_id)
        and exists (select 1 from public.desks d where d.id=desk_id and d.code='china' and d.active)
        and (internal_assignee_id is null or exists (
            select 1 from public.staff_desks sd join public.desks d on d.id=sd.desk_id
            join public.staff_profiles sp on sp.user_id=sd.user_id
            where sd.user_id=internal_assignee_id and d.code='china' and d.active and sp.active
        )));
drop policy if exists client_journeys_client_scope_guard on public.client_journeys;
create policy client_journeys_client_scope_guard on public.client_journeys as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = client_id
    or (not private.is_autos_journey(id) and private.can_access_client(client_id))
    or (private.can_manage_autos() and private.is_autos_journey(id)))
with check (private.is_overall_admin() or private.current_client_id() = client_id
    or (not (private.is_autos_enquiry(enquiry_id)
        or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%autos%'
        or lower(coalesce(journey_type,'') || ' ' || coalesce(service,'') || ' ' || coalesce(title,'')) like '%vehicle sourcing%')
        and private.can_access_client(client_id))
    or (private.can_manage_autos() and private.is_autos_enquiry_for_client(enquiry_id,client_id)));

create or replace view public.client_journeys_internal_access with (security_barrier = true) as
select j.id,j.client_id,j.enquiry_id,j.journey_type,j.title,j.destination,j.service,j.operational_status,
       j.created_at,j.updated_at,j.internal_assignee_id,j.desk_id,j.stage
from public.client_journeys j
where private.is_overall_admin()
   or (private.has_permission('journeys.read') and private.can_access_client(j.client_id) and not private.is_autos_journey(j.id))
   or (private.can_manage_autos() and private.is_autos_journey(j.id));
revoke all on public.client_journeys_internal_access from public, anon;
grant select on public.client_journeys_internal_access to authenticated;

drop policy if exists client_journey_stage_history_read_staff on public.client_journey_stage_history;
create policy client_journey_stage_history_read_staff on public.client_journey_stage_history for select to authenticated using (
    private.is_overall_admin()
    or exists (select 1 from public.client_journeys j where j.id = journey_id and (
        (private.can_manage_autos() and private.is_autos_journey(j.id))
        or (private.has_permission('journeys.read') and private.can_access_client(j.client_id) and not private.is_autos_journey(j.id))
    ))
);

-- Restrict stage/status updates through the existing checked RPC.
create or replace function public.update_client_journey_progress(p_journey_id uuid,p_stage text,p_operational_status text,p_internal_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
    journey_record public.client_journeys%rowtype;
    autos_record boolean;
begin
    if auth.uid() is null or private.current_client_id() is not null then
        raise exception 'Active staff journey write permission is required.' using errcode = '42501';
    end if;
    if p_journey_id is null or p_stage is null or p_operational_status is null
       or p_stage not in ('enquiry','assessment','planning','preparation','applications_approvals','visa_processing','travel','arrival','completed',
            'enquiry_received','enquiry_reviewed','availability_confirmation','quotation_preparation','quotation_sent','awaiting_customer_decision',
            'order_confirmed','payment_processing','vehicle_sourcing','inspection_documentation','shipping_preparation','in_transit',
            'arrived_in_ghana','customs_clearing','delivery_arrangements','delivered','autos_completed')
       or p_operational_status not in ('active','on_hold','completed','cancelled','unsuccessful')
       or length(coalesce(p_internal_note,'')) > 3000 then
        raise exception 'Journey ID, stage, operational status or internal note is invalid.' using errcode = '22023';
    end if;
    select * into journey_record from public.client_journeys where id = p_journey_id for update;
    if not found then raise exception 'Journey was not found.' using errcode = '42501'; end if;
    autos_record := private.is_autos_journey(journey_record.id);
    if (autos_record and not private.can_manage_autos())
       or (not autos_record and (not private.has_permission('journeys.write') or not private.can_access_client(journey_record.client_id))) then
        raise exception 'Journey is outside your authorised scope.' using errcode = '42501';
    end if;
    if autos_record and journey_record.enquiry_id is not null
       and not private.is_autos_enquiry_for_client(journey_record.enquiry_id,journey_record.client_id) then
        raise exception 'The AUTOS journey and enquiry client relationship is invalid.' using errcode = '23514';
    end if;
    perform pg_catalog.set_config('app.journey_change_note',coalesce(p_internal_note,''),true);
    update public.client_journeys set stage=p_stage,operational_status=p_operational_status,updated_at=now() where id=p_journey_id;
    perform pg_catalog.set_config('app.journey_change_note','',true);
    return p_journey_id;
end;
$function$;
revoke all on function public.update_client_journey_progress(uuid,text,text,text) from public, anon;
grant execute on function public.update_client_journey_progress(uuid,text,text,text) to authenticated;

-- Follow-ups remain in the existing table and are scoped through their exact
-- enquiry_id. AUTOS activities must not drift onto another enquiry for client.
drop policy if exists portal_followups_client_scope_guard on public.portal_followups;
create policy portal_followups_client_scope_guard on public.portal_followups as restrictive for all to authenticated
using (private.is_overall_admin() or (private.is_autos_enquiry(enquiry_id) and private.can_manage_autos())
    or (not private.is_autos_enquiry(enquiry_id) and private.can_access_client(client_id)))
with check (private.is_overall_admin() or (private.is_autos_enquiry(enquiry_id) and private.can_manage_autos())
    or (not private.is_autos_enquiry(enquiry_id) and private.can_access_client(client_id)));
drop policy if exists portal_followups_autos_read on public.portal_followups;
create policy portal_followups_autos_read on public.portal_followups for select to authenticated
using (private.can_manage_autos() and private.is_autos_enquiry(enquiry_id));
drop policy if exists portal_followups_autos_create on public.portal_followups;
create policy portal_followups_autos_create on public.portal_followups for insert to authenticated
with check (private.can_manage_autos() and private.is_autos_enquiry(enquiry_id)
    and exists (select 1 from public.enquiries e where e.id=portal_followups.enquiry_id and e.client_id=portal_followups.client_id)
    and created_by=auth.uid()
    and (assigned_to is null or assigned_to=auth.uid() or private.is_overall_admin()
        or exists (select 1 from public.staff_desks sd join public.desks d on d.id=sd.desk_id
            join public.staff_profiles sp on sp.user_id=sd.user_id
            where sd.user_id=assigned_to and d.code='china' and d.active and sp.active)));
drop policy if exists portal_followups_autos_update on public.portal_followups;
create policy portal_followups_autos_update on public.portal_followups for update to authenticated
using (private.can_manage_autos() and private.is_autos_enquiry(enquiry_id))
with check (private.can_manage_autos() and private.is_autos_enquiry(enquiry_id)
    and exists (select 1 from public.enquiries e where e.id=portal_followups.enquiry_id and e.client_id=portal_followups.client_id)
    and (assigned_to is null or assigned_to=auth.uid() or private.is_overall_admin()
        or exists (select 1 from public.staff_desks sd join public.desks d on d.id=sd.desk_id
            join public.staff_profiles sp on sp.user_id=sd.user_id
            where sd.user_id=assigned_to and d.code='china' and d.active and sp.active)));

-- Documents retain their existing client upload and request lifecycle. Staff
-- access follows the document's request -> exact AUTOS enquiry relationship.
drop policy if exists client_documents_client_scope_guard on public.client_documents;
create policy client_documents_client_scope_guard on public.client_documents as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id()=client_id
    or (private.is_autos_document(id) and private.can_manage_autos())
    or (not private.is_autos_document(id) and private.can_access_client(client_id)))
with check (private.is_overall_admin() or private.current_client_id()=client_id
    or (private.is_autos_document(id) and private.can_manage_autos())
    or (not private.is_autos_document(id) and private.can_access_client(client_id)));
drop policy if exists client_documents_autos_read on public.client_documents;
create policy client_documents_autos_read on public.client_documents for select to authenticated
using (private.can_manage_autos() and private.is_autos_document(id));
drop policy if exists client_documents_autos_review on public.client_documents;
create policy client_documents_autos_review on public.client_documents for update to authenticated
using (private.can_manage_autos() and private.is_autos_document(id))
with check (private.can_manage_autos() and private.is_autos_document(id));

drop policy if exists document_requests_client_scope_guard on public.document_requests;
create policy document_requests_client_scope_guard on public.document_requests as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id()=client_id
    or (private.is_autos_enquiry(enquiry_id) and private.can_manage_autos())
    or (not private.is_autos_enquiry(enquiry_id) and private.can_access_client(client_id)))
with check (private.is_overall_admin() or private.current_client_id()=client_id
    or (private.is_autos_enquiry(enquiry_id) and private.can_manage_autos())
    or (not private.is_autos_enquiry(enquiry_id) and private.can_access_client(client_id)));
drop policy if exists document_requests_autos_read on public.document_requests;
create policy document_requests_autos_read on public.document_requests for select to authenticated
using (private.can_manage_autos() and private.is_autos_enquiry(enquiry_id));

drop policy if exists document_review_history_client_scope_guard on public.document_review_history;
create policy document_review_history_client_scope_guard on public.document_review_history as restrictive for all to authenticated
using (private.is_overall_admin() or private.current_client_id() = (select d.client_id from public.client_documents d where d.id=document_id)
    or (private.is_autos_document(document_id) and private.can_manage_autos())
    or exists (select 1 from public.client_documents d where d.id=document_id and not private.is_autos_document(d.id) and private.can_access_client(d.client_id)))
with check (private.is_overall_admin() or private.current_client_id() = (select d.client_id from public.client_documents d where d.id=document_id)
    or (private.is_autos_document(document_id) and private.can_manage_autos())
    or exists (select 1 from public.client_documents d where d.id=document_id and not private.is_autos_document(d.id) and private.can_access_client(d.client_id)));
drop policy if exists document_review_history_autos_read on public.document_review_history;
create policy document_review_history_autos_read on public.document_review_history for select to authenticated
using (private.can_manage_autos() and private.is_autos_document(document_id));

drop policy if exists enquiry_requirements_client_scope_guard on public.enquiry_requirements;
create policy enquiry_requirements_client_scope_guard on public.enquiry_requirements as restrictive for all to authenticated
using (private.is_overall_admin() or exists (select 1 from public.enquiries e where e.id=enquiry_id and (
    private.current_client_id()=e.client_id
    or (private.is_autos_enquiry(e.id) and private.can_manage_autos())
    or (not private.is_autos_enquiry(e.id) and (private.current_limited_client_id()=e.client_id or private.can_access_client(e.client_id)))
)))
with check (private.is_overall_admin() or exists (select 1 from public.enquiries e where e.id=enquiry_id and (
    private.current_client_id()=e.client_id
    or (private.is_autos_enquiry(e.id) and private.can_manage_autos())
    or (not private.is_autos_enquiry(e.id) and (private.current_limited_client_id()=e.client_id or private.can_access_client(e.client_id)))
)));
drop policy if exists enquiry_requirements_autos_read on public.enquiry_requirements;
create policy enquiry_requirements_autos_read on public.enquiry_requirements for select to authenticated
using (private.can_manage_autos() and private.is_autos_enquiry(enquiry_id));

drop policy if exists lordbless_client_documents_read on storage.objects;
create policy lordbless_client_documents_read on storage.objects for select to authenticated using (
    bucket_id='lordbless-client-documents' and exists (
        select 1 from public.client_documents d
        where d.storage_path=storage.objects.name and (
            d.client_id=private.current_client_id()
            or (private.can_manage_autos() and private.is_autos_document(d.id))
            or ((private.has_permission('documents.read') or private.has_permission('documents.review'))
                and not private.is_autos_document(d.id) and private.can_access_client(d.client_id))
        )
    )
);

-- Historical milestone/request records are preserved. They remain invisible
-- to other desks when attached to an AUTOS journey.
drop policy if exists client_journey_milestones_client_scope_guard on public.client_journey_milestones;
create policy client_journey_milestones_client_scope_guard on public.client_journey_milestones as restrictive for all to authenticated
using (exists (select 1 from public.client_journeys j where j.id=journey_id and (
    private.is_overall_admin() or (private.is_autos_journey(j.id) and private.can_manage_autos())
    or (not private.is_autos_journey(j.id) and (private.current_client_id()=j.client_id or private.can_access_client(j.client_id)))
)))
with check (exists (select 1 from public.client_journeys j where j.id=journey_id and (
    private.is_overall_admin() or (private.is_autos_journey(j.id) and private.can_manage_autos())
    or (not private.is_autos_journey(j.id) and (private.current_client_id()=j.client_id or private.can_access_client(j.client_id)))
)));
drop policy if exists client_journey_milestones_autos_read on public.client_journey_milestones;
create policy client_journey_milestones_autos_read on public.client_journey_milestones for select to authenticated
using (private.can_manage_autos() and private.is_autos_journey(journey_id));
drop policy if exists client_journey_requests_client_scope_guard on public.client_journey_requests;
create policy client_journey_requests_client_scope_guard on public.client_journey_requests as restrictive for all to authenticated
using (private.is_overall_admin() or (private.is_autos_journey_request(id) and private.can_manage_autos())
    or (not private.is_autos_journey_request(id) and (private.current_client_id()=client_id or private.can_access_client(client_id))))
with check (private.is_overall_admin()
    or (private.can_manage_autos() and (lower(coalesce(service,'') || ' ' || coalesce(details::text,'')) like '%autos%'
        or lower(coalesce(service,'') || ' ' || coalesce(details::text,'')) like '%vehicle sourcing%'))
    or (private.current_client_id()=client_id and not (lower(coalesce(service,'') || ' ' || coalesce(details::text,'')) like '%autos%'
        or lower(coalesce(service,'') || ' ' || coalesce(details::text,'')) like '%vehicle sourcing%'))
    or (private.can_access_client(client_id) and not (lower(coalesce(service,'') || ' ' || coalesce(details::text,'')) like '%autos%'
        or lower(coalesce(service,'') || ' ' || coalesce(details::text,'')) like '%vehicle sourcing%')));
drop policy if exists client_journey_requests_autos_read on public.client_journey_requests;
create policy client_journey_requests_autos_read on public.client_journey_requests for select to authenticated
using (private.can_manage_autos() and private.is_autos_journey_request(id));

-- Reuse the current document request and review RPCs, adding only the
-- AUTOS-specific authorisation branch. Client upload finalization is unchanged.
create or replace function public.list_client_document_enquiries(p_client_id uuid)
returns table (enquiry_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or not (
        (private.has_permission('documents.review') and private.can_access_client(p_client_id))
        or (private.can_manage_autos() and private.is_autos_client(p_client_id))
    ) then
        raise exception 'Document request permission is required for this client.' using errcode='42501';
    end if;
    return query
    select e.id,e.created_at from public.enquiries e
    where e.client_id=p_client_id
      and ((private.is_autos_enquiry(e.id) and private.can_manage_autos())
        or (not private.is_autos_enquiry(e.id) and private.can_access_client(p_client_id)))
    order by e.created_at desc,e.id;
end;
$$;
revoke all on function public.list_client_document_enquiries(uuid) from public, anon;
grant execute on function public.list_client_document_enquiries(uuid) to authenticated;

create or replace function public.create_document_request(
    p_client_id uuid,p_enquiry_id uuid,p_requirement_id uuid,p_document_type text,
    p_document_name text,p_request_type text,p_message text,p_email boolean,p_portal boolean,p_whatsapp boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    enquiry_client_id uuid;
    saved_request_id uuid;
    autos_request boolean;
begin
    if auth.uid() is null then raise exception 'Authentication is required.' using errcode='42501'; end if;
    select e.client_id,private.is_autos_enquiry(e.id) into enquiry_client_id,autos_request
    from public.enquiries e where e.id=p_enquiry_id;
    if not found or enquiry_client_id is distinct from p_client_id then
        raise exception 'The selected enquiry does not belong to this client.' using errcode='23514';
    end if;
    if (autos_request and not private.can_manage_autos())
       or (not autos_request and (not private.has_permission('documents.review') or not private.can_access_client(p_client_id))) then
        raise exception 'Document request permission is required for this enquiry.' using errcode='42501';
    end if;
    if p_client_id is null or p_enquiry_id is null
       or nullif(btrim(p_document_type),'') is null or nullif(btrim(p_document_name),'') is null
       or nullif(btrim(p_message),'') is null
       or p_request_type not in ('missing','replacement','expired','additional') then
        raise exception 'Client, enquiry, document and instructions are required.' using errcode='22023';
    end if;
    if p_requirement_id is not null and not exists (
        select 1 from public.enquiry_requirements r
        where r.id=p_requirement_id and r.enquiry_id=p_enquiry_id and r.document_type=p_document_type
    ) then
        raise exception 'The selected requirement does not match this enquiry and document type.' using errcode='23514';
    end if;
    insert into public.document_requests(client_id,enquiry_id,requirement_id,document_type,document_name,request_type,message,status,email,portal,whatsapp,sent_at)
    values(p_client_id,p_enquiry_id,p_requirement_id,btrim(p_document_type),btrim(p_document_name),p_request_type,
        btrim(p_message),'requested',coalesce(p_email,false),coalesce(p_portal,true),coalesce(p_whatsapp,false),now())
    returning id into saved_request_id;
    if p_requirement_id is not null then
        update public.enquiry_requirements set status='required',requested_at=coalesce(requested_at,now()),satisfied_at=null,updated_at=now()
        where id=p_requirement_id and enquiry_id=p_enquiry_id;
    end if;
    return saved_request_id;
end;
$$;
revoke all on function public.create_document_request(uuid,uuid,uuid,text,text,text,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.create_document_request(uuid,uuid,uuid,text,text,text,text,boolean,boolean,boolean) to authenticated;

create or replace function public.review_client_document(
    p_document_id uuid,p_action text,p_note text,p_expected_updated_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    document_record public.client_documents%rowtype;
    request_record public.document_requests%rowtype;
    action_enquiry_id uuid;
    autos_document boolean;
begin
    if auth.uid() is null then raise exception 'Authentication is required.' using errcode='42501'; end if;
    select * into document_record from public.client_documents d where d.id=p_document_id for update;
    if not found then raise exception 'Document not found or access denied.' using errcode='42501'; end if;
    autos_document := private.is_autos_document(document_record.id);
    if (autos_document and not private.can_manage_autos())
       or (not autos_document and (not private.has_permission('documents.review') or not private.can_access_client(document_record.client_id))) then
        raise exception 'Document review permission is required.' using errcode='42501';
    end if;
    if p_action not in ('approved','rejected') or (p_action='rejected' and nullif(btrim(p_note),'') is null) then
        raise exception 'Choose approval or provide a rejection reason.' using errcode='22023';
    end if;
    if document_record.updated_at is distinct from p_expected_updated_at then
        raise exception 'This document changed while you were reviewing it. Reload and review the latest version.' using errcode='40001';
    end if;
    if document_record.status=p_action then return document_record.id; end if;
    if document_record.status not in ('uploaded','reviewing') then
        raise exception 'Only a newly uploaded document can be reviewed.' using errcode='22023';
    end if;
    if document_record.document_request_id is not null then
        select * into request_record from public.document_requests r where r.id=document_record.document_request_id for update;
        action_enquiry_id := request_record.enquiry_id;
    end if;
    update public.client_documents set status=p_action,
        approved_at=case when p_action='approved' then now() else null end,
        rejected_at=case when p_action='rejected' then now() else null end,
        rejection_reason=case when p_action='rejected' then btrim(p_note) else null end,
        is_reusable=p_action='approved' and is_current
            and (valid_from is null or valid_from<=current_date)
            and (valid_until is null or valid_until>=current_date), updated_at=now()
    where id=p_document_id;
    insert into public.document_review_history(document_id,enquiry_id,action,note,reviewed_by,created_at)
    values(p_document_id,action_enquiry_id,p_action,nullif(btrim(p_note),''),auth.uid(),now());
    if document_record.document_request_id is not null then
        update public.document_requests set status=case when p_action='approved' then 'completed' else 'requested' end,
            completed_at=case when p_action='approved' then now() else null end where id=document_record.document_request_id;
    end if;
    if request_record.requirement_id is not null then
        update public.enquiry_requirements set client_document_id=p_document_id,
            status=case when p_action='approved' then 'satisfied' else 'required' end,
            satisfied_at=case when p_action='approved' then now() else null end,
            admin_note=case when p_action='rejected' then btrim(p_note) else admin_note end,updated_at=now()
        where id=request_record.requirement_id and enquiry_id=request_record.enquiry_id;
    end if;
    return p_document_id;
end;
$$;
revoke all on function public.review_client_document(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.review_client_document(uuid,text,text,timestamptz) to authenticated;

-- Historical legacy stage values remain untouched; the UI maps `enquiry`
-- to the AUTOS label without rewriting history.

commit;
