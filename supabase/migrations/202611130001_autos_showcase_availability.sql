-- LORDBLESS AUTOS unified catalogue availability and promotion metadata.
-- Additive only: existing vehicle IDs, references, photographs and supplier
-- relationships remain unchanged. Do not apply until separately authorised.
begin;

alter table public.autos_vehicles
    add column if not exists availability_status text not null default 'available_sourcing',
    add column if not exists is_featured boolean not null default false,
    add column if not exists promotional_order integer not null default 0;

do $$
begin
    if exists (
        select 1 from public.autos_vehicles
        where availability_status not in ('available_ghana','available_sourcing','reserved','sold')
           or promotional_order < 0
    ) then
        raise exception 'Existing AUTOS availability or promotional order values need review before continuing.';
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.autos_vehicles'::regclass
          and conname = 'autos_vehicles_availability_status_check'
    ) then
        alter table public.autos_vehicles
            add constraint autos_vehicles_availability_status_check
            check (availability_status in ('available_ghana','available_sourcing','reserved','sold'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.autos_vehicles'::regclass
          and conname = 'autos_vehicles_promotional_order_check'
    ) then
        alter table public.autos_vehicles
            add constraint autos_vehicles_promotional_order_check check (promotional_order >= 0);
    end if;
end;
$$;

create index if not exists autos_vehicles_public_promotion_idx
    on public.autos_vehicles (status, verification_status, availability_status, is_featured, promotional_order, published_at desc);

-- Preserve the existing public-safe view columns in order and append only
-- approved availability/showcase metadata. Supplier fields remain excluded.
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
    ), '[]'::jsonb) as photos,
    v.availability_status,
    v.is_featured,
    v.promotional_order
from public.autos_vehicles v
where v.status = 'published'
  and v.verification_status = 'verified'
  and exists (
      select 1
      from public.autos_vehicle_photos p
      where p.vehicle_id = v.id
        and p.is_cover
  );

revoke all on public.autos_public_catalogue from public;
grant select on public.autos_public_catalogue to anon, authenticated;

commit;
