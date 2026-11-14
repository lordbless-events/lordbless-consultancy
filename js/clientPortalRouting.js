/* Shared client activation and portal routing for login and session restore. */
(function () {
    "use strict";

    async function resolve(accessStatus, options = {}) {
        let status = accessStatus || "unknown";
        const standardPortalRequested = options.forceStandard === true ||
            new URLSearchParams(window.location.search).get("portal") === "standard";

        if (status === "activation_required") {
            try {
                const { data, error } = await lordblessSupabase.rpc("activate_eligible_autos_client_account");
                if (error) throw error;
                if (["active", "activation_required", "suspended", "closed", "invited"].includes(data)) {
                    status = data;
                }
            } catch (error) {
                // Older deployments keep the existing limited-access state.
                console.warn("AUTOS activation check unavailable:", error?.message || error);
            }
        }

        if (!["active", "activation_required"].includes(status)) {
            return { accessStatus: status, destination: "restricted" };
        }

        if (status !== "active" || standardPortalRequested) {
            return { accessStatus: status, destination: "client" };
        }

        try {
            const { data, error } = await lordblessSupabase.rpc("has_autos_customer_portal");
            if (error) throw error;
            return { accessStatus: status, destination: data === true ? "autos" : "client" };
        } catch (error) {
            // Preserve existing client access if the additive routing RPC is
            // not available; existing RLS still limits what the client sees.
            console.warn("AUTOS portal routing check unavailable:", error?.message || error);
            return { accessStatus: status, destination: "client" };
        }
    }

    window.LORDBLESS_CLIENT_PORTAL_ROUTING = Object.freeze({ resolve });
})();
