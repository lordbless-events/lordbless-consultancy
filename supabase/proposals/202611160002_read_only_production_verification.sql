-- READ ONLY. Run with a production database connection after confirming the
-- project reference. This script performs no writes and exposes no secrets.

-- Optional Supabase migration-ledger check (run only if this ledger is present):
-- select version, name from supabase_migrations.schema_migrations
-- where version in ('202611150001','202611150002','202611160001')
-- order by version;

-- 1. RPC signatures, SECURITY DEFINER setting, search_path and execute grants.
select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
    p.prosecdef as security_definer,
    p.proconfig as function_settings,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in (
      'get_company_settings', 'update_company_settings',
      'get_default_appointment_timezone', 'update_my_client_profile',
      'list_admin_client_service_payments', 'list_my_client_service_payments',
      'create_client_service_payment_request', 'submit_client_service_payment',
      'verify_client_service_payment', 'cancel_client_service_payment_request',
      'update_client_journey_progress'
  ))
   or (n.nspname = 'private' and p.proname in (
      'has_permission','can_access_client','current_client_id','has_desk_access',
      'is_current_staff','is_overall_admin','has_finance_permission'
  ))
order by p.proname, arguments;

-- 2. RLS state and table grants for identity, profile and client information.
select
    n.nspname as schema_name,
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced,
    pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_has_any_data_privilege,
    pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated_has_any_data_privilege
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
      'clients','client_accounts','client_documents','client_journeys','enquiries','company_settings',
      'staff_profiles','staff_roles','staff_role_catalog','staff_permissions','role_permissions','permissions',
      'desks','staff_desks','client_desk_assignments'
  )
  and c.relkind in ('r','p')
order by c.relname;

-- 3. Desk inventory and assignment totals, without listing people or clients.
select d.code, d.name, d.active,
       count(distinct sd.user_id) as assigned_staff_count,
       count(distinct cda.client_id) as assigned_client_count
from public.desks d
left join public.staff_desks sd on sd.desk_id = d.id
left join public.client_desk_assignments cda on cda.desk_id = d.id
group by d.id, d.code, d.name, d.active
order by d.name;

-- 4. Effective policy definitions for the same client-data boundaries.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
      'clients','client_accounts','client_documents','client_journeys','enquiries','company_settings',
      'staff_profiles','staff_roles','staff_role_catalog','staff_permissions','role_permissions','permissions',
      'desks','staff_desks','client_desk_assignments'
  )
order by tablename, policyname;

-- 5. Existing permission catalogue entries and role assignments. This is
-- metadata only; it does not alter staff or grant new access.
select permission_code, description
from public.permissions
where permission_code in (
    'finance.read','finance.requests','finance.verify','documents.read',
    'journeys.read','journeys.write','settings.read','settings.manage',
    'applications.read','applications.write','autos.manage'
)
order by permission_code;

select role_code, permission_code
from public.role_permissions
where permission_code in (
    'finance.read','finance.requests','finance.verify','documents.read',
    'journeys.read','journeys.write','settings.read','settings.manage',
    'applications.read','applications.write','autos.manage'
)
order by role_code, permission_code;

select role_code, count(*) as staff_assignment_count
from public.staff_roles
group by role_code
order by role_code;

-- 6. Identity-link quality summary without returning client or staff PII.
select
    count(*) as account_rows,
    count(*) filter (where access_status = 'active') as active_account_rows,
    count(*) filter (where access_status <> 'active') as inactive_account_rows,
    count(*) filter (where auth_user_id is null) as unlinked_account_rows,
    count(*) - count(distinct auth_user_id) filter (where auth_user_id is not null) as duplicate_auth_link_rows
from public.client_accounts;

select
    count(*) as clients_with_multiple_active_accounts
from (
    select client_id
    from public.client_accounts
    where access_status = 'active'
    group by client_id
    having count(*) > 1
) duplicates;

-- 7. Journey completion contradictions; report only. Do not bulk-correct rows.
select
    count(*) filter (where (stage = 'completed') is distinct from (operational_status = 'completed'))
        as non_autos_completion_mismatch_count
from public.client_journeys j
where not private.is_autos_journey(j.id);

-- 8. Document and central service-payment RLS state/policies when the optional
-- central payment proposal has been applied.
select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
      'client_documents','document_requests','document_review_history','enquiry_requirements',
      'client_service_payment_requests','client_service_payment_submissions',
      'client_service_payment_receipts','client_service_payment_history'
  )
  and c.relkind in ('r','p')
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
      'client_documents','document_requests','document_review_history','enquiry_requirements',
      'client_service_payment_requests','client_service_payment_submissions',
      'client_service_payment_receipts','client_service_payment_history'
  )
order by tablename, policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'lordbless-client-documents';

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like '%client_documents%'
order by policyname;
