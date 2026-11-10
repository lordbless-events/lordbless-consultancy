import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const inviteRedirectUrl = Deno.env.get("PORTAL_INVITE_REDIRECT_URL");
const allowedOrigins = new Set([
    "https://lordblessconsultancy.com",
    ...(Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
]);

const jsonHeaders = {
    "Content-Type": "application/json",
    "Vary": "Origin",
};

function response(
    status: number,
    body: Record<string, unknown>,
    origin?: string,
) {
    const headers = new Headers(jsonHeaders);
    if (origin && allowedOrigins.has(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
        headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    }
    return new Response(JSON.stringify(body), { status, headers });
}

function isUuid(value: unknown): value is string {
    return typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findAuthUserByEmail(serviceClient: any, email: string) {
    const targetEmail = email.trim().toLowerCase();
    const perPage = 1000;

    for (let page = 1; ; page += 1) {
        const { data, error } = await serviceClient.auth.admin.listUsers({
            page,
            perPage,
        });

        if (error) throw error;

        const users = data?.users || [];
        const match = users.find(
            (user: { email?: string }) =>
                user.email?.trim().toLowerCase() === targetEmail,
        );

        if (match) return match;
        if (users.length < perPage) return null;
    }
}

Deno.serve(async (request) => {
    const origin = request.headers.get("origin") || undefined;

   if (request.method === "OPTIONS") {

    const headers = new Headers(jsonHeaders);

    if (origin && allowedOrigins.has(origin)) {

        headers.set("Access-Control-Allow-Origin", origin);

        headers.set(
            "Access-Control-Allow-Headers",
            "authorization, x-client-info, apikey, content-type"
        );

        headers.set(
            "Access-Control-Allow-Methods",
            "POST, OPTIONS"
        );

    }

    return new Response(null, {
        status: 204,
        headers
    });

}

    if (origin && !allowedOrigins.has(origin)) {
        return response(403, { error: "Origin is not allowed." });
    }

    if (request.method !== "POST") {
        return response(405, { error: "Method not allowed." }, origin);
    }

    if (!supabaseUrl || !serviceRoleKey || !inviteRedirectUrl) {
        return response(500, { error: "Portal invitation function is not configured." }, origin);
    }

    const authorization = request.headers.get("Authorization") || "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) {
        return response(401, { error: "An authenticated staff session is required." }, origin);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } =
        await serviceClient.auth.getUser(accessToken);
    const caller = authData.user;
    if (authError || !caller) {
        return response(401, { error: "The staff session is invalid or expired." }, origin);
    }

    const { data: profile, error: profileError } = await serviceClient
        .from("staff_profiles")
        .select("user_id, active")
        .eq("user_id", caller.id)
        .maybeSingle();

    if (profileError || !profile?.active) {
        return response(403, { error: "Active staff access is required." }, origin);
    }

    const { data: staffRoles, error: rolesError } = await serviceClient
        .from("staff_roles")
        .select("role_code")
        .eq("user_id", caller.id);

    const { data: directPermissions, error: directPermissionsError } =
        await serviceClient
            .from("staff_permissions")
            .select("permission_code")
            .eq("user_id", caller.id);

    if (rolesError || directPermissionsError) {
        return response(500, { error: "Unable to verify staff permissions." }, origin);
    }

    const roleCodes = (staffRoles || []).map((item) => item.role_code);
    const directPermissionCodes = (directPermissions || [])
        .map((item) => item.permission_code);

    let rolePermissionCodes: string[] = [];
    if (roleCodes.length) {
        const { data: rolePermissions, error: rolePermissionsError } =
            await serviceClient
                .from("role_permissions")
                .select("permission_code")
                .in("role_code", roleCodes);

        if (rolePermissionsError) {
            return response(500, { error: "Unable to verify staff permissions." }, origin);
        }
        rolePermissionCodes = (rolePermissions || [])
            .map((item) => item.permission_code);
    }

    const canCreateAccess = roleCodes.includes("overall_admin") ||
        directPermissionCodes.includes("admin.all") ||
        directPermissionCodes.includes("clients.portal_access") ||
        rolePermissionCodes.includes("clients.portal_access") ||
        rolePermissionCodes.includes("admin.all");

    if (!canCreateAccess) {
        return response(403, { error: "You do not have permission to create Client Portal access." }, origin);
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return response(400, { error: "A JSON request body is required." }, origin);
    }

    const clientId = body.client_id;
    const action = body.action === undefined ? "create" : body.action;
    if (action !== "create" && action !== "resend_invitation") {
        return response(400, { error: "A supported portal access action is required." }, origin);
    }
    if (!isUuid(clientId)) {
        return response(400, { error: "A valid client_id is required." }, origin);
    }

    const { data: client, error: clientError } = await serviceClient
        .from("clients")
        .select("id, email")
        .eq("id", clientId)
        .maybeSingle();

    if (clientError || !client) {
        return response(404, { error: "The client record was not found." }, origin);
    }
    if (!client.email?.trim()) {
        return response(422, { error: "This client record has no email address for an invitation." }, origin);
    }

    const { data: existingAccount, error: accountLookupError } =
        await serviceClient
            .from("client_accounts")
            .select("auth_user_id, client_id, access_status")
            .eq("client_id", client.id)
            .maybeSingle();

    if (accountLookupError) {
        return response(500, { error: "Unable to check existing portal access." }, origin);
    }

    if (action === "resend_invitation") {
        if (
            !existingAccount ||
            existingAccount.client_id !== client.id ||
            existingAccount.access_status !== "invited" ||
            !isUuid(existingAccount.auth_user_id)
        ) {
            return response(409, {
                error: "A resend is available only for this client's existing invited portal account.",
            }, origin);
        }

        const { data: existingAuthData, error: existingAuthError } =
            await serviceClient.auth.admin.getUserById(existingAccount.auth_user_id);
        const existingAuthUser = existingAuthData?.user;
        if (existingAuthError || !existingAuthUser) {
            return response(409, { error: "The linked Auth identity could not be verified." }, origin);
        }
        if (!existingAuthUser.email?.trim()) {
            return response(422, { error: "The linked Auth identity has no recovery email address." }, origin);
        }

        const hasConfirmedEmail = Boolean(existingAuthUser.email_confirmed_at);
        const resendResult = hasConfirmedEmail
            ? await serviceClient.auth.resetPasswordForEmail(
                existingAuthUser.email.trim(),
                { redirectTo: inviteRedirectUrl },
            )
            : await serviceClient.auth.admin.inviteUserByEmail(
                existingAuthUser.email.trim(),
                { redirectTo: inviteRedirectUrl },
            );

        if (resendResult.error) {
            return response(409, {
                error: resendResult.error.message || "The invitation could not be resent.",
            }, origin);
        }
        return response(200, {
            success: true,
            invitation_resent: !hasConfirmedEmail,
            password_recovery_sent: hasConfirmedEmail,
            client_id: client.id,
            access_status: "invited",
        }, origin);
    }

    if (existingAccount) {
        return response(200, {
            success: true,
            already_linked: true,
            client_id: client.id,
            access_status: existingAccount.access_status,
        }, origin);
    }

    let authUser: any;
    let sentInvitation = false;

    try {
        authUser = await findAuthUserByEmail(serviceClient, client.email);
    } catch {
        return response(500, { error: "Unable to check for an existing Auth user." }, origin);
    }

    // A prior partial attempt may have created an unconfirmed Auth identity
    // without linking it. Reissue the invitation for that same identity.
    if (authUser && !authUser.email_confirmed_at) {
        const { error: inviteError } =
            await serviceClient.auth.admin.inviteUserByEmail(
                client.email.trim(),
                { redirectTo: inviteRedirectUrl },
            );
        if (inviteError) {
            return response(409, {
                error: inviteError.message || "The Client Portal invitation could not be resent.",
            }, origin);
        }
        sentInvitation = true;
    }

    if (!authUser) {
        const { data: inviteData, error: inviteError } =
            await serviceClient.auth.admin.inviteUserByEmail(
                client.email.trim(),
                { redirectTo: inviteRedirectUrl },
            );

        authUser = inviteData?.user || null;
        sentInvitation = Boolean(authUser && !inviteError);

        // A concurrent request may have created this Auth identity first.
        if (inviteError || !authUser) {
            try {
                authUser = await findAuthUserByEmail(serviceClient, client.email);
            } catch {
                return response(500, { error: "Unable to check for an existing Auth user." }, origin);
            }

            if (!authUser) {
                return response(409, {
                    error: inviteError?.message || "The invitation could not be created.",
                }, origin);
            }
        }
    }

    const { data: staffProfile, error: staffProfileError } = await serviceClient
        .from("staff_profiles")
        .select("user_id")
        .eq("user_id", authUser.id)
        .maybeSingle();

    if (staffProfileError) {
        return response(500, { error: "Unable to verify the existing Auth identity." }, origin);
    }
    if (staffProfile) {
        return response(409, { error: "This Auth user is already assigned as LORDBLESS staff." }, origin);
    }

    const { data: existingUserAccount, error: userAccountError } = await serviceClient
        .from("client_accounts")
        .select("client_id, access_status")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();

    if (userAccountError) {
        return response(500, { error: "Unable to verify the existing client link." }, origin);
    }
    if (existingUserAccount) {
        return response(409, {
            error: existingUserAccount.client_id === client.id
                ? "This client already has a linked portal account."
                : "This Auth user is already linked to another client.",
        }, origin);
    }

    const { error: linkError } = await serviceClient
        .from("client_accounts")
        .insert({
            auth_user_id: authUser.id,
            client_id: client.id,
            access_status: "invited",
            invited_at: new Date().toISOString(),
        });

    if (linkError) {
        // Treat a concurrent successful link as an idempotent retry.
        const { data: linkedAccount, error: linkedAccountError } = await serviceClient
            .from("client_accounts")
            .select("auth_user_id, client_id, access_status")
            .eq("client_id", client.id)
            .maybeSingle();

        if (
            !linkedAccountError &&
            linkedAccount?.client_id === client.id &&
            linkedAccount.auth_user_id === authUser.id
        ) {
            return response(200, {
                success: true,
                already_linked: true,
                client_id: client.id,
                access_status: linkedAccount.access_status,
            }, origin);
        }

        if (linkedAccount?.client_id === client.id) {
            return response(409, { error: "This client is already linked to a different Auth user." }, origin);
        }

        // Keep an unlinked Auth identity so a retry can safely finish linking it.
        return response(500, { error: "The Auth user exists but the client link could not be saved. Retry the request." }, origin);
    }

    const { error: metadataError } = await serviceClient.auth.admin
        .updateUserById(authUser.id, {
            app_metadata: {
                ...authUser.app_metadata,
                portal_role: "client",
            },
        });

    if (metadataError) {
        return response(500, { error: "The client link was saved, but Auth metadata could not be updated. Retry the request." }, origin);
    }

    return response(sentInvitation ? 201 : 200, {
        success: true,
        client_id: client.id,
        access_status: "invited",
        invitation_sent: sentInvitation,
        existing_auth_user_linked: !sentInvitation,
    }, origin);
});
