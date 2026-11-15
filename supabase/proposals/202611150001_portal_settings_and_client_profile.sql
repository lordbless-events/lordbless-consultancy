-- REVIEW ONLY. Adds persisted portal company settings and a narrow client
-- profile update RPC. Apply only after final review and explicit approval.
-- Team & Access: Overall Admin manages settings. Existing consultations.manage
-- permits appointment timezone reads. No new settings permission codes.
-- Confirm production schema/role grants before execution.
begin;

do $$
begin
    if to_regclass('public.clients') is null
       or to_regclass('public.client_accounts') is null
       or to_regprocedure('private.has_permission(text)') is null
       or to_regprocedure('private.current_client_id()') is null
       or to_regprocedure('private.is_overall_admin()') is null then
        raise exception 'Required client identity and permission structures are missing.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name = 'full_name'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name = 'whatsapp'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name = 'nationality'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name = 'current_country'
    ) then
        raise exception 'Required editable client profile fields are missing.';
    end if;

    -- Check account-link columns used by the client profile RPC.
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'client_accounts' and column_name = 'auth_user_id'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'client_accounts' and column_name = 'client_id'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'client_accounts' and column_name = 'access_status'
    ) then
        raise exception 'Required client account identity fields are missing.';
    end if;

    -- Fail safely if an earlier Team & Access migration has not been applied.
    if to_regclass('public.permissions') is null then
        raise exception 'Team & Access permissions catalog is missing.';
    end if;
    if (
        select count(distinct permission_code)
        from public.permissions
        where permission_code in ('consultations.manage', 'settings.read', 'settings.manage')
    ) <> 3 then
        raise exception 'Required existing Team & Access permissions are missing; verify the permission catalogue.';
    end if;

    if to_regclass('public.company_settings') is not null then
        raise exception 'public.company_settings already exists; inspect it before using this proposal.';
    end if;
end;
$$;

create table public.company_settings (
    settings_key text primary key check (settings_key = 'default'),
    consultancy_name text not null default 'LORDBLESS CONSULTANCY',
    company_logo_url text not null default '/images/service-images/lordbless-header-logo.png',
    official_email text not null default '',
    telephone text not null default '',
    whatsapp text not null default '',
    business_address text not null default '',
    official_website text not null default '',
    business_contact_details text not null default '',
    default_appointment_timezone text not null default 'Europe/Berlin',
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default pg_catalog.now(),
    check (pg_catalog.length(pg_catalog.btrim(consultancy_name)) between 1 and 160),
    check (pg_catalog.length(company_logo_url) <= 500),
    check (pg_catalog.length(official_email) <= 254),
    check (pg_catalog.length(telephone) <= 40),
    check (pg_catalog.length(whatsapp) <= 40),
    check (pg_catalog.length(business_address) <= 500),
    check (pg_catalog.length(official_website) <= 255),
    check (pg_catalog.length(business_contact_details) <= 1000)
);

alter table public.company_settings enable row level security;
revoke all on public.company_settings from public, anon, authenticated;

insert into public.company_settings (settings_key)
values ('default');

create or replace function public.get_company_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
    if auth.uid() is null
       or private.current_client_id() is not null
       or not (
           coalesce(private.is_overall_admin(), false)
           or coalesce(private.has_permission('settings.read'), false)
           or coalesce(private.has_permission('settings.manage'), false)
       ) then
        raise exception 'Company settings read permission is required.' using errcode = '42501';
    end if;

    select pg_catalog.jsonb_build_object(
        'consultancy_name', s.consultancy_name,
        'company_logo_url', s.company_logo_url,
        'official_email', s.official_email,
        'telephone', s.telephone,
        'whatsapp', s.whatsapp,
        'business_address', s.business_address,
        'official_website', s.official_website,
        'business_contact_details', s.business_contact_details,
        'default_appointment_timezone', s.default_appointment_timezone,
        'supported_currencies', pg_catalog.jsonb_build_array('EUR', 'USD', 'GHS'),
        'updated_at', s.updated_at
    ) into result
    from public.company_settings s
    where s.settings_key = 'default';

    return result;
end;
$$;

revoke all on function public.get_company_settings() from public, anon, authenticated;
grant execute on function public.get_company_settings() to authenticated;

