-- REVIEW ONLY. Apply only after checking the current production schema and
-- bucket state. This extends existing document tables; it creates no document
-- table and does not alter the Autos bucket or its policies.

begin;

do $$
declare
    status_constraint record;
    status_value text;
    constraint_table text;
    constraint_column text;
    allowed_values text[];
    constraint_definition text;
begin
    if to_regclass('public.client_documents') is null
       or to_regclass('public.document_requests') is null
       or to_regclass('public.document_review_history') is null
       or to_regclass('public.enquiry_requirements') is null
       or to_regclass('public.enquiries') is null then
        raise exception 'A required existing document or enquiry table is missing.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'enquiries' and column_name = 'client_id'
    ) then
        raise exception 'Cannot validate enquiry ownership: public.enquiries.client_id was not found.';
    end if;

    if (select relrowsecurity from pg_class where oid = 'public.client_documents'::regclass) is not true
       or (select relrowsecurity from pg_class where oid = 'public.document_requests'::regclass) is not true
       or (select relrowsecurity from pg_class where oid = 'public.document_review_history'::regclass) is not true
       or (select relrowsecurity from pg_class where oid = 'public.enquiry_requirements'::regclass) is not true then
        raise exception 'RLS must remain enabled on all four document tables.';
    end if;

    for status_constraint in
        select * from (values
            ('client_documents', 'status', array['reviewing','approved','rejected']::text[]),
            ('document_requests', 'status', array['requested','viewed','uploaded','approved','rejected']::text[]),
            ('enquiry_requirements', 'status', array['required','satisfied']::text[]),
            ('document_review_history', 'action', array['approved','rejected']::text[])
        ) as required_status(table_name, column_name, values_required)
    loop
        constraint_table := status_constraint.table_name;
        constraint_column := status_constraint.column_name;
        allowed_values := status_constraint.values_required;
        for constraint_definition in
            select pg_get_constraintdef(c.oid)
            from pg_constraint c
            where c.conrelid = format('public.%I', constraint_table)::regclass
              and c.contype = 'c'
              and pg_get_constraintdef(c.oid) ilike '%' || constraint_column || '%'
              and (
                  pg_get_constraintdef(c.oid) ilike '% in (%'
                  or pg_get_constraintdef(c.oid) ilike '%= any (%'
              )
        loop
            foreach status_value in array allowed_values loop
                if position(quote_literal(status_value) in constraint_definition) = 0 then
                    raise exception 'Constraint on public.%.% does not permit required value "%": %',
                        constraint_table, constraint_column, status_value, constraint_definition;
                end if;
            end loop;
        end loop;
        foreach status_value in array allowed_values loop
            if exists (
                select 1
                from pg_attribute a
                join pg_type t on t.oid = a.atttypid
                where a.attrelid = format('public.%I', constraint_table)::regclass
                  and a.attname = constraint_column
                  and t.typtype = 'e'
            ) and not exists (
                select 1
                from pg_attribute a
                join pg_type t on t.oid = a.atttypid
                join pg_enum e on e.enumtypid = t.oid
                where a.attrelid = format('public.%I', constraint_table)::regclass
                  and a.attname = constraint_column
                  and t.typtype = 'e'
                  and e.enumlabel = status_value
            ) then
                raise exception 'Enum public.%.% does not permit required value "%".',
                    constraint_table, constraint_column, status_value;
            end if;
        end loop;
    end loop;

    if exists (
        select 1 from storage.buckets
        where id = 'lordbless-client-documents'
          and (
              public
              or coalesce(file_size_limit, 0) < 15728640
              or (
                  allowed_mime_types is null
                  or not (
                      array[
                      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
                      'application/msword',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'application/vnd.ms-excel',
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      ]::text[] <@ allowed_mime_types
                      and allowed_mime_types <@ array[
                          'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
                          'application/msword',
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                          'application/vnd.ms-excel',
                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      ]::text[]
                  )
              )
          )
    ) then
        raise exception 'lordbless-client-documents exists with an incompatible privacy, size, or MIME configuration; inspect it before applying.';
    end if;
end;
$$;

-- Preserve request-to-upload linkage for both requirement-backed and custom
-- requests. ON DELETE SET NULL retains document history if a request is retired.
alter table public.client_documents
    add column if not exists document_request_id uuid;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.client_documents'::regclass
          and conname = 'client_documents_document_request_id_fkey'
    ) then
        alter table public.client_documents
            add constraint client_documents_document_request_id_fkey
            foreign key (document_request_id)
            references public.document_requests(id)
            on delete set null;
    end if;
end;
$$;

-- The existing review table stores action, note and timestamp but no reviewer.
alter table public.document_review_history
    add column if not exists reviewed_by uuid references public.staff_profiles(user_id) on delete set null;

