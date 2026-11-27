-- REVIEW ONLY. The client journey request workflow is retired; retain its
-- historical request rows but ensure the obsolete assignment RPC cannot
-- create status-based journeys. No records are modified by this proposal.

begin;

do $$
begin
    if to_regprocedure('public.assign_client_journey_request(uuid,text,text,text,text,text,uuid,uuid)') is not null then
        revoke all on function public.assign_client_journey_request(uuid,text,text,text,text,text,uuid,uuid)
            from public, anon, authenticated, service_role;
    end if;
end;
$$;

commit;