create or replace function public.update_company_settings(
    p_consultancy_name text,
    p_company_logo_url text,
    p_official_email text,
    p_telephone text,
    p_whatsapp text,
    p_business_address text,
    p_official_website text,
    p_business_contact_details text,
    p_default_appointment_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
    if auth.uid() is null
       or private.current_client_id() is not null
       or not (
           coalesce(private.is_overall_admin(), false)
           or coalesce(private.has_permission('settings.manage'), false)
       ) then
        raise exception 'Company settings management permission is required.' using errcode = '42501';
    end if;

    if nullif(pg_catalog.btrim(p_consultancy_name), '') is null
       or pg_catalog.length(pg_catalog.btrim(p_consultancy_name)) > 160
       or pg_catalog.length(coalesce(p_company_logo_url, '')) > 500
       or (nullif(pg_catalog.btrim(p_company_logo_url), '') is not null
           and p_company_logo_url !~ '^/?images/[A-Za-z0-9._/-]+\.(svg|png|webp|jpe?g)$')
       or (nullif(pg_catalog.btrim(p_official_email), '') is not null
           and p_official_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
       or pg_catalog.length(coalesce(p_telephone, '')) > 40
       or pg_catalog.length(coalesce(p_whatsapp, '')) > 40
       or pg_catalog.length(coalesce(p_business_address, '')) > 500
       or pg_catalog.length(coalesce(p_official_website, '')) > 255
       or (nullif(pg_catalog.btrim(p_official_website), '') is not null
           and p_official_website !~* '^https://[A-Z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$')
       or pg_catalog.length(coalesce(p_business_contact_details, '')) > 1000
       or not exists (
           select 1 from pg_catalog.pg_timezone_names tz
           where tz.name = pg_catalog.btrim(coalesce(p_default_appointment_timezone, ''))
       ) then
        raise exception 'Company settings contain an invalid value.' using errcode = '22023';
    end if;

    update public.company_settings s
    set consultancy_name = pg_catalog.btrim(p_consultancy_name),
        company_logo_url = pg_catalog.btrim(coalesce(p_company_logo_url, '')),
        official_email = pg_catalog.btrim(coalesce(p_official_email, '')),
        telephone = pg_catalog.btrim(coalesce(p_telephone, '')),
        whatsapp = pg_catalog.btrim(coalesce(p_whatsapp, '')),
        business_address = pg_catalog.btrim(coalesce(p_business_address, '')),
        official_website = pg_catalog.btrim(coalesce(p_official_website, '')),
        business_contact_details = pg_catalog.btrim(coalesce(p_business_contact_details, '')),
        default_appointment_timezone = pg_catalog.btrim(p_default_appointment_timezone),
        updated_by = auth.uid(),
        updated_at = pg_catalog.now()
    where s.settings_key = 'default';

    select pg_catalog.jsonb_build_object(
        'consultancy_name', s.consultancy_name,
        'company_logo_url', s.company_logo_url,
        'official_email', s.official_email,
        'telephone', s.telephone,
        'whatsapp', s.whatsapp,
        'business_address', s.business_address,
        'official_website', s.official_website,
        'business_contact_details', s.business_contact_details,
        'default_appointment_timezone', s.default_appointment_timezone,
        'supported_currencies', pg_catalog.jsonb_build_array('EUR', 'USD', 'GHS'),
        'updated_at', s.updated_at
    ) into result
    from public.company_settings s
    where s.settings_key = 'default';

    return result;
end;
$$;

revoke all on function public.update_company_settings(text, text, text, text, text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.update_company_settings(text, text, text, text, text, text, text, text, text)
    to authenticated;

create or replace function public.get_default_appointment_timezone()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result text;
begin
    if auth.uid() is null
       or private.current_client_id() is not null
       or not (
           coalesce(private.is_overall_admin(), false)
           or coalesce(private.has_permission('consultations.manage'), false)
           or coalesce(private.has_permission('settings.read'), false)
           or coalesce(private.has_permission('settings.manage'), false)
       ) then
        raise exception 'Appointment timezone read permission is required.' using errcode = '42501';
    end if;

    select s.default_appointment_timezone into result
    from public.company_settings s
    where s.settings_key = 'default';
    return coalesce(result, 'Europe/Berlin');
end;
$$;

revoke all on function public.get_default_appointment_timezone() from public, anon, authenticated;
grant execute on function public.get_default_appointment_timezone() to authenticated;

create or replace function public.update_my_client_profile(
    p_full_name text,
    p_whatsapp text,
    p_nationality text,
    p_current_country text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    client_record public.clients%rowtype;
    linked_client_id uuid;
    eligible_mapping_count bigint;
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    if nullif(pg_catalog.btrim(p_full_name), '') is null
       or pg_catalog.length(pg_catalog.btrim(p_full_name)) > 160
       or pg_catalog.length(coalesce(p_whatsapp, '')) > 40
       or pg_catalog.length(coalesce(p_nationality, '')) > 100
       or pg_catalog.length(coalesce(p_current_country, '')) > 100 then
        raise exception 'Enter a valid name, phone number, nationality and country.' using errcode = '22023';
    end if;

    -- Require exactly one active mapping. This is a defensive runtime guard;
    -- it does not add or duplicate a schema constraint.
    select count(*)
    into eligible_mapping_count
    from public.client_accounts ca
    join public.clients c on c.id = ca.client_id
    where ca.auth_user_id = auth.uid()
      and ca.access_status = 'active';

    if eligible_mapping_count <> 1 then
        raise exception 'Exactly one active linked client account is required to update profile details.'
            using errcode = '42501';
    end if;

    -- The count is exactly one, so this UUID selection is unambiguous.
    select ca.client_id
    into linked_client_id
    from public.client_accounts ca
    join public.clients c on c.id = ca.client_id
    where ca.auth_user_id = auth.uid()
      and ca.access_status = 'active';

    update public.clients c
    set full_name = pg_catalog.btrim(p_full_name),
        whatsapp = pg_catalog.btrim(coalesce(p_whatsapp, '')),
        nationality = pg_catalog.btrim(coalesce(p_nationality, '')),
        current_country = pg_catalog.btrim(coalesce(p_current_country, ''))
    where c.id = linked_client_id
      and exists (
          select 1 from public.client_accounts ca
          where ca.auth_user_id = auth.uid()
            and ca.client_id = c.id
            and ca.access_status = 'active'
      )
    returning c.* into client_record;

    if not found then
        raise exception 'An active linked client account is required to update profile details.' using errcode = '42501';
    end if;

    return pg_catalog.jsonb_build_object(
        'id', client_record.id,
        'client_code', pg_catalog.to_jsonb(client_record)->>'client_code',
        'full_name', client_record.full_name,
        'whatsapp', client_record.whatsapp,
        'nationality', client_record.nationality,
        'current_country', client_record.current_country
    );
end;
$$;

revoke all on function public.update_my_client_profile(text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_my_client_profile(text, text, text, text) to authenticated;

commit;