-- Universal library uploads may have no request or enquiry. Keep history on
-- the document while allowing enquiry_id to be null for those records.
alter table public.document_review_history alter column enquiry_id drop not null;

create unique index if not exists client_documents_storage_path_unique_idx
    on public.client_documents(storage_path)
    where storage_path is not null;

create index if not exists client_documents_client_type_version_idx
    on public.client_documents(client_id, document_type, version desc);

create index if not exists client_documents_document_request_idx
    on public.client_documents(document_request_id)
    where document_request_id is not null;

create index if not exists document_requests_client_enquiry_created_idx
    on public.document_requests(client_id, enquiry_id, created_at desc);

create index if not exists document_review_history_document_created_idx
    on public.document_review_history(document_id, created_at desc);

-- Create the dedicated private bucket only when absent. Existing compatible
-- configuration is reused; incompatible configuration aborts above.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'lordbless-client-documents',
    'lordbless-client-documents',
    false,
    15728640,
    array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
)
on conflict (id) do nothing;

-- Clients may upload only beneath their own internal client UUID folder.
drop policy if exists lordbless_client_documents_client_insert on storage.objects;
create policy lordbless_client_documents_client_insert
on storage.objects for insert to authenticated
with check (
    bucket_id = 'lordbless-client-documents'
    and private.current_client_id() is not null
    and split_part(name, '/', 1) = private.current_client_id()::text
    and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(name, '/', 4) = ''
);

drop policy if exists lordbless_client_documents_read on storage.objects;
create policy lordbless_client_documents_read
on storage.objects for select to authenticated
using (
    bucket_id = 'lordbless-client-documents'
    and exists (
        select 1
        from public.client_documents d
        where d.storage_path = storage.objects.name
          and (
              d.client_id = private.current_client_id()
              or (
                  (private.has_permission('documents.read') or private.has_permission('documents.review'))
                  and private.can_access_client(d.client_id)
              )
          )
    )
);

-- A failed metadata write may clean up only an unregistered object in that
-- client's own folder. Existing records and files cannot be removed here.
drop policy if exists lordbless_client_documents_delete_orphan on storage.objects;
create policy lordbless_client_documents_delete_orphan
on storage.objects for delete to authenticated
using (
    bucket_id = 'lordbless-client-documents'
    and private.current_client_id()::text = split_part(name, '/', 1)
    and not exists (
        select 1 from public.client_documents d where d.storage_path = storage.objects.name
    )
);

-- Preserve the existing client/staff requirement reader and add scoped staff
-- access to requirements that do not yet have a document attached.
drop policy if exists enquiry_requirements_read_scoped_staff on public.enquiry_requirements;
create policy enquiry_requirements_read_scoped_staff
on public.enquiry_requirements for select to authenticated
using (
    private.is_overall_admin()
    or (
      (private.has_permission('documents.read') or private.has_permission('documents.review'))
      and exists (
        select 1 from public.enquiries e
        where e.id = enquiry_requirements.enquiry_id
          and private.can_access_client(e.client_id)
      )
    )
    or exists (
        select 1 from public.enquiries e
        where e.id = enquiry_requirements.enquiry_id
          and e.client_id = private.current_client_id()
          and enquiry_requirements.status is distinct from 'satisfied'
    )
);

-- Reviewers need read access to history within the same client scope as the
-- review RPC; clients continue to use the existing own-document policy.
drop policy if exists document_review_history_read_scoped_reviewers on public.document_review_history;
create policy document_review_history_read_scoped_reviewers
on public.document_review_history for select to authenticated
using (
    private.is_overall_admin()
    or (
        private.has_permission('documents.review')
        and exists (
            select 1
            from public.client_documents d
            where d.id = document_review_history.document_id
              and private.can_access_client(d.client_id)
        )
    )
);

