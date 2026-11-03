-- REVIEW ONLY. Do not run until the read-only inventory confirms the exact
-- journey UUID and associated milestone count for Josephine Essel.
-- Replace NULL with that verified UUID before any separately approved run.
-- The checks below require both Josephine's client relationship and a Canton
-- Fair label on the selected journey. No account or unrelated records change.

begin;

do $$
declare
    target_journey_id uuid := null; -- replace only with the reviewed UUID
    target_client_id uuid;
    deleted_milestones integer;
    deleted_journeys integer;
begin
    if target_journey_id is null then
        raise exception 'Set target_journey_id only after verifying the production journey UUID.';
    end if;

    select client.id
    into target_client_id
    from public.client_journeys as journey
    join public.clients as client on client.id = journey.client_id
    where journey.id = target_journey_id
      and lower(btrim(client.full_name)) = 'josephine essel'
      and concat_ws(' ', journey.title, journey.journey_type, journey.service)
          ilike '%canton fair%';

    if target_client_id is null then
        raise exception 'The selected UUID is not a Canton Fair journey belonging to Josephine Essel.';
    end if;

    delete from public.client_journey_milestones
    where journey_id = target_journey_id;
    get diagnostics deleted_milestones = row_count;

    delete from public.client_journeys
    where id = target_journey_id
      and client_id = target_client_id;
    get diagnostics deleted_journeys = row_count;

    if deleted_journeys <> 1 then
        raise exception 'Expected to delete exactly one verified journey; transaction will roll back.';
    end if;

    raise notice 'Targeted cleanup would remove 1 journey and % directly associated milestones.', deleted_milestones;
end;
$$;

-- Keep this ROLLBACK for review/preview. Change to COMMIT only in a separately
-- approved execution after confirming the notice and the reviewed UUID.
rollback;
