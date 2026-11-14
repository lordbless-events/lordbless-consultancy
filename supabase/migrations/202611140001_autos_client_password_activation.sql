-- Activate only password-configured, confirmed, AUTOS-only client accounts.
-- Other divisions retain the existing verified-assessment activation gate.
begin;

do $$
begin
    if to_regclass('public.client_accounts') is null
       or to_regclass('public.enquiries') is null
       or to_regclass('auth.users') is null
       or to_regprocedure('private.is_autos_client(uuid)') is null
       or to_regprocedure('private.is_autos_enquiry(uuid)') is null then
        raise exception 'Required client identity or AUTOS classification structures are missing.';
    end if;
end;
$$;

create or replace function public.activate_eligible_autos_client_account()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_record public.client_accounts%rowtype;
    email_confirmed boolean;
    password_configured boolean;
    updated_status text;
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    select * into account_record
    from public.client_accounts ca
    where ca.auth_user_id = auth.uid()
    for update;

    if not found then
        raise exception 'No client portal account is linked to this user.' using errcode = '42501';
    end if;

    if account_record.access_status <> 'activation_required' then
        return account_record.access_status;
    end if;

    select au.email_confirmed_at is not null,
           nullif(au.encrypted_password, '') is not null
    into email_confirmed, password_configured
    from auth.users au
    where au.id = auth.uid();

    if not coalesce(email_confirmed, false) or not coalesce(password_configured, false) then
        return account_record.access_status;
    end if;

    -- A payment assessment for another division remains mandatory. Unknown
    -- or mixed-service enquiries fail closed and keep limited access.
    if private.is_autos_client(account_record.client_id)
       and not exists (
            select 1
            from public.enquiries e
            where e.client_id = account_record.client_id
              and not private.is_autos_enquiry(e.id)
       ) then
        update public.client_accounts ca
        set access_status = 'active',
            activated_at = coalesce(ca.activated_at, now()),
            updated_at = now()
        where ca.auth_user_id = auth.uid()
          and ca.access_status = 'activation_required'
        returning ca.access_status into updated_status;
        account_record.access_status := coalesce(updated_status, account_record.access_status);
    end if;

    return account_record.access_status;
end;
$$;

revoke all on function public.activate_eligible_autos_client_account() from public, anon;
grant execute on function public.activate_eligible_autos_client_account() to authenticated;

commit;
