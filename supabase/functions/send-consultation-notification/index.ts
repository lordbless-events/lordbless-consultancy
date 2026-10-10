import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const emailFrom = Deno.env.get("LORDBLESS_EMAIL_FROM");
const allowedOrigins = new Set([
    "https://lordblessconsultancy.com",
    ...(Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "")
        .split(",").map((origin) => origin.trim()).filter(Boolean),
]);

function json(status: number, body: Record<string, unknown>, origin?: string) {
    const headers = new Headers({ "Content-Type": "application/json", "Vary": "Origin" });
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

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character] || character));
}

async function setOutboxError(service: any, id: string, message: string) {
    await service.from("client_consultation_email_outbox")
        .update({ status: "failed", last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", id);
}

Deno.serve(async (request) => {
    const origin = request.headers.get("origin") || undefined;
    if (request.method === "OPTIONS") {
        const headers = new Headers({ "Vary": "Origin" });
        if (origin && allowedOrigins.has(origin)) {
            headers.set("Access-Control-Allow-Origin", origin);
            headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
            headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        }
        return new Response(null, { status: 204, headers });
    }
    if (origin && !allowedOrigins.has(origin)) return json(403, { error: "Origin is not allowed." });
    if (request.method !== "POST") return json(405, { error: "Method not allowed." }, origin);
    if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Consultation notification storage is not configured." }, origin);

    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json(401, { error: "An authenticated staff session is required." }, origin);

    const service = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await service.auth.getUser(token);
    const caller = authData?.user;
    if (authError || !caller) return json(401, { error: "The staff session is invalid or expired." }, origin);

    const { data: profile, error: profileError } = await service
        .from("staff_profiles").select("active").eq("user_id", caller.id).maybeSingle();
    if (profileError || !profile?.active) return json(403, { error: "Active staff access is required." }, origin);

    const [{ data: roles, error: rolesError }, { data: direct, error: directError }] = await Promise.all([
        service.from("staff_roles").select("role_code").eq("user_id", caller.id),
        service.from("staff_permissions").select("permission_code").eq("user_id", caller.id),
    ]);
    if (rolesError || directError) return json(500, { error: "Unable to verify staff permissions." }, origin);
    const roleCodes = (roles || []).map((item: { role_code: string }) => item.role_code);
    const permissions = (direct || []).map((item: { permission_code: string }) => item.permission_code);
    let rolePermissions: string[] = [];
    if (roleCodes.length) {
        const { data, error } = await service.from("role_permissions")
            .select("permission_code").in("role_code", roleCodes);
        if (error) return json(500, { error: "Unable to verify staff permissions." }, origin);
        rolePermissions = (data || []).map((item: { permission_code: string }) => item.permission_code);
    }
    const isOverallAdmin = roleCodes.includes("overall_admin") ||
        permissions.includes("admin.all") || rolePermissions.includes("admin.all");
    if (!isOverallAdmin && !permissions.includes("consultations.manage") &&
        !rolePermissions.includes("consultations.manage")) {
        return json(403, { error: "Consultation management permission is required." }, origin);
    }

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return json(400, { error: "A JSON body is required." }, origin); }
    const notificationId = body.notification_id;
    if (!isUuid(notificationId)) return json(400, { error: "A valid notification_id is required." }, origin);

    const { data: outbox, error: outboxError } = await service
        .from("client_consultation_email_outbox")
        .select("id, notification_id, client_id, status, attempt_count, updated_at")
        .eq("notification_id", notificationId).maybeSingle();
    if (outboxError || !outbox) return json(404, { error: "The consultation email record was not found." }, origin);
    if (outbox.status === "sent") return json(200, { sent: true, already_sent: true }, origin);

    if (!isOverallAdmin) {
        const { data: assignments, error: assignmentError } = await service
            .from("client_desk_assignments").select("desk_id").eq("client_id", outbox.client_id);
        if (assignmentError) return json(500, { error: "Unable to verify client desk access." }, origin);
        const deskIds = (assignments || []).map((item: { desk_id: string }) => item.desk_id);
        if (!deskIds.length) return json(403, { error: "This client is not assigned to a desk you can access." }, origin);
        const { data: staffDesks, error: deskError } = await service
            .from("staff_desks").select("desk_id").eq("user_id", caller.id).in("desk_id", deskIds);
        if (deskError) return json(500, { error: "Unable to verify client desk access." }, origin);
        if (!staffDesks?.length) return json(403, { error: "This client is outside your assigned desk access." }, origin);
    }

    const claimTime = new Date().toISOString();
    let claimQuery = service.from("client_consultation_email_outbox")
        .update({ status: "sending", attempt_count: Number(outbox.attempt_count || 0) + 1, updated_at: claimTime })
        .eq("id", outbox.id);
    if (outbox.status === "sending") {
        const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        claimQuery = claimQuery.eq("status", "sending").lt("updated_at", staleBefore);
    } else {
        claimQuery = claimQuery.in("status", ["pending", "failed"]);
    }
    const { data: claimedRows, error: claimError } = await claimQuery.select("id");
    if (claimError) return json(500, { error: "Unable to claim the consultation email for delivery." }, origin);
    if (!claimedRows?.length) return json(409, { error: "This consultation email is already being delivered." }, origin);

    if (!resendApiKey || !emailFrom) {
        const message = "Email delivery is not configured. Set RESEND_API_KEY and LORDBLESS_EMAIL_FROM.";
        await setOutboxError(service, outbox.id, message);
        return json(503, { sent: false, email_status: "failed", error: message }, origin);
    }

    const [{ data: notice, error: noticeError }, { data: account, error: accountError }] = await Promise.all([
        service.from("client_consultation_notifications")
            .select("id, client_id, title, message, event_type")
            .eq("id", notificationId).maybeSingle(),
        service.from("client_accounts").select("auth_user_id")
            .eq("client_id", outbox.client_id).maybeSingle(),
    ]);
    if (noticeError || accountError || !notice || !account?.auth_user_id) {
        const message = "The linked client account or consultation notice could not be loaded.";
        await setOutboxError(service, outbox.id, message);
        return json(500, { sent: false, email_status: "failed", error: message }, origin);
    }
    const { data: authResult, error: userError } = await service.auth.admin.getUserById(account.auth_user_id);
    const recipient = authResult?.user?.email?.trim();
    if (userError || !recipient || !authResult?.user?.email_confirmed_at) {
        const message = "The client's confirmed Auth email address is unavailable.";
        await setOutboxError(service, outbox.id, message);
        return json(422, { sent: false, email_status: "failed", error: message }, origin);
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `client-consultation/${notificationId}`,
        },
        body: JSON.stringify({
            from: emailFrom,
            to: [recipient],
            subject: notice.title,
            text: notice.message,
            html: `<p>${escapeHtml(notice.message).replace(/\n/g, "<br>")}</p>`,
        }),
    });
    const providerResult = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = String(providerResult?.message || providerResult?.error || `Email provider returned HTTP ${response.status}.`);
        await setOutboxError(service, outbox.id, message);
        return json(502, { sent: false, email_status: "failed", error: message }, origin);
    }

    const { error: savedError } = await service.from("client_consultation_email_outbox")
        .update({ status: "sent", provider_message_id: providerResult?.id || null, sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
        .eq("id", outbox.id);
    if (savedError) {
        return json(202, { sent: true, status_recorded: false, message: "Email provider accepted the notice; delivery status could not be saved." }, origin);
    }
    return json(200, { sent: true, email_status: "sent" }, origin);
});
