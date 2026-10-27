-- LORDBLESS AUTOS catalogue. Apply only after reviewing the deployment
-- requirements; this migration has not been run against production.

insert into public.permissions (permission_code, description)
values ('autos.manage', 'Manage the LORDBLESS AUTOS vehicle catalogue and photographs.')
on conflict (permission_code) do nothing;

create table if not exists public.autos_vehicles (
    id uuid primary key default gen_random_uuid(),
    reference text not null unique
        check (reference ~ '^LBC-CAR-[0-9]{4}$'),
    make text not null default '',
    model text not null default '',
    year smallint,
    mileage_km integer,
    condition text,
    body_type text,
    fuel_type text,
    transmission text,
    drivetrain text,
    engine text,
    description text,
    supplier_name text not null default 'CBBase',
    supplier_vehicle_id text,
    supplier_listing_url text,
    verification_status text not null default 'pending'
        check (verification_status in ('pending', 'verified', 'conflict')),
    verification_notes text,
    verified_at timestamptz,
    verified_by uuid references auth.users(id) on delete set null,
    status text not null default 'draft'
        check (status in ('draft', 'published', 'unavailable')),
    published_at timestamptz,
    created_by uuid default auth.uid() references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint autos_vehicles_year_check check (year is null or year between 2016 and 2100),
    constraint autos_vehicles_mileage_check check (mileage_km is null or mileage_km >= 0),
    constraint autos_vehicles_verified_metadata_check check (
        verification_status <> 'verified' or (verified_at is not null and verified_by is not null)
    )
);

create table if not exists public.autos_vehicle_photos (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references public.autos_vehicles(id) on delete restrict,
    storage_path text not null unique,
    sort_order integer not null default 0 check (sort_order >= 0),
    is_cover boolean not null default false,
    uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint autos_vehicle_photos_path_check check (storage_path like vehicle_id::text || '/%')
);

create unique index if not exists autos_vehicle_one_cover_photo
    on public.autos_vehicle_photos (vehicle_id) where is_cover;
create unique index if not exists autos_supplier_vehicle_reference_unique
    on public.autos_vehicles (supplier_name, supplier_vehicle_id)
    where supplier_vehicle_id is not null;
create index if not exists autos_vehicles_public_lookup
    on public.autos_vehicles (status, verification_status, published_at desc);
create index if not exists autos_vehicle_photos_vehicle_order
    on public.autos_vehicle_photos (vehicle_id, sort_order, created_at);

create or replace function private.set_autos_vehicle_metadata()
returns trigger
language plpgsql
set search_path = pg_catalog, auth
as $$
begin
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.verification_status = 'verified' then
        if tg_op = 'INSERT' or old.verification_status <> 'verified' then
            new.verified_at := now();
            new.verified_by := auth.uid();
        end if;
    end if;
    if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
        new.published_at := now();
    end if;
    return new;
end;
$$;

create or replace function private.guard_autos_vehicle_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if new.status = 'published' then
        if new.verification_status <> 'verified'
            or new.verified_at is null
            or new.year is null or new.year < 2016
            or nullif(btrim(new.make), '') is null
            or nullif(btrim(new.model), '') is null
            or not exists (
                select 1 from public.autos_vehicle_photos p
                where p.vehicle_id = new.id and p.is_cover
            ) then
            raise exception 'A vehicle needs a confirmed year (2016+), make, model, verified details, and cover photo before publishing.'
                using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists autos_vehicles_metadata on public.autos_vehicles;
create trigger autos_vehicles_metadata
before insert or update on public.autos_vehicles
for each row execute function private.set_autos_vehicle_metadata();

drop trigger if exists autos_vehicles_publish_guard on public.autos_vehicles;
create trigger autos_vehicles_publish_guard
before insert or update on public.autos_vehicles
for each row execute function private.guard_autos_vehicle_publish();

revoke all on function private.set_autos_vehicle_metadata() from public, anon, authenticated;
revoke all on function private.guard_autos_vehicle_publish() from public, anon, authenticated;

alter table public.autos_vehicles enable row level security;
alter table public.autos_vehicle_photos enable row level security;
grant select, insert, update on public.autos_vehicles to authenticated;
grant select, insert, update, delete on public.autos_vehicle_photos to authenticated;
revoke all on public.autos_vehicles, public.autos_vehicle_photos from public, anon;

drop policy if exists autos_vehicles_manage on public.autos_vehicles;
create policy autos_vehicles_manage on public.autos_vehicles
for all to authenticated
using (private.has_permission('autos.manage'))
with check (private.has_permission('autos.manage'));