create or replace function public.list_client_document_enquiries(p_client_id uuid)
returns table (enquiry_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not private.has_permission('documents.review')
       or not private.can_access_client(p_client_id) then
        raise exception 'Document request permission is required for this client.' using errcode = '42501';
    end if;

    return query
    select e.id, e.created_at
    from public.enquiries e
    where e.client_id = p_client_id
    order by e.created_at desc, e.id;
end;
$$;

revoke all on function public.list_client_document_enquiries(uuid) from public, anon;
grant execute on function public.list_client_document_enquiries(uuid) to authenticated;

create or replace function public.create_document_request(
    p_client_id uuid,
    p_enquiry_id uuid,
    p_requirement_id uuid,
    p_document_type text,
    p_document_name text,
    p_request_type text,
    p_message text,
    p_email boolean,
    p_portal boolean,
    p_whatsapp boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    enquiry_client_id uuid;
    saved_request_id uuid;
begin
    if auth.uid() is null
       or not private.has_permission('documents.review')
       or not private.can_access_client(p_client_id) then
        raise exception 'Document request permission is required for this client.' using errcode = '42501';
    end if;

    if p_client_id is null or p_enquiry_id is null
       or nullif(btrim(p_document_type), '') is null
       or nullif(btrim(p_document_name), '') is null
       or nullif(btrim(p_message), '') is null
       or p_request_type not in ('missing', 'replacement', 'expired', 'additional') then
        raise exception 'Client, enquiry, document and instructions are required.' using errcode = '22023';
    end if;

    select e.client_id into enquiry_client_id
    from public.enquiries e where e.id = p_enquiry_id;
    if enquiry_client_id is distinct from p_client_id then
        raise exception 'The selected enquiry does not belong to this client.' using errcode = '23514';
    end if;

    if p_requirement_id is not null and not exists (
        select 1 from public.enquiry_requirements r
        where r.id = p_requirement_id
          and r.enquiry_id = p_enquiry_id
          and r.document_type = p_document_type
    ) then
        raise exception 'The selected requirement does not match this enquiry and document type.' using errcode = '23514';
    end if;

    insert into public.document_requests (
        client_id, enquiry_id, requirement_id, document_type, document_name,
        request_type, message, status, email, portal, whatsapp, sent_at
    ) values (
        p_client_id, p_enquiry_id, p_requirement_id, btrim(p_document_type),
        btrim(p_document_name), p_request_type, btrim(p_message), 'requested',
        coalesce(p_email, false), coalesce(p_portal, true), coalesce(p_whatsapp, false), now()
    ) returning id into saved_request_id;

    if p_requirement_id is not null then
        update public.enquiry_requirements
        set status = 'required',
            requested_at = coalesce(requested_at, now()),
            satisfied_at = null,
            updated_at = now()
        where id = p_requirement_id and enquiry_id = p_enquiry_id;
    end if;

    return saved_request_id;
end;
$$;

revoke all on function public.create_document_request(uuid, uuid, uuid, text, text, text, text, boolean, boolean, boolean)
    from public, anon;
grant execute on function public.create_document_request(uuid, uuid, uuid, text, text, text, text, boolean, boolean, boolean)
    to authenticated;

create or replace function public.finalize_client_document_upload(
    p_client_id uuid,
    p_document_id uuid,
    p_document_request_id uuid,
    p_document_type text,
    p_document_name text,
    p_file_name text,
    p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    request_record public.document_requests%rowtype;
    next_version integer;
begin
    if auth.uid() is null or private.current_client_id() is distinct from p_client_id then
        raise exception 'You can upload documents only to your own active client account.' using errcode = '42501';
    end if;

    if p_document_id is null
       or nullif(btrim(p_document_type), '') is null
       or nullif(btrim(p_document_name), '') is null
       or nullif(btrim(p_file_name), '') is null
       or length(p_file_name) > 255
       or position('/' in p_file_name) > 0
       or position(chr(92) in p_file_name) > 0
       or p_file_name ~ '[[:cntrl:]]'
       or split_part(p_storage_path, '/', 1) <> p_client_id::text
       or split_part(p_storage_path, '/', 2) <> p_document_id::text
       or split_part(p_storage_path, '/', 3) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or split_part(p_storage_path, '/', 4) <> '' then
        raise exception 'Document upload metadata or private storage path is invalid.' using errcode = '22023';
    end if;

    if exists (select 1 from public.client_documents d where d.id = p_document_id) then
        if exists (select 1 from public.client_documents d where d.id = p_document_id and d.client_id = p_client_id and d.storage_path = p_storage_path) then
            return p_document_id;
        end if;
        raise exception 'Document ID already exists.' using errcode = '23505';
    end if;

    if p_document_request_id is not null then
        select * into request_record
        from public.document_requests r
        where r.id = p_document_request_id and r.client_id = p_client_id
        for update;

        if not found
           or request_record.document_type <> p_document_type
           or request_record.status not in ('requested', 'viewed', 'rejected') then
            raise exception 'This document request is unavailable or no longer accepts uploads.' using errcode = '42501';
        end if;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_client_id::text || ':' || p_document_type, 0)
    );

    select coalesce(max(d.version), 0) + 1 into next_version
    from public.client_documents d
    where d.client_id = p_client_id and d.document_type = p_document_type;

    update public.client_documents
    set is_current = false, is_reusable = false, updated_at = now()
    where client_id = p_client_id and document_type = p_document_type and is_current;

    insert into public.client_documents (
        id, client_id, document_type, document_name, file_name, storage_path,
        status, version, is_current, is_reusable, uploaded_at, document_request_id
    ) values (
        p_document_id, p_client_id, p_document_type, btrim(p_document_name),
        btrim(p_file_name), p_storage_path, 'reviewing', next_version,
        true, false, now(), p_document_request_id
    );

    if p_document_request_id is not null then
        update public.document_requests
        set status = 'uploaded', completed_at = null
        where id = p_document_request_id and client_id = p_client_id;

        if request_record.requirement_id is not null then
            update public.enquiry_requirements
            set client_document_id = p_document_id,
                status = 'required',
                satisfied_at = null,
                updated_at = now()
            where id = request_record.requirement_id and enquiry_id = request_record.enquiry_id;
        end if;
    end if;

    return p_document_id;
end;
$$;

revoke all on function public.finalize_client_document_upload(uuid, uuid, uuid, text, text, text, text)
    from public, anon;
grant execute on function public.finalize_client_document_upload(uuid, uuid, uuid, text, text, text, text)
    to authenticated;

create or replace function public.review_client_document(
    p_document_id uuid,
    p_action text,
    p_note text,
    p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    document_record public.client_documents%rowtype;
    request_record public.document_requests%rowtype;
    action_enquiry_id uuid;
begin
    if auth.uid() is null or not private.has_permission('documents.review') then
        raise exception 'Document review permission is required.' using errcode = '42501';
    end if;

    if p_action not in ('approved', 'rejected')
       or (p_action = 'rejected' and nullif(btrim(p_note), '') is null) then
        raise exception 'Choose approval or provide a rejection reason.' using errcode = '22023';
    end if;

    select * into document_record
    from public.client_documents d
    where d.id = p_document_id
    for update;

    if not found or not private.can_access_client(document_record.client_id) then
        raise exception 'Document not found or access denied.' using errcode = '42501';
    end if;

    if document_record.updated_at is distinct from p_expected_updated_at then
        raise exception 'This document changed while you were reviewing it. Reload and review the latest version.' using errcode = '40001';
    end if;

    if document_record.status = p_action then
        return document_record.id;
    end if;

    if document_record.status not in ('uploaded', 'reviewing') then
        raise exception 'Only a newly uploaded document can be reviewed.' using errcode = '22023';
    end if;

    if document_record.document_request_id is not null then
        select * into request_record
        from public.document_requests r
        where r.id = document_record.document_request_id
        for update;
        action_enquiry_id := request_record.enquiry_id;
    end if;

    update public.client_documents
    set status = p_action,
        approved_at = case when p_action = 'approved' then now() else null end,
        rejected_at = case when p_action = 'rejected' then now() else null end,
        rejection_reason = case when p_action = 'rejected' then btrim(p_note) else null end,
        is_reusable = p_action = 'approved'
            and is_current
            and (valid_from is null or valid_from <= current_date)
            and (valid_until is null or valid_until >= current_date),
        updated_at = now()
    where id = p_document_id;

    insert into public.document_review_history (
        document_id, enquiry_id, action, note, reviewed_by, created_at
    ) values (
        p_document_id, action_enquiry_id, p_action, nullif(btrim(p_note), ''), auth.uid(), now()
    );

    if document_record.document_request_id is not null then
        update public.document_requests
        set status = p_action,
            completed_at = case when p_action = 'approved' then now() else null end
        where id = document_record.document_request_id;
    end if;

    if request_record.requirement_id is not null then
        update public.enquiry_requirements
        set client_document_id = p_document_id,
            status = case when p_action = 'approved' then 'satisfied' else 'required' end,
            satisfied_at = case when p_action = 'approved' then now() else null end,
            admin_note = case when p_action = 'rejected' then btrim(p_note) else admin_note end,
            updated_at = now()
        where id = request_record.requirement_id
          and enquiry_id = request_record.enquiry_id;
    end if;

    return p_document_id;
end;
$$;

revoke all on function public.review_client_document(uuid, text, text, timestamptz)
    from public, anon;
grant execute on function public.review_client_document(uuid, text, text, timestamptz)
    to authenticated;

-- Verification queries (run after a separately approved migration application):
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'lordbless-client-documents';
-- select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'lordbless_client_documents_%';
-- select schemaname, tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('client_documents','document_requests','document_review_history','enquiry_requirements') order by tablename, policyname;
-- select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name in ('client_documents','document_requests','document_review_history','enquiry_requirements') order by table_name, ordinal_position;
-- select p.proname, pg_get_function_arguments(p.oid) as arguments, p.prorettype::regtype as returns from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('list_client_document_enquiries','create_document_request','finalize_client_document_upload','review_client_document') order by p.proname;
-- select table_name, column_name, udt_name, is_nullable from information_schema.columns where table_schema = 'public' and ((table_name = 'client_documents' and column_name = 'document_request_id') or (table_name = 'document_review_history' and column_name in ('reviewed_by','enquiry_id')));

commit;
