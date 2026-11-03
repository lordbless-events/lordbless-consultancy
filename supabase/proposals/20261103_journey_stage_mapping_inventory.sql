-- READ ONLY. Run against the production database before approving the
-- stage migration. This deliberately reports rows without assigning stages.
select
    journey.id as journey_id,
    journey.client_id,
    client.full_name as client_name,
    journey.title,
    journey.journey_type,
    journey.service,
    journey.destination,
    journey.status as legacy_status,
    count(milestone.id) as historical_milestone_count
from public.client_journeys as journey
join public.clients as client on client.id = journey.client_id
left join public.client_journey_milestones as milestone
    on milestone.journey_id = journey.id
group by journey.id, client.id
order by client.full_name, journey.created_at, journey.id;
