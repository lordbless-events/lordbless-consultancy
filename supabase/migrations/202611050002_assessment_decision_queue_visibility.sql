-- Keep a saved assessment decision visible even if its enquiry relationship
-- is absent or later unavailable. Enquiry data remains optional context.

create or replace function public.list_client_assessment_queue()
returns table (
    client_id uuid,
    client_name text,
    client_code text,
    enquiries jsonb,
    decision_id uuid,
    decision text,
    assessment_reason text,
    admin_comments text,
    reviewer_id uuid,
    reviewer_name text,
    reviewed_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not private.has_permission('applications.read') then
        raise exception 'Assessment read permission is required.' using errcode = '42501';
    end if;

    return query
    select
        c.id,
        coalesce(nullif(c.full_name, ''), 'Client'),
        to_jsonb(c)->>'client_code',
        enquiry_data.items,
        d.id,
        d.decision,
        d.assessment_reason,
        d.admin_comments,
        d.reviewer_id,
        d.reviewer_name,
        d.reviewed_at,
        d.created_at,
        d.updated_at
    from public.clients c
    left join lateral (
        select jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
                'id', e.id,
                'reference', coalesce(source_row.row_data->>'reference', source_row.row_data->>'enquiry_reference'),
                'created_at', coalesce(source_row.row_data->>'created_at', source_row.row_data->>'submitted_at'),
                'services', source_row.row_data->'services',
                'details', source_row.row_data->'details',
                'education', source_row.row_data->'education',
                'careers', source_row.row_data->'careers',
                'travel', source_row.row_data->'travel',
                'business', source_row.row_data->'business',
                'mobility', source_row.row_data->'mobility',
                'general', source_row.row_data->'general'
            ))
            order by coalesce(source_row.row_data->>'created_at', source_row.row_data->>'submitted_at') desc nulls last
        ) as items
        from public.enquiries e
        cross join lateral (select to_jsonb(e) as row_data) source_row
        where e.client_id = c.id
          and private.can_access_client(c.id)
    ) enquiry_data on true
    left join public.client_assessment_decisions d on d.client_id = c.id
    where private.can_access_client(c.id)
      and (enquiry_data.items is not null or d.id is not null)
    order by (d.id is null) desc, d.updated_at desc nulls last, c.full_name;
end;
$$;

revoke all on function public.list_client_assessment_queue() from public, anon;
grant execute on function public.list_client_assessment_queue() to authenticated;
