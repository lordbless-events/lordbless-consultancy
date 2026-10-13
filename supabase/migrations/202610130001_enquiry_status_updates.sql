-- Persist an administrator's manual enquiry status change without granting
-- direct UPDATE access to the enquiries table.

create or replace function public.update_enquiry_status(
    p_enquiry_id uuid,
    p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    updated_status text;
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.' using errcode = '28000';
    end if;

    if p_status not in (
        'new',
        'reviewing',
        'contacted',
        'detailed_form',
        'documents',
        'payment_pending',
        'assessment',
        'processing',
        'completed',
        'closed'
    ) then
        raise exception 'Unsupported enquiry status.' using errcode = '22023';
    end if;

    execute pg_catalog.format(
        'update public.enquiries
            set status = %L
          where id = $1
            and (
                private.is_overall_admin()
                or (
                    private.has_permission(%L)
                    and private.can_access_client(client_id)
                )
            )
          returning status::text',
        p_status,
        'enquiries.write'
    )
    into updated_status
    using p_enquiry_id;

    if updated_status is null then
        raise exception 'Enquiry not found or access denied.' using errcode = '42501';
    end if;

    return updated_status;
end;
$$;

revoke all on function public.update_enquiry_status(uuid, text) from public, anon;
grant execute on function public.update_enquiry_status(uuid, text) to authenticated;