drop policy if exists autos_vehicle_photos_manage on public.autos_vehicle_photos;
create policy autos_vehicle_photos_manage on public.autos_vehicle_photos
for all to authenticated
using (private.has_permission('autos.manage'))
with check (private.has_permission('autos.manage'));

-- Deliberately expose only public-facing fields; supplier identifiers and
-- internal verification notes are never returned by this view.
create or replace view public.autos_public_catalogue
with (security_barrier = true)
as
select
    v.id,
    v.reference,
    v.make,
    v.model,
    v.year,
    v.mileage_km,
    v.condition,
    v.body_type,
    v.fuel_type,
    v.transmission,
    v.drivetrain,
    v.engine,
    v.description,
    v.published_at,
    coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'storage_path', p.storage_path,
            'sort_order', p.sort_order,
            'is_cover', p.is_cover
        ) order by p.is_cover desc, p.sort_order, p.created_at)
        from public.autos_vehicle_photos p
        where p.vehicle_id = v.id
    ), '[]'::jsonb) as photos
from public.autos_vehicles v
where v.status = 'published'
  and v.verification_status = 'verified'
  and exists (
      select 1 from public.autos_vehicle_photos p
      where p.vehicle_id = v.id and p.is_cover
  );

revoke all on public.autos_public_catalogue from public;
grant select on public.autos_public_catalogue to anon, authenticated;

create or replace view public.autos_public_vehicle_photo_paths
with (security_barrier = true)
as
select p.storage_path
from public.autos_vehicle_photos p
join public.autos_vehicles v on v.id = p.vehicle_id
where v.status = 'published'
  and v.verification_status = 'verified';

revoke all on public.autos_public_vehicle_photo_paths from public;
grant select on public.autos_public_vehicle_photo_paths to anon, authenticated;

-- Separate, private Storage bucket. Signed reads are allowed only for
-- published/verified catalogue photos or to staff with autos.manage.
do $$
begin
    if exists (
        select 1 from storage.buckets
        where id = 'lordbless-autos-catalogue'
          and (
              public
              or (file_size_limit is not null and file_size_limit < 15728640)
              or (
                  allowed_mime_types is not null
                  and not (array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[] <@ allowed_mime_types)
              )
          )
    ) then
        raise exception 'The existing lordbless-autos-catalogue bucket settings are incompatible; inspect them before applying this migration.';
    end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'lordbless-autos-catalogue',
    'lordbless-autos-catalogue',
    false,
    15728640,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
)
on conflict (id) do nothing;

drop policy if exists autos_published_photos_read_public on storage.objects;
create policy autos_published_photos_read_public on storage.objects
for select to anon
using (
    bucket_id = 'lordbless-autos-catalogue'
    and exists (
        select 1 from public.autos_public_vehicle_photo_paths p
        where p.storage_path = storage.objects.name
    )
);

drop policy if exists autos_staff_photos_read on storage.objects;
create policy autos_staff_photos_read on storage.objects
for select to authenticated
using (
    bucket_id = 'lordbless-autos-catalogue'
    and (
        private.has_permission('autos.manage')
        or exists (
            select 1 from public.autos_public_vehicle_photo_paths p
            where p.storage_path = storage.objects.name
        )
    )
);

drop policy if exists autos_staff_photos_insert on storage.objects;
create policy autos_staff_photos_insert on storage.objects
for insert to authenticated
with check (
    bucket_id = 'lordbless-autos-catalogue'
    and private.has_permission('autos.manage')
    and exists (
        select 1 from public.autos_vehicles v
        where v.id::text = split_part(storage.objects.name, '/', 1)
    )
);

drop policy if exists autos_staff_photos_update on storage.objects;
create policy autos_staff_photos_update on storage.objects
for update to authenticated
using (bucket_id = 'lordbless-autos-catalogue' and private.has_permission('autos.manage'))
with check (
    bucket_id = 'lordbless-autos-catalogue'
    and private.has_permission('autos.manage')
    and exists (
        select 1 from public.autos_vehicles v
        where v.id::text = split_part(storage.objects.name, '/', 1)
    )
);

drop policy if exists autos_staff_photos_delete on storage.objects;
create policy autos_staff_photos_delete on storage.objects
for delete to authenticated
using (
    bucket_id = 'lordbless-autos-catalogue'
    and private.has_permission('autos.manage')
    and exists (
        select 1 from public.autos_vehicles v
        where v.id::text = split_part(storage.objects.name, '/', 1)
    )
);
