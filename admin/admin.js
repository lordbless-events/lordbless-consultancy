/* =========================================
   LORDBLESS ADMIN PORTAL
   DEVELOPMENT VERSION
========================================= */


/* =========================================
   APPLICATION STATE
========================================= */

const state = {

    currentView: "dashboard",

    enquiries: [],

    journeys: [],

    journeyLoadError: "",

    journeyAssignees: [],

    enquiryDataSource: "loading",

    enquiryLoadError: "",

    authReady: false,

    authSession: null,

    authUser: null,

    adminIdentity: null,

    authResolvingUserId: null,

    authError: "",

    search: "",

    statusFilter: "all"

};


/* =========================================
   CURRENT ADMIN USER
========================================= */

let LORDBLESS_CURRENT_USER = null;


function getCurrentUser() {

    return LORDBLESS_CURRENT_USER;

}


function getCurrentUserAccess() {

    return getAccessSummary(
        getCurrentUser()
    );

}


/* =========================================
   DOM
========================================= */

const appContent =
    document.getElementById(
        "app-content"
    );


const pageTitle =
    document.getElementById(
        "page-title"
    );


const enquiryModal =
    document.getElementById(
        "enquiry-modal"
    );


const modalContent =
    document.getElementById(
        "modal-content"
    );


const closeModal =
    document.getElementById(
        "close-modal"
    );


/* =========================================
   INITIALISE
========================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        setupNavigation();

        setupModal();

        setupAdminDocumentRequestEvents();

        setupAdminAuth();

    }
);


function setupAdminAuth() {

    showAdminAuthGate(
        "Checking for an existing Admin session..."
    );

    lordblessSupabase.auth.onAuthStateChange(
        (event, session) => {

            if (event === "INITIAL_SESSION") {
                return;
            }

            state.authError = "";
            applyAdminAuthSession(session);

        }
    );

    lordblessSupabase.auth
        .getSession()
        .then(({ data, error }) => {

            state.authError =
                error?.message || "";

            applyAdminAuthSession(
                data?.session || null
            );

        })
        .catch(error => {

            state.authError =
                error?.message ||
                String(error);

            applyAdminAuthSession(null);

        });

    document
        .querySelector(".logout-button")
        ?.addEventListener(
            "click",
            signOutAdmin
        );

}


function applyAdminAuthSession(session) {

    const previousUserId =
        state.authUser?.id || null;

    state.authSession =
        session || null;

    state.authUser =
        session?.user || null;

    if (!state.authUser) {

        state.authReady = true;
        state.adminIdentity = null;
        state.authResolvingUserId = null;
        LORDBLESS_CURRENT_USER = null;
        window.LORDBLESS_CURRENT_USER = null;

        state.enquiries = [];
        state.journeys = [];
        state.journeyLoadError = "";
        state.journeyAssignees = [];
        state.enquiryDataSource = "loading";
        state.enquiryLoadError = "";

        showAdminAuthGate(
            state.authError
        );

        return;

    }

    const authUser = state.authUser;

    if (state.adminIdentity?.id === authUser.id) {
        state.authReady = true;
        return;
    }

    if (state.authResolvingUserId === authUser.id) {
        return;
    }

    state.authReady = false;
    state.authResolvingUserId = authUser.id;
    state.authError = "";
    state.journeys = [];
    state.journeyLoadError = "";
    state.journeyAssignees = [];
    showAdminAuthGate("Resolving your staff access...");

    void resolveAdminAccessContext(authUser)
        .then(async identity => {

            if (state.authUser?.id !== authUser.id) {
                return;
            }

            state.authResolvingUserId = null;
            state.adminIdentity = identity;
            state.authReady = true;
            LORDBLESS_CURRENT_USER = identity;
            window.LORDBLESS_CURRENT_USER = identity;
            state.authError = "";

            hideAdminAuthGate();
            updateAdminIdentity(authUser, identity);
            applyAdminNavigationAccess();

            if (!hasPermission(identity, "enquiries.read")) {
                state.enquiries = [];
                state.enquiryDataSource = "not_authorized";
                state.enquiryLoadError = "Your staff permissions do not include enquiry access.";
            }

            const allowedView = getFirstPermittedAdminView(
                identity,
                state.currentView
            );

            if (!allowedView) {
                state.currentView = "";
                if (appContent) {
                    appContent.innerHTML = `
                        <section class="section">
                            <div class="section-header">
                                <div>
                                    <h2>No Admin modules assigned</h2>
                                    <p class="section-subtitle">Contact an Overall Admin to request the permissions required for your work.</p>
                                </div>
                            </div>
                        </section>
                    `;
                }
                return;
            }

            if (hasPermission(identity, "journeys.read")) {
                await loadAdminJourneys();
            }

            state.currentView = allowedView;
            renderView(allowedView);

            if (
                previousUserId !== authUser.id &&
                hasPermission(identity, "enquiries.read")
            ) {
                loadAdminEnquiries();
            }

        })
        .catch(error => {

            if (state.authUser?.id !== authUser.id) {
                return;
            }

            state.authResolvingUserId = null;
            state.adminIdentity = null;
            state.authReady = true;
            LORDBLESS_CURRENT_USER = null;
            window.LORDBLESS_CURRENT_USER = null;
            state.authError = error?.message || String(error);
            showAdminAuthGate(state.authError);

        });

}


async function resolveAdminAccessContext(authUser) {

    const { data: profile, error: profileError } =
        await lordblessSupabase
            .from("staff_profiles")
            .select("user_id, display_name, active")
            .eq("user_id", authUser.id)
            .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.active) {
        throw new Error("This account is not assigned an active LORDBLESS staff profile.");
    }

    const [rolesResult, permissionsResult, desksResult] =
        await Promise.all([
            lordblessSupabase
                .from("staff_roles")
                .select("role_code, is_primary")
                .eq("user_id", authUser.id),
            lordblessSupabase
                .from("staff_permissions")
                .select("permission_code")
                .eq("user_id", authUser.id),
            lordblessSupabase
                .from("staff_desks")
                .select("desk_id, desks(code, name)")
                .eq("user_id", authUser.id)
        ]);

    if (rolesResult.error) throw rolesResult.error;
    if (permissionsResult.error) throw permissionsResult.error;
    if (desksResult.error) throw desksResult.error;

    const roles = rolesResult.data || [];
    if (!roles.length) {
        throw new Error("This staff profile has no role assignment.");
    }

    const roleCodes = roles.map(item => item.role_code);
    let rolePermissionCodes = [];

    if (roleCodes.length) {
        const { data, error } = await lordblessSupabase
            .from("role_permissions")
            .select("permission_code")
            .in("role_code", roleCodes);

        if (error) throw error;
        rolePermissionCodes = (data || [])
            .map(item => item.permission_code);
    }

    let desks = (desksResult.data || [])
        .map(item => ({
            id: item.desk_id,
            code: item.desks?.code || "",
            name: item.desks?.name || ""
        }))
        .filter(item => item.code);

    const permissions = [...new Set([
        ...rolePermissionCodes,
        ...(permissionsResult.data || []).map(item => item.permission_code)
    ])];

    const isOverallAdmin =
        roleCodes.includes("overall_admin") ||
        permissions.includes("admin.all");

    if (isOverallAdmin) {
        const { data: allDesks, error: allDesksError } =
            await lordblessSupabase
                .from("desks")
                .select("id, code, name")
                .eq("active", true);

        if (allDesksError) throw allDesksError;
        desks = allDesks || [];
    }

    const primaryRole =
        roles.find(item => item.is_primary)?.role_code ||
        roles[0].role_code;

    return {
        id: authUser.id,
        userId: authUser.id,
        name: profile.display_name || authUser.email || "Staff member",
        role: primaryRole,
        roleCodes,
        permissions,
        desks,
        deskIds: desks.map(item => item.code),
        desk: desks[0]?.code || null,
        isOverallAdmin
    };

}


const ADMIN_VIEW_PERMISSIONS = {
    dashboard: "dashboard.read",
    enquiries: "enquiries.read",
    clients: "clients.read",
    followups: "followups.read",
    documents: "documents.read",
    finance: "finance.read",
    assessments: "applications.read",
    stories: "stories.read",
    team: "team.manage",
    settings: "settings.read"
};


function getFirstPermittedAdminView(user, requestedView) {

    if (
        ADMIN_VIEW_PERMISSIONS[requestedView] &&
        hasPermission(user, ADMIN_VIEW_PERMISSIONS[requestedView])
    ) {
        return requestedView;
    }

    const availableView = Object.entries(ADMIN_VIEW_PERMISSIONS)
        .find(([view, permission]) => hasPermission(user, permission));

    return availableView?.[0] || null;

}


function applyAdminNavigationAccess() {

    const user = getCurrentUser();
    if (!user) return;

    document.querySelectorAll("[data-view]").forEach(item => {
        const permission = ADMIN_VIEW_PERMISSIONS[item.dataset.view];
        if (!permission) return;
        item.hidden = !hasPermission(user, permission);
    });

}


function showAdminAuthGate(message = "") {

    const adminApp =
        document.querySelector(".admin-app");

    if (adminApp) {
        adminApp.inert = true;
        adminApp.setAttribute(
            "aria-hidden",
            "true"
        );
    }

    let gate =
        document.getElementById(
            "admin-auth-gate"
        );

    if (!gate) {
        gate = document.createElement("div");
        gate.id = "admin-auth-gate";
        gate.setAttribute("role", "dialog");
        gate.setAttribute("aria-modal", "true");
        gate.style.cssText =
            "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:#0b1730;";
        document.body.appendChild(gate);
    }

    gate.innerHTML = `
        <section style="width:min(100%, 440px);padding:36px;background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.28);">
            <div class="topbar-label">LORDBLESS CONSULTANCY</div>
            <h1 style="margin:12px 0 8px;color:#0b1730;">Admin sign in</h1>
            <p style="margin:0 0 24px;color:#667085;">Sign in with your Admin account to continue.</p>
            <form id="admin-auth-form">
                <label for="admin-auth-email">Email</label>
                <input id="admin-auth-email" class="search-input" type="email" autocomplete="username" required style="display:block;width:100%;margin:8px 0 18px;">
                <label for="admin-auth-password">Password</label>
                <input id="admin-auth-password" class="search-input" type="password" autocomplete="current-password" required style="display:block;width:100%;margin:8px 0 18px;">
                <button class="button" type="submit" ${state.authReady ? "" : "disabled"}>Sign in</button>
                <p id="admin-auth-message" role="alert" style="margin:14px 0 0;color:#9b1c1c;"></p>
                <button id="admin-auth-sign-out" class="button" type="button" ${state.authUser ? "" : "hidden"} style="margin-top:12px;">Sign out</button>
            </form>
        </section>
    `;

    const status =
        gate.querySelector(
            "#admin-auth-message"
        );

    if (status) {
        status.textContent = message;
    }

    gate
        .querySelector("#admin-auth-sign-out")
        ?.addEventListener("click", signOutAdmin);

    gate
        .querySelector("#admin-auth-form")
        ?.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                const email =
                    gate.querySelector(
                        "#admin-auth-email"
                    ).value.trim();

                const password =
                    gate.querySelector(
                        "#admin-auth-password"
                    ).value;

                const submitButton =
                    gate.querySelector(
                        'button[type="submit"]'
                    );

                if (submitButton) {
                    submitButton.disabled = true;
                }

                let result;

                try {
                    result =
                        await lordblessSupabase.auth
                            .signInWithPassword({
                                email,
                                password
                            });
                } catch (error) {
                    if (status) {
                        status.textContent =
                            error?.message ||
                            String(error);
                    }
                    if (submitButton) {
                        submitButton.disabled = false;
                    }
                    return;
                }

                const { data, error } = result;

                if (error) {
                    if (status) {
                        status.textContent =
                            error.message;
                    }
                    if (submitButton) {
                        submitButton.disabled = false;
                    }
                    return;
                }

                state.authError = "";
                applyAdminAuthSession(
                    data.session
                );

            }
        );

}


function hideAdminAuthGate() {

    document
        .getElementById("admin-auth-gate")
        ?.remove();

    const adminApp =
        document.querySelector(".admin-app");

    if (adminApp) {
        adminApp.inert = false;
        adminApp.removeAttribute(
            "aria-hidden"
        );
    }

}


function updateAdminIdentity(user, identity = getCurrentUser()) {

    const displayName =
        identity?.name ||
        user.user_metadata?.full_name ||
        user.email ||
        "Staff member";

    const nameElement =
        document.querySelector(
            ".profile-info strong"
        );

    const roleElement =
        document.querySelector(
            ".profile-info span"
        );

    const avatar =
        document.querySelector(
            ".profile-avatar"
        );

    if (nameElement) {
        nameElement.textContent = displayName;
    }

    if (roleElement) {
        roleElement.textContent = getRoleLabel(identity?.role);
    }

    if (avatar) {
        avatar.textContent =
            displayName.charAt(0).toUpperCase();
    }

}


async function signOutAdmin() {

    try {
        const { error } =
            await lordblessSupabase.auth.signOut();

        if (error) throw error;

        state.authError = "";
        applyAdminAuthSession(null);
    } catch (error) {
        console.error(
            "LORDBLESS ADMIN SIGN OUT ERROR:",
            error
        );
        window.alert(
            `Unable to sign out: ${error.message}`
        );
    }

}


async function requestClientPortalAccess(clientId, action = "create") {

    if (
        !state.authUser ||
        !getCurrentUser() ||
        !hasPermission(getCurrentUser(), "clients.portal_access")
    ) {
        throw new Error("You are not authorized to request Client Portal access.");
    }

    const { data, error } =
        await lordblessSupabase.functions.invoke(
            "create-client-portal-access",
            {
                body: action === "resend_invitation"
                    ? { client_id: clientId, action }
                    : { client_id: clientId }
            }
        );

    if (error) throw error;
    return data;

}


window.requestClientPortalAccess =
    requestClientPortalAccess;


async function loadAdminEnquiries() {

    const requestUserId =
        state.authUser?.id;

    if (!requestUserId) {
        return;
    }

    if (!state.adminIdentity?.isOverallAdmin) {
        state.enquiries = [];
        state.enquiryDataSource = "scope_unavailable";
        state.enquiryLoadError =
            "Desk-scoped enquiry access is withheld until the live enquiry-to-client ownership relationship is verified and protected by RLS.";
        if (["dashboard", "enquiries"].includes(state.currentView)) {
            renderView(state.currentView);
        }
        return;
    }

    try {

        const {
            data,
            error
        } = await lordblessSupabase
            .from("enquiries")
            .select("*, client:clients(*)");


        if (state.authUser?.id !== requestUserId) {
            return;
        }


        if (error) {
            throw error;
        }


        state.enquiries =
            (data || []).map(
                mapSupabaseEnquiry
            );

        state.enquiryDataSource =
            "supabase";

        state.enquiryLoadError = "";

    } catch (error) {

        if (state.authUser?.id !== requestUserId) {
            return;
        }

        console.error(
            "LORDBLESS ADMIN ENQUIRIES SUPABASE ERROR:",
            error
        );

        const isLocalDevelopment =
            window.location.protocol === "file:" ||
            ["localhost", "127.0.0.1", "::1"]
                .includes(window.location.hostname);

        if (
            isLocalDevelopment &&
            state.adminIdentity?.isOverallAdmin
        ) {
            state.enquiries = [
                ...LORDBLESS_MOCK_DATA.enquiries
            ];
            state.enquiryDataSource =
                "development_fallback";
        } else {
            state.enquiries = [];
            state.enquiryDataSource =
                "error";
        }

        state.enquiryLoadError =
            error?.message ||
            String(error);

    }


    if (
        state.currentView === "dashboard" ||
        state.currentView === "enquiries"
    ) {
        renderView(state.currentView);
    }

}


function mapSupabaseEnquiry(record) {

    const details =
        record.data ||
        record.enquiry_data ||
        record.form_data ||
        record.payload ||
        record;

    const relatedClient = Array.isArray(record.client)
        ? record.client[0]
        : record.client;

    const client =
        relatedClient ||
        details.client ||
        {};

    const clientName =
        client.fullName || client.full_name || client.name ||
        record.client_name || record.full_name || details.clientName || "";

    const services =
        record.services ||
        details.services ||
        [];

    return {
        ...record,
        ...details,
        id: record.id || details.id || "",
        reference:
            record.reference || record.enquiry_reference ||
            details.reference || record.id || "",
        desk: record.desk || details.desk || "unassigned",
        client: {
            ...client,
            id: client.id || record.client_id || details.clientId || "",
            clientCode: client.client_code || client.clientCode || "",
            fullName: clientName,
            name: client.name || clientName,
            email: client.email || record.client_email || record.email || "",
            whatsapp:
                client.whatsapp || client.phone ||
                record.client_whatsapp || record.whatsapp || "",
            currentCountry:
                client.currentCountry || client.current_country ||
                record.current_country || "",
            nationality: client.nationality || record.nationality || ""
        },
        services: Array.isArray(services)
            ? services
            : services ? [services] : [],
        journey: record.journey || details.journey || {},
        status: record.status || details.status || "new",
        createdAt:
            record.createdAt || record.created_at ||
            record.submitted_at || details.submittedAt || "",
        notes: Array.isArray(record.notes) ? record.notes : details.notes || [],
        followups:
            Array.isArray(record.followups)
                ? record.followups
                : details.followups || []
    };

}


function renderEnquiryDataNotice() {

    if (state.enquiryDataSource === "loading") {
        return `
            <div class="section-subtitle" role="status">
                Loading enquiries from Supabase...
            </div>
        `;
    }

    if (state.enquiryDataSource === "development_fallback") {
        return `
            <div class="section-subtitle" role="alert">
                Supabase enquiries could not be loaded. Showing development fixtures.
                ${escapeHTML(state.enquiryLoadError)}
            </div>
        `;
    }

    if (state.enquiryDataSource === "error") {
        return `
            <div class="section-subtitle" role="alert">
                Supabase enquiries could not be loaded. No mock records are displayed.
                ${escapeHTML(state.enquiryLoadError)}
            </div>
        `;
    }

    if (state.enquiryDataSource === "scope_unavailable") {
        return `
            <div class="section-subtitle" role="status">
                ${escapeHTML(state.enquiryLoadError)}
            </div>
        `;
    }

    return "";

}


/* =========================================
   DOCUMENT REQUEST EVENTS
========================================= */

function setupAdminDocumentRequestEvents() {

    window.addEventListener(
        "lordbless:document-request-created",
        event => {

            const request =
                event?.detail;


            if (!request) {
                return;
            }


            const requests =
                LORDBLESS_ADMIN_DOCUMENT_DATA.requests;


            const alreadyExists =
                requests.some(
                    item =>
                        item.id === request.id
                );


            if (!alreadyExists) {

                requests.unshift(
                    request
                );

            }


            if (
                state.currentView ===
                "documents"
            ) {

                renderAdminDocuments();

            }

        }
    );

}


/* =========================================
   NAVIGATION
========================================= */

function setupNavigation() {

    document
        .querySelectorAll(
            ".nav-item[data-view]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const view =
                        button.dataset.view;

                    state.currentView =
                        view;

                    setActiveNavigation(
                        view
                    );

                    renderView(
                        view
                    );

                }
            );

        });

}


function setActiveNavigation(
    view
) {

    document
        .querySelectorAll(
            ".nav-item[data-view]"
        )
        .forEach(item => {

            item.classList.toggle(
                "active",
                item.dataset.view === view
            );

        });

}


/* =========================================
   FINANCE WORKSPACE
========================================= */

function renderFinanceWorkspace() {

    const template =
        document.getElementById(
            "finance-template"
        );

    if (!template) {

        appContent.innerHTML = `
            <div class="empty-state">
                Finance workspace could not be loaded.
            </div>
        `;

        console.error(
            "LORDBLESS FINANCE: finance-template not found."
        );

        return;
    }


    appContent.innerHTML = "";

    appContent.appendChild(
        template.content.cloneNode(true)
    );


    setupFinanceNavigation();

    renderFinanceView(
        "overview"
    );

}


/* =========================================
   FINANCE INTERNAL NAVIGATION
========================================= */

function setupFinanceNavigation() {

    document
        .querySelectorAll(
            ".finance-nav-item"
        )
        .forEach(item => {

            item.addEventListener(
                "click",
                () => {

                    const view =
                        item.dataset.financeView;

                    if (!view) {
                        return;
                    }

                    document
                        .querySelectorAll(
                            ".finance-nav-item"
                        )
                        .forEach(navItem => {

                            navItem.classList.toggle(
                                "active",
                                navItem === item
                            );

                        });


                    renderFinanceView(
                        view
                    );

                }
            );

        });

}


/* =========================================
   FINANCE SUB-VIEWS
========================================= */

/* =========================================
   FINANCE SUB-VIEWS
========================================= */

let LORDBLESS_FINANCE_ACTIVE_VIEW = "overview";
let LORDBLESS_ASSESSMENT_FINANCE_REQUESTS = [];
let LORDBLESS_ASSESSMENT_FINANCE_LOADED = false;
let LORDBLESS_ASSESSMENT_FINANCE_LOADED_AT = 0;
let LORDBLESS_ASSESSMENT_FINANCE_LOADING = false;
let LORDBLESS_ASSESSMENT_FINANCE_ERROR = "";


function getFinancePaymentRequests() {

    if (
        window.LORDBLESS_PAYMENT_BRIDGE &&
        typeof window.LORDBLESS_PAYMENT_BRIDGE.load === "function"
    ) {
        const data =
            window.LORDBLESS_PAYMENT_BRIDGE.load();

        return mergeAdminAssessmentRequests(
            Array.isArray(data.paymentRequests) ? data.paymentRequests : []
        );
    }

    return Array.isArray(
        window.LORDBLESS_PAYMENT_REQUESTS
    )
        ? mergeAdminAssessmentRequests(window.LORDBLESS_PAYMENT_REQUESTS)
        : mergeAdminAssessmentRequests([]);

}


function mergeAdminAssessmentRequests(localRequests) {
    const assessmentRequests = Array.isArray(window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY)
        ? window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY
        : [];
    const databaseClients = new Set(assessmentRequests.flatMap(request => [
        String(request.clientId),
        String(request.clientCode || ""),
        String(request.clientUuid || "")
    ]));
    return [
        ...(Array.isArray(localRequests) ? localRequests : []).filter(request => !(
            request?.purpose === "initial_assessment_consultation" &&
            databaseClients.has(String(request.clientId))
        )),
        ...assessmentRequests
    ];
}


function loadAdminAssessmentFinanceRequests() {
    if (LORDBLESS_ASSESSMENT_FINANCE_LOADING) return;
    if (
        LORDBLESS_ASSESSMENT_FINANCE_LOADED &&
        Date.now() - LORDBLESS_ASSESSMENT_FINANCE_LOADED_AT < 10000
    ) return;
    LORDBLESS_ASSESSMENT_FINANCE_LOADED = false;
    LORDBLESS_ASSESSMENT_FINANCE_LOADING = true;

    lordblessSupabase
        .from("client_assessment_payments")
        .select("id, client_id, client_name, client_code, reference, amount, standard_amount, discount_amount, currency, purpose, status, verification_status, payment_instructions, client_payment_submitted_at, client_payment_date, client_payment_reference, verified_by, verified_by_name, verified_at, amount_received, payment_date, transaction_reference, receipt_number, receipt_issued_at, created_at")
        .order("created_at", { ascending: true })
        .then(({ data, error }) => {
            LORDBLESS_ASSESSMENT_FINANCE_ERROR = error?.message || "";
            LORDBLESS_ASSESSMENT_FINANCE_REQUESTS = (data || []).map(item => ({
                ...item,
                clientId: item.client_code || "ID pending",
                clientUuid: item.client_id,
                clientName: item.client_name,
                clientCode: item.client_code || "ID pending",
                standardAmount: Number(item.standard_amount ?? 1000),
                discountAmount: Number(item.discount_amount ?? 0),
                paymentInstructions: item.payment_instructions || "",
                verificationStatus: item.verification_status,
                verifiedByName: item.verified_by_name || "",
                receiptId: item.receipt_number || null,
                receiptNumber: item.receipt_number || null,
                verification: item.verification_status === "verified" ? {
                    status: "confirmed",
                    receivedAmount: Number(item.amount_received ?? item.amount),
                    amountReceived: Number(item.amount_received ?? item.amount),
                    currency: item.currency,
                    paymentDate: item.payment_date,
                    transactionReference: item.transaction_reference,
                    verifiedAt: item.verified_at,
                    verifiedBy: item.verified_by_name || item.verified_by
                } : null,
                databaseAssessment: true
            }));
            window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY = LORDBLESS_ASSESSMENT_FINANCE_REQUESTS;
            window.LORDBLESS_ASSESSMENT_FINANCE_RECEIPTS = LORDBLESS_ASSESSMENT_FINANCE_REQUESTS
                .filter(item => item.receipt_number && item.verificationStatus === "verified")
                .map(item => ({
                    id: item.receipt_number,
                    receiptNumber: item.receipt_number,
                    paymentRequestId: item.id,
                    paymentId: item.id,
                    clientId: item.clientCode,
                    clientName: item.clientName,
                    paymentRequestReference: item.reference,
                    description: "Initial Assessment & 30-Minute Consultation",
                    amount: Number(item.amount_received ?? item.amount),
                    standardAmount: item.standardAmount,
                    discountAmount: item.discountAmount,
                    currency: item.currency,
                    paymentDate: item.payment_date,
                    paymentMethod: "Mobile Money",
                    paymentReference: item.transaction_reference,
                    issuedAt: item.receipt_issued_at,
                    verifiedAt: item.verified_at,
                    verifiedByName: item.verifiedByName,
                    status: "issued",
                    databaseAssessment: true
                }));
            LORDBLESS_ASSESSMENT_FINANCE_LOADED = true;
        })
        .catch(error => {
            LORDBLESS_ASSESSMENT_FINANCE_ERROR = error?.message || "Assessment payment requests could not be loaded.";
            LORDBLESS_ASSESSMENT_FINANCE_LOADED = true;
        })
        .finally(() => {
            LORDBLESS_ASSESSMENT_FINANCE_LOADING = false;
            LORDBLESS_ASSESSMENT_FINANCE_LOADED_AT = Date.now();
            if (["verification", "receipts", "reports"].includes(LORDBLESS_FINANCE_ACTIVE_VIEW)) {
                renderFinanceView(LORDBLESS_FINANCE_ACTIVE_VIEW);
            }
        });
}

window.addEventListener("lordbless:assessment-payment-request-created", () => {
    LORDBLESS_ASSESSMENT_FINANCE_LOADED = false;
    LORDBLESS_ASSESSMENT_FINANCE_LOADED_AT = 0;
    loadAdminAssessmentFinanceRequests();
});


/* =========================================
   NORMALISE RICH PAYMENT REQUEST
========================================= */

function normaliseFinancePaymentRequest(
    payload
) {

    const context =
        window.LORDBLESS_FINANCE_PAYMENT_CONTEXT || {};

    const items =
        Array.isArray(payload.items)
            ? payload.items
            : [];

    const itemNames =
        items
            .map(item => item.name)
            .filter(Boolean);

    const now =
        new Date().toISOString();

    return {

        id:
            payload.id ||
            `PAY-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)
                .toUpperCase()}`,

        reference:
            payload.reference ||
            payload.invoiceNumber ||
            `LBC-PAY-${Date.now()}`,

        invoiceNumber:
            payload.invoiceNumber || null,

        clientId:
            payload.clientId ||
            context.clientId ||
            null,

        clientName:
            payload.client?.name ||
            context.clientName ||
            "Client",

        transactionId:
            payload.transactionId ||
            payload.enquiryReference ||
            context.transactionId ||
            null,

        transactionTitle:
            context.transactionTitle ||
            payload.enquiryReference ||
            "Journey",

        destination:
            context.destination ||
            "",

        service:
            context.service ||
            null,

        requestType:
            itemNames.join(", ") ||
            "Service Fee",

        description:
            payload.clientMessage ||
            itemNames.join(", ") ||
            "Payment Request",

        amount:
            Number(payload.total) || 0,

        currency:
            payload.primaryCurrency ||
            "EUR",

        requestedDate:
            payload.createdAt ||
            now,

        dueDate:
            payload.dueDate ||
            null,

        paymentInstructions:
            payload.paymentInstructions ||
            "",

        internalNote:
            payload.adminNote ||
            "",

        delivery: {
            portal: true,
            email:
                payload.delivery?.email !== false,
            whatsapp:
                payload.delivery?.whatsapp !== false
        },

        status:
            "requested",

        verificationStatus:
            "not_verified",

        receiptId:
            null,

        createdAt:
            payload.createdAt ||
            now,

        updatedAt:
            now

    };

}


/* =========================================
   PAYMENT REQUEST CREATED
========================================= */

function bindFinancePaymentEvents() {

    if (
        window.__LORDBLESS_FINANCE_PAYMENT_EVENTS_BOUND
    ) {
        return;
    }

    window.__LORDBLESS_FINANCE_PAYMENT_EVENTS_BOUND =
        true;


    document.addEventListener(
        "lordbless:payment-request-created",
        function (event) {

            const payload =
                event.detail;

            if (!payload) {
                return;
            }


            const request =
                normaliseFinancePaymentRequest(
                    payload
                );


            window.LORDBLESS_FINANCE_PAYMENT_CONTEXT =
                null;


            if (
                window.LORDBLESS_PAYMENT_BRIDGE &&
                typeof window
                    .LORDBLESS_PAYMENT_BRIDGE
                    .savePaymentRequest ===
                    "function"
            ) {

                window.LORDBLESS_PAYMENT_BRIDGE
                    .savePaymentRequest(
                        request
                    );

            }


            if (
                LORDBLESS_FINANCE_ACTIVE_VIEW ===
                "verification"
            ) {

                renderFinanceView(
                    "verification"
                );

            }

        }
    );


    document.addEventListener(
        "lordbless:payment-verified",
        function () {

            if (
                LORDBLESS_FINANCE_ACTIVE_VIEW ===
                "verification"
            ) {

                renderFinanceView(
                    "verification"
                );

            }

        }
    );


    document.addEventListener(
        "lordbless:receipt-issued",
        function () {

            if (
                LORDBLESS_FINANCE_ACTIVE_VIEW ===
                "receipts"
            ) {

                renderFinanceView(
                    "receipts"
                );

            }

        }
    );

}


/* =========================================
   PAYMENT REQUEST SELECTOR
========================================= */

function openFinancePaymentRequest() {

    const clients =
        getAdminClients();

    const container =
        document.getElementById(
            "finance-content"
        );

    if (
        !container ||
        !clients.length
    ) {

        alert(
            "No clients are currently available."
        );

        return;

    }


    container.innerHTML = `

        <div class="finance-view">

            <div class="section-header">

                <div>

                    <p class="section-eyebrow">
                        FINANCE
                    </p>

                    <h2>
                        Request Payment
                    </h2>

                    <p class="section-description">
                        Select the client and journey for this payment request.
                    </p>

                </div>

            </div>


            <div class="finance-content-card">

                <div class="lbc-payment-form-grid">

                    <div class="lbc-payment-form-group">

                        <label for="finance-payment-client">
                            Client
                        </label>

                        <select
                            id="finance-payment-client"
                        >

                            <option value="">
                                Select client
                            </option>

                            ${clients.map(client => `
                                <option value="${escapeHTML(client.id)}">
                                    ${escapeHTML(
                                        client.name ||
                                        client.fullName ||
                                        client.id
                                    )}
                                </option>
                            `).join("")}

                        </select>

                    </div>


                    <div class="lbc-payment-form-group">

                        <label for="finance-payment-journey">
                            Journey
                        </label>

                        <select
                            id="finance-payment-journey"
                            disabled
                        >

                            <option value="">
                                Select journey
                            </option>

                        </select>

                    </div>

                </div>


                <div class="lbc-payment-actions">

                    <button
                        type="button"
                        class="button button-secondary"
                        id="finance-payment-cancel"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        class="button button-primary"
                        id="finance-payment-continue"
                        disabled
                    >
                        Continue
                    </button>

                </div>

            </div>

        </div>

    `;


    const clientSelect =
        document.getElementById(
            "finance-payment-client"
        );

    const journeySelect =
        document.getElementById(
            "finance-payment-journey"
        );

    const continueButton =
        document.getElementById(
            "finance-payment-continue"
        );

    const cancelButton =
        document.getElementById(
            "finance-payment-cancel"
        );


    clientSelect.addEventListener(
        "change",
        function () {

            const clientId =
                clientSelect.value;

            journeySelect.innerHTML = `
                <option value="">
                    Select journey
                </option>
            `;

            journeySelect.disabled =
                !clientId;

            continueButton.disabled =
                true;


            if (!clientId) {
                return;
            }


            const journeys =
                getAdminClientJourneys(
                    clientId
                );


            journeys.forEach(
                journey => {

                    const option =
                        document.createElement(
                            "option"
                        );

                    option.value =
                        journey.id;

                    option.textContent =
                        journey.title ||
                        journey.name ||
                        journey.id;

                    journeySelect.appendChild(
                        option
                    );

                }
            );

        }
    );


    journeySelect.addEventListener(
        "change",
        function () {

            continueButton.disabled =
                !journeySelect.value;

        }
    );


    cancelButton.addEventListener(
        "click",
        function () {

            renderFinanceView(
                "payments"
            );

        }
    );


    continueButton.addEventListener(
        "click",
        function () {

            const clientId =
                clientSelect.value;

            const journeyId =
                journeySelect.value;

            const client =
                clients.find(
                    item =>
                        item.id === clientId
                );

            const journey =
                getAdminClientJourneys(
                    clientId
                ).find(
                    item =>
                        item.id === journeyId
                );


            if (
                !client ||
                !journey
            ) {
                return;
            }


            window.LORDBLESS_FINANCE_PAYMENT_CONTEXT = {

                clientId:
                    client.id,

                clientName:
                    client.name ||
                    client.fullName ||
                    "",

                transactionId:
                    journey.id,

                transactionTitle:
                    journey.title ||
                    journey.name ||
                    "Journey",

                destination:
                    journey.destination ||
                    "",

                service:
                    journey.service ||
                    null

            };


            if (
                window.LORDBLESS_PAYMENT_REQUEST &&
                typeof window
                    .LORDBLESS_PAYMENT_REQUEST
                    .render ===
                    "function"
            ) {

                const enquiry = {

                    id:
                        journey.id,

                    enquiry_reference:
                        journey.id,

                    reference:
                        journey.id,

                    client:
                        client,

                    clientName:
                        client.name ||
                        client.fullName ||
                        "",

                    email:
                        client.email ||
                        "",

                    destination:
                        journey.destination ||
                        "",

                    service:
                        journey.service ||
                        null,

                    services:
                        journey.service
                            ? [journey.service]
                            : []

                };


               window.LORDBLESS_PAYMENT_REQUEST
    .render(
        container,
        client,
        journey,
        {
            currency: "EUR"
        }
    );

            } else {

                alert(
                    "Payment Request engine is not available."
                );

            }

        }
    );

}


/* =========================================
   FINANCE SUB-VIEWS
========================================= */

function renderFinanceView(
    view
) {

    LORDBLESS_FINANCE_ACTIVE_VIEW =
        view;


    const container =
        document.getElementById(
            "finance-content"
        );

    if (!container) {
        return;
    }


    bindFinancePaymentEvents();


    switch (view) {


        /* =====================================
           OVERVIEW
        ===================================== */

        case "overview":

            if (
                window.LORDBLESS_FINANCE_DASHBOARD &&
                typeof window
                    .LORDBLESS_FINANCE_DASHBOARD
                    .render ===
                    "function"
            ) {

                window.LORDBLESS_FINANCE_DASHBOARD
                    .render(
                        container,
                        {}
                    );

            } else {

                container.innerHTML = `

                    <div class="empty-state">

                        <h3>
                            Finance Dashboard
                        </h3>

                        <p>
                            Finance Dashboard could not be loaded.
                        </p>

                    </div>

                `;

            }

            break;


        /* =====================================
           PAYMENTS
        ===================================== */


        case "payments": {

            container.innerHTML = `

                <div class="finance-view finance-payments-view">

                    <div class="finance-payments-actionbar">

                        <div></div>

                        <button
                            type="button"
                            class="button button-primary"
                            id="finance-request-payment"
                        >
                            + Request Payment
                        </button>

                    </div>


                    <div
                        id="finance-payments-engine"
                        class="finance-payments-engine"
                    ></div>

                </div>

            `;


            const paymentsEngine =
                document.getElementById(
                    "finance-payments-engine"
                );


            if (
                window.LORDBLESS_ADMIN_PAYMENTS &&
                typeof window
                    .LORDBLESS_ADMIN_PAYMENTS
                    .render ===
                    "function"
            ) {

                window.LORDBLESS_ADMIN_PAYMENTS
                    .render(
                        paymentsEngine,
                        getAdminClients()
                    );

            } else {

                paymentsEngine.innerHTML = `

                    <div class="empty-state">

                        <h3>
                            Payments module could not be loaded.
                        </h3>

                    </div>

                `;

            }


            const requestButton =
                document.getElementById(
                    "finance-request-payment"
                );


            if (requestButton) {

                requestButton.addEventListener(
                    "click",
                    openFinancePaymentRequest
                );

            }


            break;

        }


       /* =====================================
           VERIFICATION
        ===================================== */

        case "verification": {

            loadAdminAssessmentFinanceRequests();
            const localRequests = getFinancePaymentRequests();
            const databaseClientIds = new Set(
                LORDBLESS_ASSESSMENT_FINANCE_REQUESTS.map(request => request.clientId)
            );
            const requests = [
                ...localRequests.filter(request =>
                    !(request?.purpose === "initial_assessment_consultation" && databaseClientIds.has(request.clientId))
                ),
                ...LORDBLESS_ASSESSMENT_FINANCE_REQUESTS
            ].filter(
                        request =>
                            request &&
                            request.status !==
                                "cancelled" &&
                            request.verificationStatus !==
                                "verified"
                    );


            container.innerHTML = `

                <div class="finance-view">

                    <div class="section-header">

                        <div>

                            <p class="section-eyebrow">
                                FINANCE VERIFICATION
                            </p>

                            <h2>
                                Payment Verification
                            </h2>

                            <p class="section-description">
                                Verify payments received before they are marked as paid.
                            </p>

                        </div>

                    </div>


                    ${LORDBLESS_ASSESSMENT_FINANCE_ERROR
                        ? `<p class="section-description" role="alert">Persistent assessment payments are unavailable: ${escapeHTML(LORDBLESS_ASSESSMENT_FINANCE_ERROR)}</p>`
                        : LORDBLESS_ASSESSMENT_FINANCE_LOADING
                            ? `<p class="section-description">Loading persistent assessment payment requests…</p>`
                            : ""}


                    ${
                        requests.length
                            ? `
                                <div class="finance-content-card">

                                    <div class="lbc-finance-client-table-wrap">

                                        <table class="lbc-finance-client-table">

                                            <thead>

                                                <tr>
                                                    <th>Reference</th>
                                                    <th>Client</th>
                                                    <th>Journey</th>
                                                    <th>Client ID</th>
                                                    <th>Standard fee</th>
                                                    <th>Discount</th>
                                                    <th>Amount due</th>
                                            <th>Payment / verification status</th>
                                                    <th>Action</th>
                                                </tr>

                                            </thead>

                                            <tbody>

                                                ${requests.map(
                                                    request => `

                                                        <tr>

                                                            <td>
                                                                ${escapeHTML(
                                                                    request.reference ||
                                                                    request.invoiceNumber ||
                                                                    request.id
                                                                )}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(
                                                                    request.clientName ||
                                                                    request.client?.name ||
                                                                    "Client"
                                                                )}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(
                                                                    request.purpose === "initial_assessment_consultation"
                                                                        ? "No journey assigned"
                                                                        : request.transactionTitle ||
                                                                            request.enquiryReference ||
                                                                            "Journey"
                                                                )}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(request.clientCode || "ID pending")}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(`${request.currency || "GHS"} ${Number(request.standardAmount ?? 1000).toFixed(2)}`)}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(`${request.currency || "GHS"} ${Number(request.discountAmount ?? 0).toFixed(2)}`)}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(
                                                                    `${request.currency || "EUR"} ${Number(
                                                                        request.amount ||
                                                                        request.total ||
                                                                        0
                                                                    ).toFixed(2)}`
                                                                )}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(`${request.status || "Requested"} / ${request.verificationStatus || "not_verified"}`)}
                                                            </td>

                                                            <td>

                                                                <button
                                                                    type="button"
                                                                    class="button button-primary"
                                                                    data-finance-verify="${escapeHTML(
                                                                        request.id
                                                                    )}"
                                                                >
                                                                    Verify
                                                                </button>

                                                            </td>

                                                        </tr>

                                                    `
                                                ).join("")}

                                            </tbody>

                                        </table>

                                    </div>

                                </div>
                            `
                            : `
                                <div class="empty-state">

                                    <h3>
                                        No payments awaiting verification
                                    </h3>

                                    <p>
                                        Verified payment requests will move to the payment history.
                                    </p>

                                </div>
                            `
                    }

                </div>

            `;


            container
                .querySelectorAll(
                    "[data-finance-verify]"
                )
                .forEach(
                    button => {

                        button.addEventListener(
                            "click",
                            function () {

                                const requestId =
                                    button.dataset
                                        .financeVerify;
                                const selectedRequest = requests.find(request => request.id === requestId);

                                if (
                                    window
                                        .LORDBLESS_PAYMENT_VERIFICATION &&
                                    typeof window
                                        .LORDBLESS_PAYMENT_VERIFICATION
                                        .render ===
                                        "function"
                                ) {

                                    window
                                        .LORDBLESS_PAYMENT_VERIFICATION
                                        .render(
                                            container,
                                            selectedRequest?.databaseAssessment
                                                ? selectedRequest
                                                : requestId,
                                            {
                                                onClose:
                                                    function () {
                                                        LORDBLESS_ASSESSMENT_FINANCE_LOADED = false;
                                                        LORDBLESS_ASSESSMENT_FINANCE_LOADED_AT = 0;
                                                        LORDBLESS_ASSESSMENT_FINANCE_REQUESTS = [];
                                                        renderFinanceView(
                                                            "verification"
                                                        );
                                                    }
                                            }
                                        );

                                }

                            }
                        );

                    }
                );

            break;

        }


        /* =====================================
           RECEIPTS
        ===================================== */

        case "receipts": {

            loadAdminAssessmentFinanceRequests();

            const requests =
                getFinancePaymentRequests()
                    .filter(
                        request =>
                            request &&
                            request.verificationStatus ===
                                "verified" &&
                            !request.receiptId
                    );

            const assessmentReceipts = LORDBLESS_ASSESSMENT_FINANCE_REQUESTS
                .filter(request => request.receipt_number && request.verificationStatus === "verified");


            container.innerHTML = `

                <div class="finance-view">

                    <div class="section-header">

                        <div>

                            <p class="section-eyebrow">
                                FINANCE RECEIPTS
                            </p>

                            <h2>
                                Receipts
                            </h2>

                            <p class="section-description">
                                Issue official receipts for verified payments.
                            </p>

                        </div>

                    </div>


                    ${
                        requests.length
                            ? `
                                <div class="finance-content-card">

                                    <div class="lbc-finance-client-table-wrap">

                                        <table class="lbc-finance-client-table">

                                            <thead>

                                                <tr>
                                                    <th>Reference</th>
                                                    <th>Client</th>
                                                    <th>Amount</th>
                                                    <th>Verified</th>
                                                    <th>Action</th>
                                                </tr>

                                            </thead>

                                            <tbody>

                                                ${requests.map(
                                                    request => `

                                                        <tr>

                                                            <td>
                                                                ${escapeHTML(
                                                                    request.reference ||
                                                                    request.id
                                                                )}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(
                                                                    request.clientName ||
                                                                    "Client"
                                                                )}
                                                            </td>

                                                            <td>
                                                                ${escapeHTML(
                                                                    `${request.currency || "EUR"} ${Number(
                                                                        request.amount || 0
                                                                    ).toFixed(2)}`
                                                                )}
                                                            </td>

                                                            <td>
                                                                Verified
                                                            </td>

                                                            <td>

                                                                <button
                                                                    type="button"
                                                                    class="button button-primary"
                                                                    data-finance-receipt="${escapeHTML(
                                                                        request.id
                                                                    )}"
                                                                >
                                                                    Issue Receipt
                                                                </button>

                                                            </td>

                                                        </tr>

                                                    `
                                                ).join("")}

                                            </tbody>

                                        </table>

                                    </div>

                                </div>
                            `
                            : `
                                <div class="empty-state">

                                    <h3>
                                        No receipts awaiting issuance
                                    </h3>

                                    <p>
                                        Receipts become available after Finance verification.
                                    </p>

                                </div>
                            `
                    }

                    ${assessmentReceipts.length ? `
                        <section class="finance-content-card" aria-labelledby="assessment-receipts-heading">
                            <div class="section-header">
                                <div>
                                    <p class="section-eyebrow">DATABASE-BACKED RECEIPTS</p>
                                    <h3 id="assessment-receipts-heading">Initial Assessment receipts</h3>
                                    <p class="section-description">Receipts are issued atomically after Finance verifies the payment.</p>
                                </div>
                            </div>
                            <div class="lbc-finance-client-table-wrap">
                                <table class="lbc-finance-client-table">
                                    <thead><tr><th>Receipt</th><th>Payment request</th><th>Client</th><th>Standard fee</th><th>Discount</th><th>Amount paid</th><th>Verified by</th><th>Action</th></tr></thead>
                                    <tbody>${assessmentReceipts.map(request => `
                                        <tr>
                                            <td>${escapeHTML(request.receipt_number)}</td>
                                            <td>${escapeHTML(request.reference)}</td>
                                            <td>${escapeHTML(request.clientName)}<br><small>${escapeHTML(request.clientCode || "ID pending")}</small></td>
                                            <td>GHS ${Number(request.standardAmount ?? 1000).toFixed(2)}</td>
                                            <td>GHS ${Number(request.discountAmount ?? 0).toFixed(2)}</td>
                                            <td>GHS ${Number(request.amount_received ?? request.amount).toFixed(2)}</td>
                                            <td>${escapeHTML(request.verifiedByName || "Finance")}</td>
                                            <td><button type="button" class="button button-secondary" data-assessment-receipt-view="${escapeHTML(request.id)}">View receipt</button></td>
                                        </tr>
                                    `).join("")}</tbody>
                                </table>
                            </div>
                        </section>
                    ` : ""}

                </div>

            `;


            container
                .querySelectorAll(
                    "[data-finance-receipt]"
                )
                .forEach(
                    button => {

                        button.addEventListener(
                            "click",
                            function () {

                                const requestId =
                                    button.dataset
                                        .financeReceipt;

                                if (
                                    window
                                        .LORDBLESS_RECEIPT_GENERATOR &&
                                    typeof window
                                        .LORDBLESS_RECEIPT_GENERATOR
                                        .render ===
                                        "function"
                                ) {

                                    window
                                        .LORDBLESS_RECEIPT_GENERATOR
                                        .render(
                                            container,
                                            requestId,
                                            {
                                                onIssued:
                                                    function () {
                                                        renderFinanceView(
                                                            "receipts"
                                                        );
                                                    },

                                                onClose:
                                                    function () {
                                                        renderFinanceView(
                                                            "receipts"
                                                        );
                                                    }
                                            }
                                        );

                                }

                            }
                        );

                    }
                );

            container.querySelectorAll("[data-assessment-receipt-view]").forEach(button => {
                button.addEventListener("click", () => {
                    const request = assessmentReceipts.find(item => item.id === button.dataset.assessmentReceiptView);
                    if (!request || !window.LORDBLESS_RECEIPT_GENERATOR?.preview) return;

                    const receipt = {
                        id: request.receipt_number,
                        receiptNumber: request.receipt_number,
                        status: "issued",
                        paymentRequestId: request.id,
                        paymentRequestReference: request.reference,
                        clientId: request.clientCode || "ID pending",
                        clientName: request.clientName,
                        transactionTitle: "Initial Assessment & 30-Minute Consultation",
                        description: "Initial Assessment & 30-Minute Consultation",
                        amount: Number(request.amount_received ?? request.amount),
                        standardAmount: request.standardAmount,
                        discountAmount: request.discountAmount,
                        currency: "GHS",
                        paymentDate: request.payment_date,
                        paymentMethod: "Mobile Money",
                        paymentReference: request.transaction_reference,
                        issuedAt: request.receipt_issued_at,
                        verifiedAt: request.verified_at,
                        verifiedByName: request.verifiedByName
                    };
                    const overlay = document.createElement("div");
                    overlay.className = "lbc-assessment-receipt-preview";
                    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(10,20,35,.72);display:grid;place-items:center;padding:20px;";
                    overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Official payment receipt" style="background:#fff;max-width:900px;width:100%;max-height:92vh;overflow:auto;padding:24px;border-radius:12px"><button type="button" data-close-assessment-receipt style="float:right">Close</button><div data-assessment-receipt-content></div></div>`;
                    document.body.appendChild(overlay);
                    window.LORDBLESS_RECEIPT_GENERATOR.preview(
                        overlay.querySelector("[data-assessment-receipt-content]"),
                        receipt
                    );
                    overlay.querySelector("[data-close-assessment-receipt]").addEventListener("click", () => overlay.remove());
                    overlay.addEventListener("click", event => {
                        if (event.target === overlay) overlay.remove();
                    });
                });
            });

            break;

        }


        /* =====================================
           REPORTS
        ===================================== */

        case "reports":

            loadAdminAssessmentFinanceRequests();

            if (
                window.LORDBLESS_PAYMENT_HISTORY &&
                typeof window
                    .LORDBLESS_PAYMENT_HISTORY
                    .renderForAdmin ===
                    "function"
            ) {

                window.LORDBLESS_PAYMENT_HISTORY
                    .renderForAdmin(
                        container,
                        {}
                    );

            } else {

                container.innerHTML = `

                    <div class="empty-state">

                        <h3>
                            Financial Reports
                        </h3>

                        <p>
                            Payment History could not be loaded.
                        </p>

                    </div>

                `;

            }

            break;


        default:

            renderFinanceView(
                "overview"
            );

    }

}

/* =========================================
   VIEW ROUTER
========================================= */

function renderView(
    view
) {

    if (
        !state.authReady ||
        !state.authUser ||
        !state.adminIdentity
    ) {
        showAdminAuthGate(
            state.authError
        );
        return;
    }

    state.currentView =
        view;

    const requiredPermission =
        ADMIN_VIEW_PERMISSIONS[view];

    if (
        requiredPermission &&
        !hasPermission(
            getCurrentUser(),
            requiredPermission
        )
    ) {
        view = getFirstPermittedAdminView(
            getCurrentUser(),
            ""
        );

        if (!view) {
            state.currentView = "";
            if (appContent) {
                appContent.innerHTML = `
                    <section class="section">
                        <div class="section-header">
                            <div>
                                <h2>No Admin modules assigned</h2>
                                <p class="section-subtitle">Contact an Overall Admin to request the permissions required for your work.</p>
                            </div>
                        </div>
                    </section>
                `;
            }
            return;
        }

        state.currentView = view;
    }


    const titles = {

        dashboard:
            "Dashboard",

        enquiries:
            "Enquiries",

        clients:
            "Clients",

        followups:
            "Follow-ups",

                documents:
            "Documents",

        finance:
            "Finance",

        payments:
            "Payments",

        assessments:
            "Assessments",

        stories:
            "Stories",

        team:
            "Team & Access",

        settings:
            "Settings"

    };


    pageTitle.textContent =
        titles[view] ||
        "Dashboard";


    setActiveNavigation(
        view
    );


    switch (view) {

        case "dashboard":

            renderDashboard();

            break;


        case "enquiries":

            renderEnquiries();

            break;


        case "clients":

            renderAdminClients();

            break;


        case "followups":

            renderPlaceholder(
                "Follow-ups",
                "Follow-up management will appear here."
            );

            break;


        
        case "documents":

            renderAdminDocuments();

            break;

        case "finance":

            renderFinanceWorkspace();

            break;


        case "assessments":

            renderPlaceholder(
                "Assessments",
                "Client assessments will appear here."
            );

            break;

case "assessments":

            renderPlaceholder(
                "Assessments",
                "Client assessments will appear here."
            );

            break;


        case "stories":

            renderPlaceholder(
                "Stories",
                "LORDBLESS Stories management will appear here."
            );

            break;


        case "team":

            renderTeamAccess();

            break;


        case "settings":

            renderPlaceholder(
                "Settings",
                "Portal settings will appear here."
            );

            break;


        default:

            renderDashboard();

    }

}

/* =========================================================
   LORDBLESS ADMIN — CLIENTS WORKSPACE
   MOCK / FRONTEND STAGE

   PRINCIPLE:
   One client collection. Other modules read from it.
   Do not create duplicate client datasets.
========================================================= */


const LORDBLESS_ADMIN_CLIENT_STATE = {

    search: "",

    statusFilter: "all"

};


/* =========================================================
   CLIENT DATA HELPERS
========================================================= */

function getAdminClients() {

    if (
        typeof LORDBLESS_ADMIN_DOCUMENT_DATA === "undefined"
    ) {
        return [];
    }


    const fixtureClients =
        Array.isArray(
            LORDBLESS_ADMIN_DOCUMENT_DATA.clients
        )
            ? LORDBLESS_ADMIN_DOCUMENT_DATA.clients
            : [];

    const enquiryClients = state.enquiries
        .map(enquiry => enquiry.client)
        .filter(client => client?.id)
        .map(client => ({
            ...client,
            clientCode: client.clientCode || client.client_code || "",
            name: client.name || client.fullName || "Client",
            fullName: client.fullName || client.name || "Client"
        }));

    const clients = [
        ...fixtureClients,
        ...enquiryClients.filter(client =>
            !fixtureClients.some(fixture => fixture.id === client.id)
        )
    ];

    return clients.filter(
        client =>
            canCurrentAdminAccessClient(
                client.id
            )
    );

}


function getAdminClientDisplayId(client) {
    const permanentId = client?.clientCode || client?.client_code;
    if (permanentId) return permanentId;

    const internalId = String(client?.id || "").trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(internalId);

    return isUuid ? "ID pending" : internalId || "ID pending";
}


/* =========================================================
   DESK ACCESS BOUNDARY

   This UI filter preserves prototype journey fixtures.
   Persistent journey rows are scoped by Supabase RLS using
   client access or their optional internal staff/desk assignment.
========================================================= */

function getCurrentAdminDesk() {

    const user =
        getCurrentUser();

    return user
        ? user.desk || null
        : null;

}


function currentAdminHasAllDeskAccess() {

    const user =
        getCurrentUser();

    if (!user) {
        return false;
    }

    if (user.isOverallAdmin === true) {
        return true;
    }

    const role =
        String(user.role || "")
            .toLowerCase();

    const desk =
        String(user.desk || "")
            .toLowerCase();

    return (
        desk === "all" ||
        desk === "all_desks" ||
        desk === "all-desks" ||
        role === "super_admin" ||
        role === "super admin"
    );

}


function getJourneyDeskId(
    journey
) {

    if (!journey) {
        return "unassigned";
    }

    /* Future journey records should carry desk directly. */

    if (journey.desk) {
        return journey.desk;
    }

    if (journey.deskId) {
        return journey.deskId;
    }

    const destination =
        String(journey.destination || "")
            .trim()
            .toLowerCase();

    if (
        destination === "canada" ||
        destination === "usa" ||
        destination === "us" ||
        destination === "united states" ||
        destination === "united states of america"
    ) {
        return "canada";
    }

    if (destination === "china") {
        return "china";
    }

    const europeDestinations = [
        "germany",
        "france",
        "united kingdom",
        "uk",
        "ireland",
        "netherlands",
        "belgium",
        "austria",
        "switzerland",
        "italy",
        "spain",
        "portugal",
        "poland",
        "sweden",
        "norway",
        "denmark",
        "finland",
        "europe"
    ];

    if (
        europeDestinations.includes(
            destination
        )
    ) {
        return "germany_europe";
    }

    return "unassigned";

}


function canCurrentAdminAccessJourney(
    journey
) {

    if (!journey) {
        return false;
    }

    if (currentAdminHasAllDeskAccess()) {
        return true;
    }

    if (journey.isSupabase === true) {
        // These rows have already been scoped by the database RLS policy.
        return true;
    }

    const user = getCurrentUser();
    if (journey.internalAssigneeId === user?.id) {
        return true;
    }

    const allowedDesks = Array.isArray(user?.deskIds)
        ? user.deskIds
        : [getCurrentAdminDesk()].filter(Boolean);

    return allowedDesks.includes(
        getJourneyDeskId(journey)
    );

}


function mapSupabaseJourney(record) {

    const assignedDesk =
        state.adminIdentity?.desks?.find(
            desk => desk.id === record.desk_id
        );

    return {
        id: record.id,
        clientId: record.client_id,
        enquiryId: record.enquiry_id || null,
        journeyType: record.journey_type || "",
        title: record.title || "",
        destination: record.destination || "",
        service: record.service || "",
        status: record.status || "planning",
        internalAssigneeId: record.internal_assignee_id || null,
        deskId: record.desk_id || null,
        desk: assignedDesk?.code || "",
        createdAt: record.created_at || "",
        updatedAt: record.updated_at || "",
        isSupabase: true
    };

}


async function loadAdminJourneys(clientId = null) {

    if (
        !state.adminIdentity ||
        !hasPermission(state.adminIdentity, "journeys.read")
    ) {
        return [];
    }

    const requestUserId = state.adminIdentity.id;

    let query = lordblessSupabase
        .from("client_journeys_internal_access")
        .select("*")
        .order("created_at", { ascending: true });

    if (clientId) {
        query = query.eq("client_id", clientId);
    }

    let result;
    try {
        result = await query;
    } catch (error) {
        if (state.adminIdentity?.id !== requestUserId) return [];
        state.journeyLoadError = error?.message || String(error);
        console.error("LORDBLESS ADMIN JOURNEYS SUPABASE ERROR:", error);
        return [];
    }

    const { data, error } = result;
    if (state.adminIdentity?.id !== requestUserId) return [];

    if (error) {
        state.journeyLoadError = error.message || String(error);
        console.error("LORDBLESS ADMIN JOURNEYS SUPABASE ERROR:", error);
        return [];
    }

    state.journeyLoadError = "";
    const mapped = (data || []).map(mapSupabaseJourney);

    if (clientId) {
        state.journeys = [
            ...state.journeys.filter(item => item.clientId !== clientId),
            ...mapped
        ];
    } else {
        state.journeys = mapped;
    }

    return mapped;

}


async function loadAdminJourneyAssignees() {

    if (
        !state.adminIdentity ||
        !hasPermission(state.adminIdentity, "journeys.write")
    ) {
        return [];
    }

    const requestUserId = state.adminIdentity.id;

    let result;
    try {
        result = await lordblessSupabase
            .from("staff_profiles")
            .select("user_id, display_name")
            .eq("active", true)
            .order("display_name", { ascending: true });
    } catch (error) {
        if (state.adminIdentity?.id !== requestUserId) return [];
        console.error("LORDBLESS JOURNEY ASSIGNEES SUPABASE ERROR:", error);
        return state.journeyAssignees;
    }

    const { data, error } = result;
    if (state.adminIdentity?.id !== requestUserId) return [];

    if (error) {
        console.error("LORDBLESS JOURNEY ASSIGNEES SUPABASE ERROR:", error);
        return state.journeyAssignees;
    }

    state.journeyAssignees = data || [];
    return state.journeyAssignees;

}


function getAdminClientJourneys(
    clientId
) {

    if (
        typeof LORDBLESS_DOCUMENT_JOURNEYS === "undefined"
    ) {
        return [];
    }

    const journeys = [
        ...state.journeys,
        ...LORDBLESS_DOCUMENT_JOURNEYS
    ].filter((journey, index, collection) =>
        collection.findIndex(item => item.id === journey.id) === index
    );

    return journeys
        .filter(
            journey =>
                journey.clientId === clientId
        )
        .filter(
            canCurrentAdminAccessJourney
        );

}


function canCurrentAdminAccessClient(
    clientId
) {

    if (currentAdminHasAllDeskAccess()) {
        return true;
    }

    return (
        getAdminClientJourneys(clientId).length > 0
    );

}


function getAdminClientJourney(
    clientId
) {

    return (
        getAdminClientJourneys(clientId)[0]
        || null
    );

}


function getAdminClientDocuments(
    clientId
) {

    if (
        typeof LORDBLESS_ADMIN_DOCUMENT_DATA === "undefined"
    ) {
        return [];
    }

    const visibleJourneys =
        getAdminClientJourneys(clientId);

    const visibleJourneyIds =
        new Set(
            visibleJourneys.map(
                journey => journey.id
            )
        );

    return LORDBLESS_ADMIN_DOCUMENT_DATA.documents
        .filter(
            document =>
                document.clientId === clientId
        )
        .filter(
            document => {

                if (currentAdminHasAllDeskAccess()) {
                    return true;
                }

                if (document.transactionId) {
                    return visibleJourneyIds.has(
                        document.transactionId
                    );
                }

                /* Client-level documents are reusable account assets. */
                return canCurrentAdminAccessClient(
                    clientId
                );

            }
        );

}


function getAdminClientStatus(
    clientId
) {

    const journey =
        getAdminClientJourney(
            clientId
        );


    if (!journey) {

        return {
            value: "inactive",
            label: "No Active Journey"
        };

    }


    return {
        value: "active",
        label: "Active"
    };

}


/* =========================================================
   CLIENT FILTERING
========================================================= */

function getFilteredAdminClients() {

    const clients =
        getAdminClients();

    const search =
        LORDBLESS_ADMIN_CLIENT_STATE.search
            .trim()
            .toLowerCase();

    const statusFilter =
        LORDBLESS_ADMIN_CLIENT_STATE.statusFilter;


    return clients.filter(
        client => {

            const journey =
                getAdminClientJourney(
                    client.id
                );

            const status =
                getAdminClientStatus(
                    client.id
                );


            const searchableText = [

                client.id,
                client.name,
                client.fullName,
                client.email,

                journey
                    ? journey.id
                    : "",

                journey
                    ? journey.title
                    : "",

                journey
                    ? journey.destination
                    : "",

                journey
                    ? journey.service
                    : ""

            ]
                .join(" ")
                .toLowerCase();


            const matchesSearch =
                !search ||
                searchableText.includes(
                    search
                );


            const matchesStatus =
                statusFilter === "all" ||
                status.value === statusFilter;


            return (
                matchesSearch &&
                matchesStatus
            );

        }
    );

}


/* =========================================================
   CLIENTS PAGE
========================================================= */

function renderAdminClients() {

    const clients =
        getFilteredAdminClients();

    const allClients =
        getAdminClients();


    appContent.innerHTML = `

        <section class="admin-section lbc-clients-page">

            <div class="section-header">

                <div>

                    <p class="section-eyebrow">
                        CLIENT MANAGEMENT
                    </p>

                    <h2>
                        Clients
                    </h2>

                    <p class="section-description">
                        View and manage LORDBLESS client accounts.
                    </p>

                </div>

                <div class="lbc-clients-count">
                    ${clients.length} of ${allClients.length} clients
                </div>

            </div>


            <div class="lbc-client-toolbar">

                <div class="lbc-client-search">

                    <input
                        type="search"
                        id="admin-client-search"
                        placeholder="Search clients..."
                        value="${escapeHTML(
                            LORDBLESS_ADMIN_CLIENT_STATE.search
                        )}"
                        autocomplete="off"
                        aria-label="Search clients"
                    >

                </div>


                <div class="lbc-client-filter">

                    <select
                        id="admin-client-status-filter"
                        aria-label="Filter clients by status"
                    >

                        <option
                            value="all"
                            ${
                                LORDBLESS_ADMIN_CLIENT_STATE.statusFilter === "all"
                                    ? "selected"
                                    : ""
                            }
                        >
                            All clients
                        </option>

                        <option
                            value="active"
                            ${
                                LORDBLESS_ADMIN_CLIENT_STATE.statusFilter === "active"
                                    ? "selected"
                                    : ""
                            }
                        >
                            Active
                        </option>

                        <option
                            value="inactive"
                            ${
                                LORDBLESS_ADMIN_CLIENT_STATE.statusFilter === "inactive"
                                    ? "selected"
                                    : ""
                            }
                        >
                            No active journey
                        </option>

                    </select>

                </div>

            </div>


            <div class="lbc-client-list">

                ${
                    clients.length
                        ? clients
                            .map(
                                renderAdminClientRow
                            )
                            .join("")
                        : `
                            <div class="lbc-client-empty">

                                <h3>
                                    No clients found
                                </h3>

                                <p>
                                    Try a different search or filter.
                                </p>

                            </div>
                        `
                }

            </div>

        </section>

    `;


    setupAdminClientEvents();

}


/* =========================================================
   CLIENT ROW
========================================================= */

function renderAdminClientRow(
    client
) {

    const journey =
        getAdminClientJourney(
            client.id
        );

    const documents =
        getAdminClientDocuments(
            client.id
        );

    const status =
        getAdminClientStatus(
            client.id
        );

    const clientName =
        client.name ||
        client.fullName ||
        "Unnamed Client";


    return `

        <article
            class="lbc-client-row"
            data-client-id="${escapeHTML(client.id)}"
        >

            <div class="lbc-client-primary">

                <div class="lbc-client-avatar">
                    ${escapeHTML(
                        clientName
                            .charAt(0)
                            .toUpperCase()
                    )}
                </div>


                <div>

                    <h3 class="lbc-client-name">
                        ${escapeHTML(clientName)}
                    </h3>

                    <div class="lbc-client-id">
                        ${escapeHTML(getAdminClientDisplayId(client))}
                    </div>

                </div>

            </div>


            <div class="lbc-client-detail">

                <span class="lbc-client-label">
                    Email
                </span>

                <span>
                    ${escapeHTML(client.email || "—")}
                </span>

            </div>


            <div class="lbc-client-detail">

                <span class="lbc-client-label">
                    Journey
                </span>

                <span>
                    ${
                        journey
                            ? escapeHTML(journey.title)
                            : "—"
                    }
                </span>

            </div>


            <div class="lbc-client-detail">

                <span class="lbc-client-label">
                    Documents
                </span>

                <span>
                    ${documents.length}
                </span>

            </div>


            <div class="lbc-client-status">

                <span
                    class="lbc-client-status-badge ${status.value}"
                >
                    ${escapeHTML(status.label)}
                </span>

            </div>


            <div class="lbc-client-action">

                <button
                    type="button"
                    class="lbc-client-view-btn"
                    data-client-id="${escapeHTML(client.id)}"
                >
                    View Client
                </button>

            </div>

        </article>

    `;

}


/* =========================================================
   CLIENT EVENTS
========================================================= */

function setupAdminClientEvents() {

    const searchInput =
        document.getElementById(
            "admin-client-search"
        );

    const statusFilter =
        document.getElementById(
            "admin-client-status-filter"
        );


    if (searchInput) {

        searchInput.addEventListener(
            "input",
            event => {

                LORDBLESS_ADMIN_CLIENT_STATE.search =
                    event.target.value;

                renderAdminClients();

            }
        );

    }


    if (statusFilter) {

        statusFilter.addEventListener(
            "change",
            event => {

                LORDBLESS_ADMIN_CLIENT_STATE.statusFilter =
                    event.target.value;

                renderAdminClients();

            }
        );

    }


    document
        .querySelectorAll(
            ".lbc-client-view-btn"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        openAdminClient(
                            button.dataset.clientId
                        );

                    }
                );

            }
        );

}


/* =========================================================
   CLIENT SUMMARY
========================================================= */

function openAdminClient(
    clientId
) {

    const client =
        getAdminClients().find(
            item =>
                item.id === clientId
        );

    if (!client) {
        return;
    }


    const journeys =
        getAdminClientJourneys(
            client.id
        );


    const documents =
        getAdminClientDocuments(
            client.id
        );


    const modal =
        document.getElementById(
            "enquiry-modal"
        );


    const modalBody =
        document.getElementById(
            "modal-content"
        );


    if (!modal || !modalBody) {
        return;
    }


    const accessLabel =
        currentAdminHasAllDeskAccess()
            ? "All Desks"
            : (
                typeof getDeskLabel === "function"
                    ? getDeskLabel(
                        getCurrentAdminDesk()
                    )
                    : getCurrentAdminDesk() ||
                      "Assigned Desk"
            );


    /*
     * Use the dedicated client-details component when it is available.
     * The fallback keeps the current Admin Portal functional even when
     * that optional component has not yet been added to index.html.
     */

    if (
        typeof window.LORDBLESS_CLIENT_DETAILS !== "undefined" &&
        typeof window.LORDBLESS_CLIENT_DETAILS.render === "function"
    ) {

        window.LORDBLESS_CLIENT_DETAILS.render(
            modalBody,
            {
                client,
                journeys,
                documents,
                accessLabel,
                initialTab: "documents",

                onOpenDocuments: targetClientId => {

                    modal.classList.add(
                        "hidden"
                    );

                    filterAdminDocumentsToClient(
                        targetClientId
                    );

                }
            }
        );

    } else {

        renderAdminClientDocumentDetails(
            modalBody,
            client,
            journeys,
            documents,
            accessLabel
        );

    }


    modal.classList.remove(
        "hidden"
    );

}


/* =========================================================
   CLIENT DOCUMENT DETAILS FALLBACK

   Keeps the Admin Documents workflow usable without requiring
   another file to be loaded. The dedicated clientDetails component
   can replace this automatically when available.
========================================================= */

function renderAdminClientDocumentDetails(
    container,
    client,
    journeys,
    documents,
    accessLabel
) {

    const clientRequests =
        LORDBLESS_ADMIN_DOCUMENT_DATA.requests
            .filter(
                request =>
                    request.clientId === client.id &&
                    canCurrentAdminAccessDocumentRequest(request)
            );

    const reviewDocuments =
        documents.filter(
            document =>
                document.status === "reviewing"
        );

    const approvedDocuments =
        documents.filter(
            document =>
                document.status === "approved"
        );

    const attentionDocuments =
        documents.filter(
            getAdminDocumentAttention
        );

    container.innerHTML = `

        <div class="lbc-client-document-details">

            <div class="lbc-client-document-header">

                <div>
                    <p class="portal-eyebrow">CLIENT DOCUMENTS</p>
                    <h2>${escapeHTML(client.name || client.fullName || "Client")}</h2>
                    <p>${escapeHTML(client.id)} · ${escapeHTML(accessLabel)}</p>
                </div>

                <button
                    type="button"
                    class="lbc-document-btn lbc-document-btn-secondary"
                    data-client-details-close="true"
                >
                    Close
                </button>

            </div>

            <div class="lbc-client-document-meta">

                <span>Email <strong>${escapeHTML(client.email || "—")}</strong></span>
                <span>Journeys <strong>${journeys.length}</strong></span>
                <span>Documents <strong>${documents.length}</strong></span>

            </div>

            <section class="lbc-client-document-section">
                <div class="lbc-client-document-section-header">
                    <div>
                        <h3>Journeys</h3>
                        <p>Documents are retained at client level and linked to the relevant journey when applicable.</p>
                    </div>
                </div>

                <div class="lbc-client-document-journeys">
                    ${
                        journeys.length
                            ? journeys.map(journey => `
                                <article class="lbc-client-document-journey">
                                    <strong>${escapeHTML(journey.title || "Journey")}</strong>
                                    <span>${escapeHTML(journey.id)}</span>
                                    <span>${escapeHTML(journey.destination || "—")}</span>
                                    <span>${escapeHTML(getJourneyDeskId(journey))}</span>
                                </article>
                            `).join("")
                            : `<div class="lbc-document-empty"><h4>No journeys</h4><p>No accessible journey is currently assigned to this client.</p></div>`
                    }
                </div>
            </section>

            ${renderAdminClientDocumentSection(
                "Pending Review",
                reviewDocuments,
                "These documents were uploaded and are waiting for administrative review."
            )}

            ${renderAdminClientDocumentSection(
                "Approved / Reusable",
                approvedDocuments,
                "Approved documents remain available in the client's permanent library."
            )}

            ${renderAdminClientDocumentSection(
                "Attention",
                attentionDocuments,
                "These documents require attention because of rejection or expiry timing."
            )}

            <section class="lbc-client-document-section">
                <div class="lbc-client-document-section-header">
                    <div>
                        <h3>Document Requests</h3>
                        <p>Requests created by Admin for this client's journeys.</p>
                    </div>
                </div>

                ${
                    clientRequests.length
                        ? `<div class="lbc-client-document-requests">${clientRequests.map(renderAdminClientRequestSummary).join("")}</div>`
                        : `<div class="lbc-document-empty"><h4>No outstanding requests</h4><p>No document request is currently recorded for this client.</p></div>`
                }
            </section>

        </div>

    `;

    container
        .querySelector("[data-client-details-close]")
        ?.addEventListener(
            "click",
            closeEnquiryModal
        );

    container
        .querySelectorAll("[data-admin-document-review]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    openAdminDocumentReview(
                        button.dataset.adminDocumentReview
                    );
                }
            );
        });

}


function renderAdminClientDocumentSection(
    title,
    documents,
    description
) {

    return `

        <section class="lbc-client-document-section">

            <div class="lbc-client-document-section-header">
                <div>
                    <h3>${escapeHTML(title)}</h3>
                    <p>${escapeHTML(description)}</p>
                </div>
                <span>${documents.length}</span>
            </div>

            ${
                documents.length
                    ? `<div class="lbc-client-document-list">${documents.map(document => `
                        <article class="lbc-client-document-item">
                            <div>
                                <strong>${escapeHTML(document.name)}</strong>
                                <span>${escapeHTML(document.type || "Document")} · v${escapeHTML(document.version || 1)}</span>
                                ${document.transactionTitle ? `<span>${escapeHTML(document.transactionTitle)}</span>` : ""}
                            </div>
                            <div class="lbc-client-document-item-side">
                                <span class="lbc-document-status status-${escapeHTML(document.status)}">${escapeHTML(formatAdminDocumentStatus(document.status))}</span>
                                ${document.expiryDate ? `<span>${escapeHTML(getAdminDocumentValidityStatus(document).label)}</span>` : ""}
                                <button type="button" class="lbc-document-btn lbc-document-btn-secondary" data-admin-document-review="${escapeHTML(document.id)}">Review</button>
                            </div>
                        </article>
                    `).join("")}</div>`
                    : `<div class="lbc-document-empty"><h4>None</h4><p>No documents are currently in this section.</p></div>`
            }

        </section>

    `;

}


function renderAdminClientRequestSummary(
    request
) {

    return `
        <article class="lbc-client-document-request">
            <div>
                <strong>${escapeHTML((request.documentNames || []).join(", "))}</strong>
                <span>${escapeHTML(request.transactionTitle || "Journey not specified")}</span>
                <span>Deadline: ${escapeHTML(formatDate(request.deadline))}</span>
            </div>
            <span class="lbc-document-status status-requested">${escapeHTML(request.status || "requested")}</span>
        </article>
    `;

}


/* =========================================================
   DOCUMENT WORKSPACE STATE
========================================================= */

const LORDBLESS_ADMIN_DOCUMENT_STATE = {

    search: "",

    clientFilter: "all",

    statusFilter: "all",

    journeyFilter: "all"

};


/* =========================================================
   LORDBLESS ADMIN — MULTI-CLIENT DOCUMENT WORKSPACE
   MOCK / FRONTEND STAGE
========================================================= */


/* =========================================================
   MULTI-CLIENT MOCK DATA
========================================================= */

const LORDBLESS_ADMIN_DOCUMENT_DATA = {

    clients: [
        {
            id: "LBC-CLIENT-0001",
            name: "KWAME MENSAH",
            email: "kwame@example.com",
            fullName: "KWAME MENSAH"
        },
        {
            id: "LBC-CLIENT-0002",
            name: "AMA BOATENG",
            email: "ama@example.com",
            fullName: "AMA BOATENG"
        },
        {
            id: "LBC-CLIENT-0003",
            name: "JOHN SMITH",
            email: "john@example.com",
            fullName: "JOHN SMITH"
        },
        {
            id: "LBC-CLIENT-0004",
            name: "ABENA MENSAH",
            email: "abena@example.com",
            fullName: "ABENA MENSAH"
        },
        {
            id: "LBC-CLIENT-0005",
            name: "DANIEL OWUSU",
            email: "daniel@example.com",
            fullName: "DANIEL OWUSU"
        },
        {
            id: "LBC-CLIENT-0006",
            name: "AKOSUA ADJEI",
            email: "akosua@example.com",
            fullName: "AKOSUA ADJEI"
        },
        {
            id: "LBC-CLIENT-0007",
            name: "MICHAEL ASANTE",
            email: "michael@example.com",
            fullName: "MICHAEL ASANTE"
        },
        {
            id: "LBC-CLIENT-0008",
            name: "GRACE OSEI",
            email: "grace@example.com",
            fullName: "GRACE OSEI"
        },
        {
            id: "LBC-CLIENT-0009",
            name: "SAMUEL FRIMPONG",
            email: "samuel@example.com",
            fullName: "SAMUEL FRIMPONG"
        },
        {
            id: "LBC-CLIENT-0010",
            name: "ESTHER BOATENG",
            email: "esther@example.com",
            fullName: "ESTHER BOATENG"
        },
        {
            id: "LBC-CLIENT-0011",
            name: "PATRICK ADU",
            email: "patrick@example.com",
            fullName: "PATRICK ADU"
        },
        {
            id: "LBC-CLIENT-0012",
            name: "RACHEL ASAMOAH",
            email: "rachel@example.com",
            fullName: "RACHEL ASAMOAH"
        },
        {
            id: "LBC-CLIENT-0013",
            name: "ERIC OPOKU",
            email: "eric@example.com",
            fullName: "ERIC OPOKU"
        },
        {
            id: "LBC-CLIENT-0014",
            name: "FELICIA ARTHUR",
            email: "felicia@example.com",
            fullName: "FELICIA ARTHUR"
        },
        {
            id: "LBC-CLIENT-0015",
            name: "ISAAC KUMI",
            email: "isaac@example.com",
            fullName: "ISAAC KUMI"
        },
        {
            id: "LBC-CLIENT-0016",
            name: "LINDA YAAH",
            email: "linda@example.com",
            fullName: "LINDA YAAH"
        },
        {
            id: "LBC-CLIENT-0017",
            name: "BENJAMIN QUAYE",
            email: "benjamin@example.com",
            fullName: "BENJAMIN QUAYE"
        },
        {
            id: "LBC-CLIENT-0018",
            name: "JOYCE DARKO",
            email: "joyce@example.com",
            fullName: "JOYCE DARKO"
        },
        {
            id: "LBC-CLIENT-0019",
            name: "RICHARD AMPOFO",
            email: "richard@example.com",
            fullName: "RICHARD AMPOFO"
        },
        {
            id: "LBC-CLIENT-0020",
            name: "PRISCILLA ASANTE",
            email: "priscilla@example.com",
            fullName: "PRISCILLA ASANTE"
        }
    ],

    documents: [],

    requests: [],

    journeys: []

};


/* =========================================================
   JOURNEY DATA
========================================================= */

const LORDBLESS_DOCUMENT_JOURNEYS = [

    {
        id: "LBC-2026-00021",
        clientId: "LBC-CLIENT-0001",
        title: "Germany Career Journey",
        destination: "Germany",
        service: "LORDBLESS GLOBAL CAREERS"
    },

    {
        id: "LBC-2026-00022",
        clientId: "LBC-CLIENT-0002",
        title: "Germany Career Journey",
        destination: "Germany",
        service: "LORDBLESS GLOBAL CAREERS"
    },

    {
        id: "LBC-2026-00023",
        clientId: "LBC-CLIENT-0003",
        title: "China Business Trip",
        destination: "China",
        service: "LORDBLESS BUSINESS"
    },

    {
        id: "LBC-2026-00024",
        clientId: "LBC-CLIENT-0004",
        title: "UK Travel Journey",
        destination: "United Kingdom",
        service: "LORDBLESS TRAVEL"
    },

    {
        id: "LBC-2026-00025",
        clientId: "LBC-CLIENT-0005",
        title: "Germany Career Journey",
        destination: "Germany",
        service: "LORDBLESS GLOBAL CAREERS"
    },

    {
        id: "LBC-2026-00026",
        clientId: "LBC-CLIENT-0006",
        title: "Canada Career Journey",
        destination: "Canada",
        service: "LORDBLESS GLOBAL CAREERS"
    },

    {
        id: "LBC-2026-00027",
        clientId: "LBC-CLIENT-0007",
        title: "China Business Trip",
        destination: "China",
        service: "LORDBLESS BUSINESS"
    },

    {
        id: "LBC-2026-00028",
        clientId: "LBC-CLIENT-0008",
        title: "France Travel Journey",
        destination: "France",
        service: "LORDBLESS TRAVEL"
    },

    {
        id: "LBC-2026-00029",
        clientId: "LBC-CLIENT-0009",
        title: "Germany Career Journey",
        destination: "Germany",
        service: "LORDBLESS GLOBAL CAREERS"
    },

    {
        id: "LBC-2026-00030",
        clientId: "LBC-CLIENT-0010",
        title: "UK Travel Journey",
        destination: "United Kingdom",
        service: "LORDBLESS TRAVEL"
    }

];


/* =========================================================
   GENERATE MOCK DOCUMENTS
========================================================= */

function buildAdminDocument(
    id,
    clientId,
    type,
    name,
    filename,
    status,
    expiryDate = null
) {

    const client =
        LORDBLESS_ADMIN_DOCUMENT_DATA.clients.find(
            item =>
                item.id === clientId
        );

    const journey =
        LORDBLESS_DOCUMENT_JOURNEYS.find(
            item =>
                item.clientId === clientId
        );

    return {

        id,

        clientId,

        clientName:
            client
                ? client.name
                : "Unknown Client",

        type,

        name,

        filename,

        status,

        issueDate:
            type === "passport"
                ? "2021-12-16"
                : null,

        expiryDate,

        isCurrent: true,

        version: 1,

        transactionId:
            journey
                ? journey.id
                : null,

        transactionTitle:
            journey
                ? journey.title
                : null,

        uploadedAt:
            "2026-09-21",

        approvedAt:
            status === "approved"
                ? "2026-09-21"
                : null

    };

}


/* =========================================================
   BUILD REALISTIC MOCK DOCUMENT SET
========================================================= */

function initialiseAdminDocumentData() {

    if (
        LORDBLESS_ADMIN_DOCUMENT_DATA.documents.length
    ) {

        return;

    }

    const clients =
        LORDBLESS_ADMIN_DOCUMENT_DATA.clients;


    clients.forEach(
        (client, index) => {

            const number =
                String(index + 1)
                    .padStart(4, "0");


            const passportExpiry =
                index % 5 === 0
                    ? "2026-10-15"
                    : index % 5 === 1
                        ? "2027-01-20"
                        : "2028-04-12";


            /*
             * Passport
             */

            LORDBLESS_ADMIN_DOCUMENT_DATA.documents.push(

                buildAdminDocument(
                    `DOC-${number}-P`,
                    client.id,
                    "passport",
                    "International Passport",
                    `passport-${number}.pdf`,
                    index % 4 === 0
                        ? "approved"
                        : "approved",
                    passportExpiry
                )

            );


            /*
             * CV
             */

            LORDBLESS_ADMIN_DOCUMENT_DATA.documents.push(

                buildAdminDocument(
                    `DOC-${number}-C`,
                    client.id,
                    "cv",
                    "Curriculum Vitae",
                    `cv-${number}.pdf`,
                    "approved"
                )

            );


            /*
             * Third document varies by client.
             */

            const thirdDocuments = [

                [
                    "professional_certificate",
                    "Professional / Vocational Certificate"
                ],

                [
                    "academic_certificate",
                    "Academic Certificate / Degree"
                ],

                [
                    "academic_transcript",
                    "Academic Transcript"
                ],

                [
                    "employment_certificate",
                    "Employment Certificate / Experience Letter"
                ],

                [
                    "bank_statement",
                    "Bank Statement / Bank Letter"
                ]

            ];


            const selected =
                thirdDocuments[
                    index %
                    thirdDocuments.length
                ];


            const thirdStatus =
                index % 4 === 0
                    ? "reviewing"
                    : index % 4 === 1
                        ? "approved"
                        : index % 4 === 2
                            ? "approved"
                            : "rejected";


            LORDBLESS_ADMIN_DOCUMENT_DATA.documents.push(

                buildAdminDocument(
                    `DOC-${number}-3`,
                    client.id,
                    selected[0],
                    selected[1],
                    `${selected[0]}-${number}.pdf`,
                    thirdStatus
                )

            );


            /*
             * Fourth document for selected clients.
             */

            if (
                index % 2 === 0
            ) {

                LORDBLESS_ADMIN_DOCUMENT_DATA.documents.push(

                    buildAdminDocument(
                        `DOC-${number}-4`,
                        client.id,
                        "proof_of_address",
                        "Proof of Address",
                        `proof-of-address-${number}.pdf`,
                        index % 3 === 0
                            ? "reviewing"
                            : "approved"
                    )

                );

            }

        }
    );


    /*
     * Existing request-style records.
     */

    LORDBLESS_ADMIN_DOCUMENT_DATA.requests = [

        {
            id: "DOCREQ-0001",
            clientId: "LBC-CLIENT-0001",
            clientName: "KWAME MENSAH",
            transactionId: "LBC-2026-00021",
            transactionTitle: "Germany Career Journey",
            documentNames: [
                "Academic Certificate / Degree"
            ],
            status: "requested",
            deadline: "2026-09-30",
            message:
                "Please upload your academic certificate / degree for your Germany career journey."
        },

        {
            id: "DOCREQ-0002",
            clientId: "LBC-CLIENT-0004",
            clientName: "ABENA MENSAH",
            transactionId: "LBC-2026-00024",
            transactionTitle: "UK Travel Journey",
            documentNames: [
                "Bank Statement / Bank Letter",
                "Travel Insurance"
            ],
            status: "requested",
            deadline: "2026-09-28",
            message:
                "Please provide the requested financial and travel documents."
        },

        {
            id: "DOCREQ-0003",
            clientId: "LBC-CLIENT-0007",
            clientName: "MICHAEL ASANTE",
            transactionId: "LBC-2026-00027",
            transactionTitle: "China Business Trip",
            documentNames: [
                "Business Registration / Incorporation Document"
            ],
            status: "completed",
            deadline: "2026-09-18",
            message:
                "Business registration document received and approved."
        },

        {
            id: "DOCREQ-0004",
            clientId: "LBC-CLIENT-0010",
            clientName: "ESTHER BOATENG",
            transactionId: "LBC-2026-00030",
            transactionTitle: "UK Travel Journey",
            documentNames: [
                "Invitation Letter"
            ],
            status: "requested",
            deadline: "2026-10-02",
            message:
                "Please upload the invitation letter for your journey."
        }

    ];

}


function canCurrentAdminAccessDocument(
    document
) {

    if (!document) {
        return false;
    }

    if (currentAdminHasAllDeskAccess()) {
        return true;
    }

    if (document.transactionId) {

        const journey =
            typeof LORDBLESS_DOCUMENT_JOURNEYS !== "undefined"
                ? LORDBLESS_DOCUMENT_JOURNEYS.find(
                    item =>
                        item.id === document.transactionId
                )
                : null;

        return canCurrentAdminAccessJourney(
            journey
        );

    }

    /* Client-level documents are reusable account assets. */

    return canCurrentAdminAccessClient(
        document.clientId
    );

}


function canCurrentAdminAccessDocumentRequest(
    request
) {

    if (!request) {
        return false;
    }

    if (currentAdminHasAllDeskAccess()) {
        return true;
    }

    if (request.transactionId) {

        const journey =
            typeof LORDBLESS_DOCUMENT_JOURNEYS !== "undefined"
                ? LORDBLESS_DOCUMENT_JOURNEYS.find(
                    item =>
                        item.id === request.transactionId
                )
                : null;

        return canCurrentAdminAccessJourney(
            journey
        );

    }

    return canCurrentAdminAccessClient(
        request.clientId
    );

}


/* Public bridge for other admin components that need the same\n   desk boundary. There is deliberately one access policy. */

window.LORDBLESS_ADMIN_ACCESS = {

    getCurrentDesk:
        getCurrentAdminDesk,

    hasAllDeskAccess:
        currentAdminHasAllDeskAccess,

    getJourneyDesk:
        getJourneyDeskId,

    getJourneyDeskLabel:
        journey => {

            const deskId =
                getJourneyDeskId(journey);

            const labels = {
                canada_us:
                    "Canada & U.S. Desk",
                germany_europe:
                    "Germany & Europe Desk",
                china:
                    "China Desk",
                unassigned:
                    "Unassigned"
            };

            return labels[deskId] || deskId;

        },

    canAccessJourney:
        canCurrentAdminAccessJourney,

    canAccessClient:
        canCurrentAdminAccessClient,

    canAccessDocument:
        canCurrentAdminAccessDocument,

    canAccessDocumentRequest:
        canCurrentAdminAccessDocumentRequest,

    getVisibleClients:
        getAdminClients,

    getVisibleJourneys:
        getAdminClientJourneys,

    getVisibleDocuments:
        getAdminClientDocuments

};


/* =========================================================
   MAIN DOCUMENT VIEW
   LORDBLESS ADMIN — DOCUMENT WORKSPACE

   Permanent client document library + journey-aware requests.
   Frontend/mock stage. Supabase/RLS will become the real
   security boundary later.
========================================================= */

function getAdminDocumentWorkspaceData() {

    initialiseAdminDocumentData();

    const documents =
        Array.isArray(LORDBLESS_ADMIN_DOCUMENT_DATA.documents)
            ? LORDBLESS_ADMIN_DOCUMENT_DATA.documents.filter(
                canCurrentAdminAccessDocument
            )
            : [];

    const requests =
        Array.isArray(LORDBLESS_ADMIN_DOCUMENT_DATA.requests)
            ? LORDBLESS_ADMIN_DOCUMENT_DATA.requests.filter(
                canCurrentAdminAccessDocumentRequest
            )
            : [];

    const clients =
        Array.isArray(LORDBLESS_ADMIN_DOCUMENT_DATA.clients)
            ? LORDBLESS_ADMIN_DOCUMENT_DATA.clients.filter(
                client => canCurrentAdminAccessClient(client.id)
            )
            : [];

    return {
        documents,
        requests,
        clients
    };
}


function getFilteredAdminDocuments() {

    const data = getAdminDocumentWorkspaceData();

    const search =
        String(LORDBLESS_ADMIN_DOCUMENT_STATE.search || "")
            .trim()
            .toLowerCase();

    const clientFilter =
        LORDBLESS_ADMIN_DOCUMENT_STATE.clientFilter || "all";

    const statusFilter =
        LORDBLESS_ADMIN_DOCUMENT_STATE.statusFilter || "all";

    const journeyFilter =
        LORDBLESS_ADMIN_DOCUMENT_STATE.journeyFilter || "all";

    return data.documents.filter(document => {

        const searchable = [
            document.id,
            document.name,
            document.filename,
            document.clientName,
            document.clientId,
            document.transactionId,
            document.transactionTitle,
            document.type
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        const matchesSearch =
            !search || searchable.includes(search);

        const matchesClient =
            clientFilter === "all" ||
            document.clientId === clientFilter;

        const matchesStatus =
            statusFilter === "all" ||
            document.status === statusFilter;

        const matchesJourney =
            journeyFilter === "all" ||
            document.transactionId === journeyFilter;

        return (
            matchesSearch &&
            matchesClient &&
            matchesStatus &&
            matchesJourney
        );
    });
}


function renderAdminDocuments() {

    try {

        const data = getAdminDocumentWorkspaceData();

        const documents = getFilteredAdminDocuments();

        const reviewing =
            documents.filter(
                document => document.status === "reviewing"
            );

        const requested =
            data.requests.filter(
                request => request.status === "requested"
            );

        const approved =
            data.documents.filter(
                document => document.status === "approved"
            );

        const attention =
            data.documents.filter(
                getAdminDocumentAttention
            );

        const journeys =
            Array.isArray(LORDBLESS_DOCUMENT_JOURNEYS)
                ? LORDBLESS_DOCUMENT_JOURNEYS.filter(
                    canCurrentAdminAccessJourney
                )
                : [];

        const clientOptions = data.clients
            .map(client => `
                <option
                    value="${escapeHTML(client.id)}"
                    ${
                        LORDBLESS_ADMIN_DOCUMENT_STATE.clientFilter === client.id
                            ? "selected"
                            : ""
                    }
                >
                    ${escapeHTML(client.name || client.fullName || client.id)}
                </option>
            `)
            .join("");

        const journeyOptions = journeys
            .map(journey => `
                <option
                    value="${escapeHTML(journey.id)}"
                    ${
                        LORDBLESS_ADMIN_DOCUMENT_STATE.journeyFilter === journey.id
                            ? "selected"
                            : ""
                    }
                >
                    ${escapeHTML(journey.title || journey.id)}
                </option>
            `)
            .join("");

        appContent.innerHTML = `

            <div class="lbc-document-workspace">

                <div class="lbc-document-header">

                    <div class="lbc-document-header-content">

                        <p class="portal-eyebrow">
                            DOCUMENT MANAGEMENT
                        </p>

                        <h2>Documents</h2>

                        <p>
                            Review, track and manage permanent client documents
                            and journey-specific document requests.
                        </p>

                    </div>

                    <div class="lbc-document-header-actions">

                        <button
                            type="button"
                            id="admin-create-document-request"
                            class="lbc-document-btn lbc-document-btn-primary"
                        >
                            + Request Document
                        </button>

                    </div>

                </div>


                <div class="lbc-document-summary-grid">

                    ${adminDocumentSummaryCard(
                        "To Review",
                        reviewing.length,
                        "Documents awaiting review"
                    )}

                    ${adminDocumentSummaryCard(
                        "Requested",
                        requested.length,
                        "Open document requests"
                    )}

                    ${adminDocumentSummaryCard(
                        "Approved",
                        approved.length,
                        "Approved reusable documents"
                    )}

                    ${adminDocumentSummaryCard(
                        "Attention",
                        attention.length,
                        "Expiry or document issues"
                    )}

                </div>


                <section class="lbc-document-section">

                    <div class="lbc-document-section-header">

                        <div class="lbc-document-section-title">
                            <h3>Document Review Queue</h3>
                            <span>${reviewing.length}</span>
                        </div>

                    </div>

                    <div id="admin-document-review-container">
                        ${renderAdminDocumentReviewTable(reviewing)}
                    </div>

                </section>


                <section class="lbc-document-section">

                    <div class="lbc-document-section-header">

                        <div class="lbc-document-section-title">
                            <h3>Document Library</h3>
                            <span>${documents.length}</span>
                        </div>

                    </div>

                    <div class="lbc-document-toolbar">

                        <div class="lbc-document-toolbar-left">

                            <div class="lbc-document-search">
                                <input
                                    type="search"
                                    id="admin-document-search"
                                    placeholder="Search documents, clients or journeys..."
                                    value="${escapeHTML(LORDBLESS_ADMIN_DOCUMENT_STATE.search || "")}"
                                    autocomplete="off"
                                    aria-label="Search documents"
                                >
                            </div>

                        </div>

                        <div class="lbc-document-toolbar-right">

                            <select
                                id="admin-document-client-filter"
                                class="lbc-document-filter"
                                aria-label="Filter by client"
                            >
                                <option value="all">All clients</option>
                                ${clientOptions}
                            </select>

                            <select
                                id="admin-document-status-filter"
                                class="lbc-document-filter"
                                aria-label="Filter by document status"
                            >
                                <option
                                    value="all"
                                    ${LORDBLESS_ADMIN_DOCUMENT_STATE.statusFilter === "all" ? "selected" : ""}
                                >All statuses</option>
                                <option
                                    value="reviewing"
                                    ${LORDBLESS_ADMIN_DOCUMENT_STATE.statusFilter === "reviewing" ? "selected" : ""}
                                >Under review</option>
                                <option
                                    value="approved"
                                    ${LORDBLESS_ADMIN_DOCUMENT_STATE.statusFilter === "approved" ? "selected" : ""}
                                >Approved</option>
                                <option
                                    value="rejected"
                                    ${LORDBLESS_ADMIN_DOCUMENT_STATE.statusFilter === "rejected" ? "selected" : ""}
                                >Rejected</option>
                            </select>

                            <select
                                id="admin-document-journey-filter"
                                class="lbc-document-filter"
                                aria-label="Filter by journey"
                            >
                                <option value="all">All journeys</option>
                                ${journeyOptions}
                            </select>

                        </div>

                    </div>

                    <div id="admin-document-library-container">
                        ${renderAdminDocumentLibraryTable(documents)}
                    </div>

                </section>


                <section class="lbc-document-section">

                    <div class="lbc-document-section-header">

                        <div class="lbc-document-section-title">
                            <h3>Document Requests</h3>
                            <span>${data.requests.length}</span>
                        </div>

                    </div>

                    <div id="admin-document-request-container">
                        ${renderAdminDocumentRequests(data.requests)}
                    </div>

                </section>


                <section class="lbc-document-section">

                    <div class="lbc-document-section-header">

                        <div class="lbc-document-section-title">
                            <h3>Client Document Overview</h3>
                            <span>${data.clients.length}</span>
                        </div>

                    </div>

                    <div
                        class="lbc-document-table-wrapper"
                        id="admin-client-document-container"
                    >
                        ${renderAdminClientDocumentTable(data.clients, data.documents)}
                    </div>

                </section>

            </div>

        `;

        attachAdminDocumentWorkspaceEvents();

    } catch (error) {

        console.error(
            "LORDBLESS Documents workspace failed to render:",
            error
        );

        appContent.innerHTML = `
            <section class="admin-section">
                <div class="lbc-document-empty">
                    <div class="lbc-document-empty-icon">!</div>
                    <h4>Documents could not be loaded</h4>
                    <p>
                        The Documents workspace encountered an error.
                        Please refresh the portal and try again.
                    </p>
                </div>
            </section>
        `;

    }
}


/* =========================================================
   SUMMARY CARD
========================================================= */

function adminDocumentSummaryCard(
    label,
    value,
    note
) {

    return `
        <article class="lbc-document-summary-card">
            <div class="lbc-document-summary-label">
                ${escapeHTML(label)}
            </div>
            <div class="lbc-document-summary-value">
                ${escapeHTML(String(value))}
            </div>
            <div class="lbc-document-summary-note">
                ${escapeHTML(note)}
            </div>
        </article>
    `;
}


/* =========================================================
   REVIEW QUEUE
========================================================= */

function renderAdminDocumentReviewTable(documents) {

    if (!documents.length) {
        return `
            <div class="lbc-document-empty">
                <div class="lbc-document-empty-icon">✓</div>
                <h4>Review queue is clear</h4>
                <p>
                    There are currently no client documents awaiting administrative review.
                </p>
            </div>
        `;
    }

    return `
        <div class="lbc-document-table-wrapper">
            <table class="lbc-document-table">
                <thead>
                    <tr>
                        <th>Document</th>
                        <th>Client</th>
                        <th>Journey</th>
                        <th>Uploaded</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${documents.map(document => `
                        <tr>
                            <td>
                                <div class="lbc-document-document-name">
                                    ${escapeHTML(document.name || "Document")}
                                </div>
                                <div class="lbc-document-secondary">
                                    ${escapeHTML(document.filename || document.id || "—")}
                                </div>
                            </td>
                            <td>
                                <div class="lbc-document-client-name">
                                    ${escapeHTML(document.clientName || "Unknown client")}
                                </div>
                                <div class="lbc-document-secondary">
                                    ${escapeHTML(document.clientId || "—")}
                                </div>
                            </td>
                            <td>
                                ${escapeHTML(document.transactionTitle || "Client library")}
                            </td>
                            <td>
                                ${formatDate(document.uploadedAt)}
                            </td>
                            <td>
                                <span class="lbc-document-status status-reviewing">
                                    Under Review
                                </span>
                            </td>
                            <td>
                                <button
                                    type="button"
                                    class="lbc-document-btn lbc-document-btn-primary admin-document-review-btn"
                                    data-document-id="${escapeHTML(document.id)}"
                                >
                                    Review
                                </button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}


/* =========================================================
   DOCUMENT LIBRARY
========================================================= */

function getAdminDocumentStatusLabel(status) {

    const labels = {
        reviewing: "Under Review",
        approved: "Approved",
        rejected: "Rejected",
        pending: "Pending"
    };

    return labels[status] || "Unknown";
}


function getAdminDocumentStatusClass(status) {

    const classes = {
        reviewing: "status-reviewing",
        approved: "status-approved",
        rejected: "status-rejected",
        pending: "status-pending"
    };

    return classes[status] || "";
}


function renderAdminDocumentLibraryTable(documents) {

    if (!documents.length) {
        return `
            <div class="lbc-document-empty">
                <div class="lbc-document-empty-icon">⌕</div>
                <h4>No documents found</h4>
                <p>
                    Adjust the search or filters to view other documents.
                </p>
            </div>
        `;
    }

    return `
        <div class="lbc-document-table-wrapper">
            <table class="lbc-document-table">
                <thead>
                    <tr>
                        <th>Document</th>
                        <th>Client</th>
                        <th>Journey</th>
                        <th>Status</th>
                        <th>Validity</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${documents.map(document => {

                        const validity =
                            getAdminDocumentValidityStatus(document);

                        return `
                            <tr>
                                <td>
                                    <div class="lbc-document-document-name">
                                        ${escapeHTML(document.name || "Document")}
                                    </div>
                                    <div class="lbc-document-secondary">
                                        ${escapeHTML(document.filename || document.id || "—")}
                                    </div>
                                </td>

                                <td>
                                    <div class="lbc-document-client-name">
                                        ${escapeHTML(document.clientName || "Unknown client")}
                                    </div>
                                    <div class="lbc-document-secondary">
                                        ${escapeHTML(document.clientId || "—")}
                                    </div>
                                </td>

                                <td>
                                    ${escapeHTML(document.transactionTitle || "Client library")}
                                </td>

                                <td>
                                    <span class="lbc-document-status ${getAdminDocumentStatusClass(document.status)}">
                                        ${escapeHTML(getAdminDocumentStatusLabel(document.status))}
                                    </span>
                                </td>

                                <td>
                                    <span class="lbc-document-status ${validity.value === "normal" ? "status-approved" : "status-rejected"}">
                                        ${escapeHTML(validity.label)}
                                    </span>
                                </td>

                                <td>
                                    <button
                                        type="button"
                                        class="lbc-document-btn lbc-document-btn-secondary admin-document-view-btn"
                                        data-document-id="${escapeHTML(document.id)}"
                                    >
                                        View
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}


/* =========================================================
   DOCUMENT REQUESTS
========================================================= */

function renderAdminDocumentRequests(requests) {

    if (!requests.length) {
        return `
            <div class="lbc-document-empty">
                <div class="lbc-document-empty-icon">✓</div>
                <h4>No document requests</h4>
                <p>
                    There are currently no document requests visible to this desk.
                </p>
            </div>
        `;
    }

    return `
        <div class="lbc-document-request-grid">
            ${requests.map(request => `
                <article class="lbc-document-request-card">

                    <div class="lbc-document-request-header">
                        <div>
                            <div class="lbc-document-request-title">
                                ${escapeHTML(request.documentNames?.join(", ") || "Document Request")}
                            </div>
                            <div class="lbc-document-request-client">
                                ${escapeHTML(request.clientName || request.clientId || "Unknown client")}
                            </div>
                        </div>

                        <span class="lbc-document-status ${request.status === "completed" ? "status-approved" : "status-reviewing"}">
                            ${escapeHTML(request.status || "requested")}
                        </span>
                    </div>

                    <div class="lbc-document-request-meta-row">
                        <div class="lbc-document-request-meta">
                            <span class="lbc-document-request-meta-label">Journey</span>
                            <span class="lbc-document-request-meta-value">
                                ${escapeHTML(request.transactionTitle || request.transactionId || "—")}
                            </span>
                        </div>

                        <div class="lbc-document-request-meta">
                            <span class="lbc-document-request-meta-label">Deadline</span>
                            <span class="lbc-document-request-meta-value">
                                ${formatDate(request.deadline)}
                            </span>
                        </div>
                    </div>

                    <div class="lbc-document-request-message">
                        ${escapeHTML(request.message || "No additional instructions.")}
                    </div>

                    <div class="lbc-document-card-actions">
                        <button
                            type="button"
                            class="lbc-document-btn lbc-document-btn-secondary admin-document-request-view-btn"
                            data-request-id="${escapeHTML(request.id)}"
                        >
                            View Request
                        </button>
                    </div>

                </article>
            `).join("")}
        </div>
    `;
}


/* =========================================================
   CLIENT DOCUMENT OVERVIEW
========================================================= */

function renderAdminClientDocumentTable(clients, documents) {

    if (!clients.length) {
        return `
            <div class="lbc-document-empty">
                <div class="lbc-document-empty-icon">—</div>
                <h4>No clients available</h4>
                <p>No clients are currently visible to this desk.</p>
            </div>
        `;
    }

    return `
        <table class="lbc-document-table">
            <thead>
                <tr>
                    <th>Client</th>
                    <th>Journey</th>
                    <th>Documents</th>
                    <th>Attention</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${clients.map(client => {

                    const clientDocuments = documents.filter(
                        document => document.clientId === client.id
                    );

                    const clientAttention = clientDocuments.filter(
                        getAdminDocumentAttention
                    ).length;

                    const journey =
                        getAdminClientJourney(client.id);

                    return `
                        <tr>
                            <td>
                                <div class="lbc-document-client-name">
                                    ${escapeHTML(client.name || client.fullName || client.id)}
                                </div>
                                <div class="lbc-document-secondary">
                                    ${escapeHTML(client.id)}
                                </div>
                            </td>

                            <td>
                                ${escapeHTML(journey?.title || "—")}
                            </td>

                            <td>
                                ${clientDocuments.length}
                            </td>

                            <td>
                                ${clientAttention}
                            </td>

                            <td>
                                <button
                                    type="button"
                                    class="lbc-document-btn lbc-document-btn-secondary admin-client-documents-btn"
                                    data-client-id="${escapeHTML(client.id)}"
                                >
                                    View Documents
                                </button>
                            </td>
                        </tr>
                    `;
                }).join("")}
            </tbody>
        </table>
    `;
}


/* =========================================================
   FILTERS + ACTIONS
   Event delegation keeps the workspace stable after every
   filter/search refresh and prevents duplicate listeners.
========================================================= */

function attachAdminDocumentWorkspaceEvents() {

    const workspace =
        document.querySelector(".lbc-document-workspace");

    if (!workspace) {
        return;
    }

    workspace.addEventListener("input", event => {

        if (event.target.id !== "admin-document-search") {
            return;
        }

        LORDBLESS_ADMIN_DOCUMENT_STATE.search =
            event.target.value;

        refreshAdminDocumentWorkspace();
    });


    workspace.addEventListener("change", event => {

        const id = event.target.id;

        if (id === "admin-document-client-filter") {
            LORDBLESS_ADMIN_DOCUMENT_STATE.clientFilter =
                event.target.value;
        }

        if (id === "admin-document-status-filter") {
            LORDBLESS_ADMIN_DOCUMENT_STATE.statusFilter =
                event.target.value;
        }

        if (id === "admin-document-journey-filter") {
            LORDBLESS_ADMIN_DOCUMENT_STATE.journeyFilter =
                event.target.value;
        }

        if (
            id === "admin-document-client-filter" ||
            id === "admin-document-status-filter" ||
            id === "admin-document-journey-filter"
        ) {
            refreshAdminDocumentWorkspace();
        }
    });


    workspace.addEventListener("click", event => {

        const reviewButton =
            event.target.closest(".admin-document-review-btn");

        if (reviewButton) {
            openAdminDocumentReview(
                reviewButton.dataset.documentId
            );
            return;
        }

        const viewButton =
            event.target.closest(".admin-document-view-btn");

        if (viewButton) {
            openAdminDocumentReview(
                viewButton.dataset.documentId
            );
            return;
        }

        const requestButton =
            event.target.closest(".admin-document-request-view-btn");

        if (requestButton) {
            openAdminDocumentRequest(
                requestButton.dataset.requestId
            );
            return;
        }

        const clientButton =
            event.target.closest(".admin-client-documents-btn");

        if (clientButton) {
            filterAdminDocumentsToClient(
                clientButton.dataset.clientId
            );
            return;
        }

        const createButton =
            event.target.closest("#admin-create-document-request");

        if (createButton) {
            openNewAdminDocumentRequest();
        }
    });
}


function refreshAdminDocumentWorkspace() {

    const currentScroll = window.scrollY;

    renderAdminDocuments();

    window.scrollTo({
        top: currentScroll,
        behavior: "auto"
    });
}


function filterAdminDocumentsToClient(clientId) {

    if (!clientId) {
        return;
    }

    LORDBLESS_ADMIN_DOCUMENT_STATE.clientFilter = clientId;

    const filter =
        document.getElementById("admin-document-client-filter");

    if (filter) {
        filter.value = clientId;
    }

    refreshAdminDocumentWorkspace();
}


/* =========================================================
   VALIDITY / ATTENTION
========================================================= */

function getAdminDocumentValidityStatus(document) {

    if (!document || !document.expiryDate) {
        return {
            value: "normal",
            label: "No expiry date"
        };
    }

    const expiry = new Date(
        `${document.expiryDate}T00:00:00`
    );

    if (Number.isNaN(expiry.getTime())) {
        return {
            value: "normal",
            label: "Expiry date unavailable"
        };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = Math.ceil(
        (expiry.getTime() - today.getTime()) /
        86400000
    );

    if (days < 0) {
        return {
            value: "critical",
            label: "Expired"
        };
    }

    if (days < 90) {
        return {
            value: "urgent",
            label: "Urgent · expires within 3 months"
        };
    }

    if (days <= 180) {
        return {
            value: "attention",
            label: "Attention · expires within 6 months"
        };
    }

    return {
        value: "normal",
        label: "Valid"
    };
}


function getAdminDocumentAttention(document) {

    if (!document) {
        return false;
    }

    if (document.status === "rejected") {
        return true;
    }

    if (document.status !== "approved") {
        return false;
    }

    const validity =
        getAdminDocumentValidityStatus(document);

    return validity.value !== "normal";
}


/* =========================================================
   DOCUMENT REVIEW
========================================================= */

function openAdminDocumentReview(documentId) {

    const selected =
        LORDBLESS_ADMIN_DOCUMENT_DATA.documents.find(
            document => document.id === documentId
        );

    if (!selected || !canCurrentAdminAccessDocument(selected)) {
        return;
    }

    const client =
        LORDBLESS_ADMIN_DOCUMENT_DATA.clients.find(
            item => item.id === selected.clientId
        );

    const transaction =
        LORDBLESS_DOCUMENT_JOURNEYS.find(
            item => item.id === selected.transactionId
        );

    if (typeof renderDocumentReview === "function") {

        modalContent.innerHTML =
            renderDocumentReview(
                modalContent,
                selected,
                client,
                transaction
            );

        enquiryModal.classList.remove("hidden");

        if (typeof initialiseDocumentReview === "function") {
            initialiseDocumentReview(
                selected,
                client,
                transaction
            );
        }

        return;
    }

    const validity =
        getAdminDocumentValidityStatus(selected);

    modalContent.innerHTML = `
        <div class="lbc-document-modal-content">

            <div class="lbc-document-modal-header">
                <div class="lbc-document-modal-title">
                    <h3>${escapeHTML(selected.name || "Document")}</h3>
                    <p>${escapeHTML(selected.filename || selected.id || "")}</p>
                </div>
            </div>

            <div class="lbc-client-document-details">
                <div class="lbc-client-document-meta">
                    <strong>Client</strong>
                    <span>${escapeHTML(client?.name || selected.clientName || "—")}</span>
                </div>
                <div class="lbc-client-document-meta">
                    <strong>Journey</strong>
                    <span>${escapeHTML(transaction?.title || "Client library")}</span>
                </div>
                <div class="lbc-client-document-meta">
                    <strong>Status</strong>
                    <span>${escapeHTML(getAdminDocumentStatusLabel(selected.status))}</span>
                </div>
                <div class="lbc-client-document-meta">
                    <strong>Validity</strong>
                    <span>${escapeHTML(validity.label)}</span>
                </div>
            </div>

        </div>
    `;

    enquiryModal.classList.remove("hidden");
}


/* =========================================================
   REQUEST VIEW
========================================================= */

function openAdminDocumentRequest(requestId) {

    const request =
        LORDBLESS_ADMIN_DOCUMENT_DATA.requests.find(
            item => item.id === requestId
        );

    if (!request || !canCurrentAdminAccessDocumentRequest(request)) {
        return;
    }

    modalContent.innerHTML = `
        <div class="lbc-document-modal-content">

            <div class="lbc-document-modal-header">
                <div class="lbc-document-modal-title">
                    <h3>Document Request</h3>
                    <p>${escapeHTML(request.id || "")}</p>
                </div>
            </div>

            <div class="lbc-client-document-details">
                <div class="lbc-client-document-meta">
                    <strong>Client</strong>
                    <span>${escapeHTML(request.clientName || request.clientId || "—")}</span>
                </div>
                <div class="lbc-client-document-meta">
                    <strong>Journey</strong>
                    <span>${escapeHTML(request.transactionTitle || request.transactionId || "—")}</span>
                </div>
                <div class="lbc-client-document-meta">
                    <strong>Deadline</strong>
                    <span>${formatDate(request.deadline)}</span>
                </div>
                <div class="lbc-client-document-meta">
                    <strong>Status</strong>
                    <span>${escapeHTML(request.status || "requested")}</span>
                </div>
            </div>

            <div class="lbc-document-request-message">
                <strong>Documents requested</strong>
                <p>
                    ${escapeHTML(request.documentNames?.join(", ") || "—")}
                </p>
            </div>

            <div class="lbc-document-request-message">
                ${escapeHTML(request.message || "No additional instructions.")}
            </div>

        </div>
    `;

    enquiryModal.classList.remove("hidden");
}


/* =========================================================
   NEW DOCUMENT REQUEST — D4
========================================================= */

function openNewAdminDocumentRequest() {

    /* =====================================================
       D4 — DOCUMENT REQUEST SETUP

       Step 1:
       Client
       Journey
       Document
       Request Type

       Step 2:
       Existing documentRequest.js composer
    ===================================================== */


    /* -----------------------------------------------------
       VERIFY SHARED REQUEST COMPONENT
    ----------------------------------------------------- */

    if (
        typeof window.LORDBLESS_DOCUMENT_REQUEST ===
        "undefined" ||
        typeof window.LORDBLESS_DOCUMENT_REQUEST.render !==
        "function"
    ) {

        alert(
            "The Document Request component is not available."
        );

        return;

    }


    /* -----------------------------------------------------
       INITIALISE ADMIN DOCUMENT DATA
    ----------------------------------------------------- */

    initialiseAdminDocumentData();


    /* -----------------------------------------------------
       GET CLIENTS WITHIN CURRENT DESK SCOPE
    ----------------------------------------------------- */

    const clients =
        getAdminClients();


    if (
        !Array.isArray(clients) ||
        !clients.length
    ) {

        alert(
            "No clients are currently available in your desk scope."
        );

        return;

    }


    /* -----------------------------------------------------
       STABLE DOCUMENT CATALOGUE

       This is intentionally kept inside the D4 workflow
       for now so we do not introduce another global
       dependency while repairing the current Admin Portal.
    ----------------------------------------------------- */

    const documentCatalogue = [

        [
            "passport",
            "International Passport"
        ],

        [
            "national_id",
            "National ID"
        ],

        [
            "birth_certificate",
            "Birth Certificate"
        ],

        [
            "marriage_certificate",
            "Marriage Certificate"
        ],

        [
            "divorce_certificate",
            "Divorce Certificate"
        ],

        [
            "passport_photo",
            "Passport Photograph"
        ],

        [
            "cv",
            "CV / Résumé"
        ],

        [
            "cover_letter",
            "Cover Letter"
        ],

        [
            "academic_certificate",
            "Academic Certificate / Degree"
        ],

        [
            "academic_transcript",
            "Academic Transcript"
        ],

        [
            "professional_certificate",
            "Professional Certificate / License"
        ],

        [
            "professional_registration",
            "Professional Registration"
        ],

        [
            "employment_certificate",
            "Employment Certificate / Experience Letter"
        ],

        [
            "employment_contract",
            "Employment Contract"
        ],

        [
            "reference_letter",
            "Reference Letter"
        ],

        [
            "recommendation_letter",
            "Recommendation Letter"
        ],

        [
            "payslip",
            "Payslip"
        ],

        [
            "bank_statement",
            "Bank Statement"
        ],

        [
            "bank_letter",
            "Bank Letter"
        ],

        [
            "proof_of_funds",
            "Proof of Funds"
        ],

        [
            "tax_clearance",
            "Tax Clearance Certificate"
        ],

        [
            "business_registration",
            "Business Registration / Incorporation Document"
        ],

        [
            "business_license",
            "Business License"
        ],

        [
            "company_profile",
            "Company Profile"
        ],

        [
            "invitation_letter",
            "Invitation Letter"
        ],

        [
            "sponsorship_letter",
            "Sponsorship Letter"
        ],

        [
            "affidavit",
            "Affidavit / Statutory Declaration"
        ],

        [
            "police_clearance",
            "Police Clearance Certificate"
        ],

        [
            "medical_certificate",
            "Medical Certificate"
        ],

        [
            "vaccination_record",
            "Vaccination Record"
        ],

        [
            "health_insurance",
            "Health Insurance"
        ],

        [
            "travel_insurance",
            "Travel Insurance"
        ],

        [
            "flight_itinerary",
            "Flight Reservation / Itinerary"
        ],

        [
            "accommodation_confirmation",
            "Hotel / Accommodation Confirmation"
        ],

        [
            "proof_of_address",
            "Proof of Address"
        ],

        [
            "utility_bill",
            "Utility Bill"
        ],

        [
            "residence_permit",
            "Residence Permit / Visa"
        ],

        [
            "previous_visa",
            "Previous Visa / Travel History"
        ],

        [
            "admission_letter",
            "Admission Letter"
        ],

        [
            "school_offer_letter",
            "School / University Offer Letter"
        ],

        [
            "tuition_receipt",
            "Tuition Fee Receipt"
        ],

        [
            "accommodation_letter",
            "Accommodation Letter"
        ],

        [
            "language_certificate",
            "Language Certificate (IELTS / TOEFL etc.)"
        ],

        [
            "nnas_advisory_report",
            "NNAS Advisory Report"
        ],

        [
            "nursing_registration",
            "Nursing Council Registration"
        ],

        [
            "nursing_training_certificate",
            "Nursing Training Certificate"
        ],

        [
            "nclex_eligibility",
            "NCLEX / Exam Eligibility"
        ],

        [
            "upbridging_evidence",
            "Upbridging Programme Evidence"
        ],

        [
            "job_offer",
            "Job Offer Letter"
        ],

        [
            "income_evidence",
            "Salary / Income Evidence"
        ],

        [
            "other_supporting_document",
            "Other Supporting Document"
        ]

    ];


    /* -----------------------------------------------------
       STEP 1 MODAL
    ----------------------------------------------------- */

    modalContent.innerHTML = `

        <div class="lbc-document-modal-content">


            <div class="lbc-document-modal-header">

                <div class="lbc-document-modal-title">

                    <span class="section-eyebrow">
                        DOCUMENT REQUEST · STEP 1
                    </span>

                    <h3>
                        Create Document Request
                    </h3>

                    <p>
                        Select the client, journey, document
                        and reason for the request.
                    </p>

                </div>

            </div>


            <form
                id="admin-document-request-setup-form"
            >


                <div class="lbc-form-grid">


                    <!-- CLIENT -->

                    <div class="lbc-form-field">

                        <label
                            for="admin-request-client"
                        >
                            Client
                        </label>

                        <select
                            id="admin-request-client"
                            name="clientId"
                            required
                        >

                            <option value="">
                                Select client
                            </option>

                            ${clients.map(client => `

                                <option
                                    value="${escapeHTML(client.id)}"
                                >
                                    ${escapeHTML(
                                        client.fullName ||
                                        client.name ||
                                        client.id
                                    )}
                                    ·
                                    ${escapeHTML(client.id)}
                                </option>

                            `).join("")}

                        </select>

                    </div>


                    <!-- JOURNEY -->

                    <div class="lbc-form-field">

                        <label
                            for="admin-request-journey"
                        >
                            Journey
                        </label>

                        <select
                            id="admin-request-journey"
                            name="transactionId"
                            required
                        >

                            <option value="">
                                Select client first
                            </option>

                        </select>

                    </div>


                    <!-- DOCUMENT -->

                    <div class="lbc-form-field">

                        <label
                            for="admin-request-document"
                        >
                            Document Required
                        </label>

                        <select
                            id="admin-request-document"
                            name="documentType"
                            required
                        >

                            <option value="">
                                Select document
                            </option>

                            ${documentCatalogue.map(item => `

                                <option
                                    value="${escapeHTML(item[0])}"
                                >
                                    ${escapeHTML(item[1])}
                                </option>

                            `).join("")}

                        </select>

                    </div>


                    <!-- REQUEST TYPE -->

                    <div class="lbc-form-field">

                        <label
                            for="admin-request-type"
                        >
                            Request Type
                        </label>

                        <select
                            id="admin-request-type"
                            name="requestType"
                            required
                        >

                            <option value="missing">
                                Missing document
                            </option>

                            <option value="replacement">
                                Replacement required
                            </option>

                            <option value="expired">
                                Expired / no longer valid
                            </option>

                            <option value="additional">
                                Additional document
                            </option>

                        </select>

                    </div>


                </div>


                <div
                    id="admin-request-setup-error"
                    class="lbc-document-form-error"
                    hidden
                ></div>


                <div class="lbc-document-modal-actions">


                    <button
                        type="button"
                        class="btn btn-secondary"
                        id="admin-request-setup-cancel"
                    >
                        Cancel
                    </button>


                    <button
                        type="submit"
                        class="btn btn-primary"
                    >
                        Continue
                    </button>


                </div>


            </form>

        </div>

    `;


    /* -----------------------------------------------------
       OPEN MODAL
    ----------------------------------------------------- */

    enquiryModal.classList.remove(
        "hidden"
    );


    /* -----------------------------------------------------
       GET FORM ELEMENTS
    ----------------------------------------------------- */

    const clientSelect =
        document.getElementById(
            "admin-request-client"
        );


    const journeySelect =
        document.getElementById(
            "admin-request-journey"
        );


    const form =
        document.getElementById(
            "admin-document-request-setup-form"
        );


    const cancelButton =
        document.getElementById(
            "admin-request-setup-cancel"
        );


    /* -----------------------------------------------------
       POPULATE JOURNEYS FOR SELECTED CLIENT
    ----------------------------------------------------- */

    function populateJourneyOptions(
        clientId
    ) {

        if (!journeySelect) {
            return;
        }


        const journeys =
            getAdminClientJourneys(
                clientId
            );


        if (
            !Array.isArray(journeys) ||
            !journeys.length
        ) {

            journeySelect.innerHTML = `

                <option value="">
                    No visible journey available
                </option>

            `;

            return;

        }


        journeySelect.innerHTML = `

            <option value="">
                Select journey
            </option>

            ${journeys.map(journey => `

                <option
                    value="${escapeHTML(journey.id)}"
                >

                    ${escapeHTML(
                        journey.title ||
                        "Client Journey"
                    )}

                    ·

                    ${escapeHTML(
                        journey.id
                    )}

                </option>

            `).join("")}

        `;

    }


    /* -----------------------------------------------------
       CLIENT CHANGE
    ----------------------------------------------------- */

    if (clientSelect) {

        clientSelect.addEventListener(
            "change",
            event => {

                populateJourneyOptions(
                    event.target.value
                );

            }
        );

    }


    /* -----------------------------------------------------
       CANCEL
    ----------------------------------------------------- */

    if (cancelButton) {

        cancelButton.addEventListener(
            "click",
            closeEnquiryModal
        );

    }


    /* -----------------------------------------------------
       STEP 1 SUBMIT → STEP 2
    ----------------------------------------------------- */

    if (form) {

        form.addEventListener(
            "submit",
            event => {

                event.preventDefault();


                const formData =
                    new FormData(
                        form
                    );


                const clientId =
                    String(
                        formData.get(
                            "clientId"
                        ) ||
                        ""
                    );


                const transactionId =
                    String(
                        formData.get(
                            "transactionId"
                        ) ||
                        ""
                    );


                const documentType =
                    String(
                        formData.get(
                            "documentType"
                        ) ||
                        ""
                    );


                const requestType =
                    String(
                        formData.get(
                            "requestType"
                        ) ||
                        "missing"
                    );


                const client =
                    clients.find(
                        item =>
                            item.id ===
                            clientId
                    ) ||
                    null;


                const journey =
                    getAdminClientJourneys(
                        clientId
                    ).find(
                        item =>
                            item.id ===
                            transactionId
                    ) ||
                    null;


                const catalogueItem =
                    documentCatalogue.find(
                        item =>
                            item[0] ===
                            documentType
                    );


                /* -----------------------------------------
                   VALIDATION
                ----------------------------------------- */

                if (
                    !client ||
                    !journey ||
                    !catalogueItem
                ) {

                    const errorBox =
                        document.getElementById(
                            "admin-request-setup-error"
                        );


                    if (errorBox) {

                        errorBox.textContent =
                            "Please select a client, journey and document before continuing.";

                        errorBox.hidden =
                            false;

                    }

                    return;

                }


                /* -----------------------------------------
                   CREATE REQUIREMENT OBJECT

                   This is NOT a new permanent document.

                   It is a journey-specific requirement
                   that will be linked to the client's
                   permanent document library later.
                ----------------------------------------- */

                const requirement = {

                    requirementId:
                        `REQ-${documentType}-${Date.now()}`,

                    documentType:
                        catalogueItem[0],

                    name:
                        catalogueItem[1],

                    status:
                        requestType ===
                        "expired"

                            ? "expired"

                            : requestType ===
                              "replacement"

                                ? "rejected"

                                : "required"

                };


                /* -----------------------------------------
                   STEP 2
                ----------------------------------------- */

                modalContent.innerHTML = `

                    <div
                        class="lbc-document-modal-content"
                    >


                        <div
                            class="lbc-document-modal-header"
                        >

                            <div
                                class="lbc-document-modal-title"
                            >

                                <span
                                    class="section-eyebrow"
                                >
                                    DOCUMENT REQUEST · STEP 2
                                </span>


                                <h3>
                                    Request
                                    ${escapeHTML(
                                        requirement.name
                                    )}
                                </h3>


                                <p>

                                    ${escapeHTML(
                                        client.fullName ||
                                        client.name ||
                                        client.id
                                    )}

                                    ·

                                    ${escapeHTML(
                                        journey.title ||
                                        journey.id
                                    )}

                                </p>

                            </div>

                        </div>


                        <div
                            id="admin-d4-request-container"
                        ></div>


                    </div>

                `;


                const container =
                    document.getElementById(
                        "admin-d4-request-container"
                    );


                if (!container) {
                    return;
                }


                /* -----------------------------------------
                   OPEN EXISTING REQUEST COMPOSER
                ----------------------------------------- */

                window
                    .LORDBLESS_DOCUMENT_REQUEST
                    .render(
                        container,
                        client,
                        journey,
                        requirement,
                        requestType
                    );

            }
        );

    }

}

/* =========================================================
   CLOSE DOCUMENT MODAL
========================================================= */

function closeAdminDocumentModal() {

    enquiryModal.classList.add("hidden");

    if (modalContent) {
        modalContent.innerHTML = "";
    }
}


/* =========================================
   DASHBOARD
========================================= */

function renderDashboard() {

    const enquiries =
        state.enquiries;


    const total =
        enquiries.length;


    const newCount =
        enquiries.filter(
            enquiry =>
                enquiry.status === "new"
        ).length;


    const reviewingCount =
        enquiries.filter(
            enquiry =>
                enquiry.status === "reviewing"
        ).length;


    const contactedCount =
        enquiries.filter(
            enquiry =>
                enquiry.status === "contacted"
        ).length;


    appContent.innerHTML = `

        <div class="stats-grid">

            ${statCard(
                "Total Enquiries",
                total,
                "All recorded enquiries"
            )}

            ${statCard(
                "New",
                newCount,
                "Awaiting review"
            )}

            ${statCard(
                "Reviewing",
                reviewingCount,
                "Currently being assessed"
            )}

            ${statCard(
                "Contacted",
                contactedCount,
                "Client contact started"
            )}

        </div>


        ${renderEnquiryDataNotice()}


        <section class="section">

            <div class="section-header">

                <div>

                    <h2 class="section-title">
                        Recent Enquiries
                    </h2>

                    <div class="section-subtitle">
                        Latest client enquiries received by LORDBLESS.
                    </div>

                </div>


                <button
                    class="button"
                    id="view-all-enquiries"
                >
                    View All
                </button>

            </div>


            <div class="table-wrapper">

                ${enquiryTable(
                    enquiries.slice(
                        0,
                        5
                    )
                )}

            </div>

        </section>

    `;


    const enquiryFilters = [
        "all",
        "new",
        "reviewing",
        "contacted"
    ];

    appContent
        .querySelectorAll(".stats-grid .stat-card")
        .forEach((card, index) => {

            card.addEventListener(
                "click",
                () => {

                    state.statusFilter =
                        enquiryFilters[index];

                    state.search = "";

                    renderView(
                        "enquiries"
                    );

                }
            );

        });


    document
        .getElementById(
            "view-all-enquiries"
        )
        ?.addEventListener(
            "click",
            () => {

                state.currentView =
                    "enquiries";

                renderView(
                    "enquiries"
                );

            }
        );


    attachEnquiryRows();

}


/* =========================================
   ENQUIRIES
========================================= */

function renderEnquiries() {

    const filtered =
        getFilteredEnquiries();


    appContent.innerHTML = `

        <section class="section">

            ${renderEnquiryDataNotice()}

            <div class="section-header">

                <div>

                    <h2 class="section-title">
                        All Enquiries
                    </h2>

                    <div class="section-subtitle">
                        Search and manage LORDBLESS client enquiries.
                    </div>

                </div>

            </div>


            <div class="toolbar">

                <input
                    id="enquiry-search"
                    class="search-input"
                    type="search"
                    placeholder="Search reference, client, email or service..."
                    value="${escapeHTML(
                        state.search
                    )}"
                >


                <select
                    id="status-filter"
                    class="filter-select"
                >

                    <option value="all">
                        All statuses
                    </option>

                    ${LORDBLESS_MOCK_DATA
                        .statuses
                        .map(
                            status => `

                                <option
                                    value="${escapeHTML(
                                        status
                                    )}"
                                >

                                    ${escapeHTML(
                                        LORDBLESS_STATUS_LABELS[
                                            status
                                        ] ||
                                        status
                                    )}

                                </option>

                            `
                        )
                        .join("")
                    }

                </select>

            </div>


            <div class="table-wrapper">

                ${enquiryTable(
                    filtered
                )}

            </div>

        </section>

    `;


    const searchInput =
        document.getElementById(
            "enquiry-search"
        );


    const statusFilter =
        document.getElementById(
            "status-filter"
        );


    statusFilter.value =
        state.statusFilter;


    searchInput.addEventListener(
        "input",
        event => {

            state.search =
                event.target.value;

            renderEnquiries();

        }
    );


    statusFilter.addEventListener(
        "change",
        event => {

            state.statusFilter =
                event.target.value;

            renderEnquiries();

        }
    );


    attachEnquiryRows();

}


/* =========================================
   FILTER ENQUIRIES
========================================= */

function getFilteredEnquiries() {

    const search =
        state.search
            .trim()
            .toLowerCase();


    return state.enquiries.filter(
        enquiry => {

            const matchesStatus =
                state.statusFilter === "all" ||
                enquiry.status ===
                    state.statusFilter;


            if (!matchesStatus) {

                return false;

            }


            if (!search) {

                return true;

            }


            const searchable = [

                enquiry.reference,

                enquiry.client.fullName,

                enquiry.client.email,

                enquiry.client.whatsapp,

                enquiry.client.currentCountry,

                ...(enquiry.services || []),

                enquiry.journey.destination

            ]
                .join(" ")
                .toLowerCase();


            return searchable.includes(
                search
            );

        }
    );

}


/* =========================================
   ENQUIRY TABLE
========================================= */

function enquiryTable(
    enquiries
) {

    if (!enquiries.length) {

        return `

            <div class="empty-state">

                <div class="empty-state-title">
                    No enquiries found
                </div>

                <div class="empty-state-text">
                    Try changing your search or filter.
                </div>

            </div>

        `;

    }


    return `

        <table class="enquiry-table">

            <thead>

                <tr>

                    <th>
                        Reference
                    </th>

                    <th>
                        Client
                    </th>

                    <th>
                        Service
                    </th>

                    <th>
                        Destination
                    </th>

                    <th>
                        Status
                    </th>

                    <th>
                        Date
                    </th>

                    <th>
                        Action
                    </th>

                </tr>

            </thead>


            <tbody>

                ${enquiries
                    .map(
                        enquiry => `

                            <tr
                                class="enquiry-row"
                                data-reference="${escapeHTML(
                                    enquiry.reference
                                )}"
                            >

                                <td>

                                    <strong>
                                        ${escapeHTML(
                                            enquiry.reference
                                        )}
                                    </strong>

                                </td>


                                <td>
                                    ${escapeHTML(
                                        enquiry.client.fullName
                                    )}
                                </td>


                                <td>
                                    ${escapeHTML(
                                        formatServices(
                                            enquiry.services
                                        )
                                    )}
                                </td>


                                <td>
                                    ${escapeHTML(
                                        enquiry.journey.destination
                                    )}
                                </td>


                                <td>
                                    ${renderStatusBadge(
                                        enquiry.status
                                    )}
                                </td>


                                <td>
                                    ${formatDate(
                                        enquiry.createdAt
                                    )}
                                </td>

                                <td>
                                    <button
                                        type="button"
                                        class="button button-secondary"
                                        data-view-client
                                        data-enquiry-reference="${escapeHTML(
                                            enquiry.reference || ""
                                        )}"
                                        aria-label="View client details for ${escapeHTML(
                                            enquiry.reference || "this enquiry"
                                        )}"
                                    >
                                        VIEW CLIENT
                                    </button>
                                </td>

                            </tr>

                        `
                    )
                    .join("")
                }

            </tbody>

        </table>

    `;

}


/* =========================================
   ENQUIRY OPENING
========================================= */

function attachEnquiryRows() {

    document
        .querySelectorAll(
            "[data-view-client]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openAdminEnquiryClient(
                        button.dataset.enquiryReference
                    );
                }
            );

        });

}


function getEnquiryClientId(enquiry) {
    return String(
        enquiry?.client_id ||
        enquiry?.client?.id ||
        ""
    ).trim();
}


function isSupabaseClientId(clientId) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(clientId || ""));
}


async function loadClientPortalAccount(clientId) {
    const { data, error } = await lordblessSupabase
        .from("client_accounts")
        .select("client_id, auth_user_id, access_status")
        .eq("client_id", clientId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}


function renderAdminEnquiryClientView(enquiry, portalState) {
    if (
        !window.LORDBLESS_CLIENT_DETAILS ||
        typeof window.LORDBLESS_CLIENT_DETAILS.renderEnquiry !== "function"
    ) {
        modalContent.innerHTML = `
            <div class="empty-state" role="alert">
                Client Details could not be loaded.
            </div>
        `;
        return;
    }

    window.LORDBLESS_CLIENT_DETAILS.renderEnquiry(
        modalContent,
        {
            enquiry,
            client: enquiry.client || {},
            clientId: getEnquiryClientId(enquiry),
            portalState: portalState || {},
            canReadAssessment: hasPermission(getCurrentUser(), "finance.read"),
            canCreateAssessment: hasPermission(getCurrentUser(), "finance.requests"),
            canScheduleConsultation: hasPermission(getCurrentUser(), "consultations.manage"),
            assessmentPayment: portalState?.assessmentPayment || null,
            consultationMeeting: portalState?.consultationMeeting || null,
            consultationEmail: portalState?.consultationEmail || null,
            assessmentError: portalState?.assessmentError || ""
        }
    );

    bindAdminAssessmentActions(enquiry, portalState || {});

    const createButton = modalContent.querySelector(
        '[data-client-portal-action="create"]'
    );
    if (createButton) createButton.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const clientId = createButton.dataset.clientId;
        const activeReference =
            enquiryModal.dataset.clientDetailsReference;
        const message = modalContent.querySelector(
            "[data-client-portal-message]"
        );
        createButton.disabled = true;
        if (message) message.textContent = "Creating Client Portal access…";

        try {
            const result = await requestClientPortalAccess(clientId);
            const portalAccount = await loadClientPortalAccount(clientId);
            if (
                enquiryModal.classList.contains("hidden") ||
                enquiryModal.dataset.clientDetailsReference !== activeReference
            ) return;

            const outcome = result?.already_linked
                ? "Portal access is already linked to this client."
                : result?.existing_auth_user_linked
                    ? "The existing Auth account has been linked to this client."
                    : "The Client Portal invitation was created.";

            renderAdminEnquiryClientView(enquiry, {
                ...portalState,
                account: portalAccount,
                canCreate: false,
                canResend: Boolean(
                    portalState.canManageAccess &&
                    portalAccount?.access_status === "invited"
                ),
                message: outcome
            });
        } catch (error) {
            if (
                enquiryModal.classList.contains("hidden") ||
                enquiryModal.dataset.clientDetailsReference !== activeReference
            ) return;

            if (message) {
                message.textContent = error?.message ||
                    "Unable to create Client Portal access.";
            }
            createButton.disabled = false;
        }
    });

    const resendButton = modalContent.querySelector(
        '[data-client-portal-action="resend-invitation"]'
    );
    if (resendButton) resendButton.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const clientId = resendButton.dataset.clientId;
        const activeReference =
            enquiryModal.dataset.clientDetailsReference;
        const message = modalContent.querySelector(
            "[data-client-portal-message]"
        );
        resendButton.disabled = true;
        resendButton.textContent = "SENDING INVITATION…";
        if (message) message.textContent = "Sending a fresh invitation…";

        try {
            const result = await requestClientPortalAccess(
                clientId,
                "resend_invitation"
            );
            const portalAccount = await loadClientPortalAccount(clientId);
            if (
                enquiryModal.classList.contains("hidden") ||
                enquiryModal.dataset.clientDetailsReference !== activeReference
            ) return;

            renderAdminEnquiryClientView(enquiry, {
                ...portalState,
                account: portalAccount,
                canCreate: false,
                canResend: Boolean(
                    portalState.canManageAccess &&
                    portalAccount?.access_status === "invited"
                ),
                message: result?.invitation_resent
                    ? "A fresh Client Portal invitation was sent."
                    : "The invitation request was processed."
            });
        } catch (error) {
            if (
                enquiryModal.classList.contains("hidden") ||
                enquiryModal.dataset.clientDetailsReference !== activeReference
            ) return;

            if (message) {
                message.textContent = error?.message ||
                    "Unable to resend the Client Portal invitation.";
            }
            resendButton.disabled = false;
            resendButton.textContent = "RESEND INVITATION";
        }
    });
}


async function loadAdminAssessmentState(clientId) {
    const result = {
        assessmentPayment: null,
        consultationMeeting: null,
        consultationEmail: null,
        assessmentError: ""
    };
    if (!hasPermission(getCurrentUser(), "finance.read")) return result;

    const { data: payment, error: paymentError } = await lordblessSupabase
        .from("client_assessment_payments")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
    if (paymentError) {
        result.assessmentError = paymentError.message || "Assessment payment data is unavailable.";
        return result;
    }
    result.assessmentPayment = payment || null;

    if (!hasPermission(getCurrentUser(), "consultations.manage")) return result;
    const { data: meeting, error: meetingError } = await lordblessSupabase
        .from("client_consultation_meetings")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
    if (meetingError) {
        result.assessmentError = meetingError.message || "Consultation details are unavailable.";
        return result;
    }
    result.consultationMeeting = meeting || null;

    if (meeting) {
        const { data: email, error: emailError } = await lordblessSupabase
            .from("client_consultation_email_outbox")
            .select("notification_id, status, updated_at, last_error")
            .eq("client_id", clientId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (!emailError) result.consultationEmail = email || null;
    }
    return result;
}


async function refreshAdminClientAssessment(enquiry, portalState, messageText = "") {
    const clientId = getEnquiryClientId(enquiry);
    const assessment = await loadAdminAssessmentState(clientId);
    if (
        enquiryModal.classList.contains("hidden") ||
        enquiryModal.dataset.clientDetailsReference !== String(enquiry.reference || enquiry.id || "")
    ) return;
    renderAdminEnquiryClientView(enquiry, { ...portalState, ...assessment });
    if (messageText) {
        const message = modalContent.querySelector("[data-assessment-message]");
        if (message) message.textContent = messageText;
    }
}


async function sendConsultationEmail(notificationId) {
    if (!notificationId) return "Meeting saved. Email delivery is pending configuration.";
    try {
        const { data, error } = await lordblessSupabase.functions.invoke(
            "send-consultation-notification",
            { body: { notification_id: notificationId } }
        );
        if (error) return `Meeting saved. Email was not confirmed as sent: ${error.message || "notification service unavailable"}`;
        if (!data?.sent) return `Meeting saved. Email was not sent: ${data?.error || "delivery is pending"}`;
        return "Meeting saved and confirmation email sent.";
    } catch (error) {
        return `Meeting saved. Email was not confirmed as sent: ${error?.message || "notification service unavailable"}`;
    }
}


function bindAdminAssessmentActions(enquiry, portalState) {
    const createButton = modalContent.querySelector("[data-assessment-create]");
    if (createButton) createButton.addEventListener("click", async () => {
        const clientId = createButton.dataset.clientId;
        const message = modalContent.querySelector("[data-assessment-message]");
        createButton.disabled = true;
        if (message) message.textContent = "Creating the assessment request…";
        try {
            const { data, error } = await lordblessSupabase.rpc(
                "request_initial_assessment_payment",
                { p_client_id: clientId }
            );
            if (error) throw error;
            LORDBLESS_ASSESSMENT_FINANCE_LOADED = false;
            await refreshAdminClientAssessment(
                enquiry,
                portalState,
                data?.created ? "GHS 1,000 assessment request created." : "The existing assessment request was reused."
            );
        } catch (error) {
            if (message) message.textContent = error?.message || "Unable to create the assessment request.";
            createButton.disabled = false;
        }
    });

    const instructionsForm = modalContent.querySelector("[data-assessment-instructions-form]");
    if (instructionsForm) instructionsForm.addEventListener("submit", async event => {
        event.preventDefault();
        const button = instructionsForm.querySelector('[type="submit"]');
        const message = modalContent.querySelector("[data-assessment-message]");
        const instructions = new FormData(instructionsForm).get("payment_instructions");
        button.disabled = true;
        if (message) message.textContent = "Saving approved payment instructions…";
        try {
            const { error } = await lordblessSupabase.rpc(
                "set_initial_assessment_payment_instructions",
                {
                    p_payment_id: instructionsForm.dataset.paymentId,
                    p_payment_instructions: String(instructions || "").trim()
                }
            );
            if (error) throw error;
            await refreshAdminClientAssessment(
                enquiry,
                portalState,
                "Finance-approved payment instructions saved."
            );
        } catch (error) {
            if (message) message.textContent = error?.message || "Unable to save payment instructions.";
            button.disabled = false;
        }
    });

    const form = modalContent.querySelector("[data-consultation-form]");
    if (form) form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        const message = modalContent.querySelector("[data-assessment-message]");
        const fields = new FormData(form);
        const localStart = `${fields.get("meeting_date")}T${fields.get("meeting_time")}:00`;
        button.disabled = true;
        if (message) message.textContent = "Saving the consultation…";
        try {
            const { data, error } = await lordblessSupabase.rpc("schedule_client_consultation", {
                p_client_id: form.dataset.clientId,
                p_local_start: localStart,
                p_timezone: fields.get("timezone"),
                p_duration_minutes: Number(fields.get("duration_minutes")),
                p_mode: fields.get("mode"),
                p_location: fields.get("location") || null,
                p_meeting_link: fields.get("meeting_link") || null,
                p_instructions: fields.get("instructions") || null
            });
            if (error) throw error;
            const emailMessage = data?.unchanged
                ? "Meeting details are unchanged."
                : await sendConsultationEmail(data?.notification_id);
            await refreshAdminClientAssessment(enquiry, portalState, emailMessage);
        } catch (error) {
            if (message) message.textContent = error?.message || "Unable to save the consultation.";
            button.disabled = false;
        }
    });

    const cancelButton = modalContent.querySelector("[data-consultation-cancel]");
    if (cancelButton) cancelButton.addEventListener("click", async () => {
        const reason = window.prompt("Optional cancellation note for the client:", "");
        if (reason === null) return;
        cancelButton.disabled = true;
        const message = modalContent.querySelector("[data-assessment-message]");
        if (message) message.textContent = "Cancelling the consultation…";
        try {
            const { data, error } = await lordblessSupabase.rpc("cancel_client_consultation", {
                p_client_id: cancelButton.dataset.clientId,
                p_reason: reason || null
            });
            if (error) throw error;
            const emailMessage = data?.unchanged
                ? "This consultation was already cancelled."
                : await sendConsultationEmail(data?.notification_id);
            await refreshAdminClientAssessment(enquiry, portalState, emailMessage);
        } catch (error) {
            if (message) message.textContent = error?.message || "Unable to cancel the consultation.";
            cancelButton.disabled = false;
        }
    });

    modalContent.querySelectorAll("[data-consultation-email-retry]").forEach(button => {
        button.addEventListener("click", async () => {
            button.disabled = true;
            const message = modalContent.querySelector("[data-assessment-message]");
            if (message) message.textContent = "Retrying email delivery…";
            const result = await sendConsultationEmail(button.dataset.notificationId);
            await refreshAdminClientAssessment(enquiry, portalState, result);
        });
    });
}


async function openAdminEnquiryClient(reference) {
    const enquiry = state.enquiries.find(item =>
        item.reference === reference || item.id === reference
    );
    if (!enquiry || !modalContent || !enquiryModal) return;

    const clientId = getEnquiryClientId(enquiry);
    const canCreate = Boolean(
        isSupabaseClientId(clientId) &&
        state.authUser &&
        getCurrentUser() &&
        hasPermission(getCurrentUser(), "clients.portal_access")
    );

    enquiryModal.dataset.clientDetailsReference = String(reference || "");
    enquiryModal.classList.remove("hidden");
    renderAdminEnquiryClientView(enquiry, {
        loading: Boolean(clientId),
        account: null,
        canCreate,
        canManageAccess: canCreate,
        message: ""
    });

    if (!isSupabaseClientId(clientId)) {
        renderAdminEnquiryClientView(enquiry, {
            error: "This enquiry is not linked to a production client record.",
            canCreate: false,
            account: null
        });
        return;
    }

    try {
        const [account, assessment] = await Promise.all([
            loadClientPortalAccount(clientId),
            loadAdminAssessmentState(clientId)
        ]);
        if (
            enquiryModal.dataset.clientDetailsReference !== String(reference || "") ||
            enquiryModal.classList.contains("hidden")
        ) return;

        renderAdminEnquiryClientView(enquiry, {
            ...assessment,
            account,
            canCreate: canCreate && !account,
            canManageAccess: canCreate,
            canResend: Boolean(canCreate && account?.access_status === "invited"),
            message: ""
        });
    } catch (error) {
        if (
            enquiryModal.dataset.clientDetailsReference !== String(reference || "") ||
            enquiryModal.classList.contains("hidden")
        ) return;

        renderAdminEnquiryClientView(enquiry, {
            error: error?.message || "Unable to load Client Portal access status.",
            canCreate: false,
            account: null
        });
    }
}


function renderAdminJourneyPanel(clientId) {

    const panel = Array.from(
        modalContent.querySelectorAll("[data-client-journey-panel]")
    ).find(item => item.dataset.clientId === clientId);

    if (!panel) return;

    const list = panel.querySelector("[data-client-journey-list]");
    const journeys = state.journeys.filter(item => item.clientId === clientId);

    if (list) {
        if (state.journeyLoadError) {
            list.textContent = `Journeys could not be loaded: ${state.journeyLoadError}`;
        } else if (!journeys.length) {
            list.innerHTML = `<p>No journeys have been assigned yet.</p>`;
        } else {
            list.innerHTML = journeys.map(journey => `
                <article class="client-journey-summary">
                    <strong>${escapeHTML(journey.title)}</strong>
                    <span>${escapeHTML(journey.journeyType)} · ${escapeHTML(journey.status)}</span>
                    <span>${escapeHTML(journey.destination || "—")} · ${escapeHTML(journey.service || "—")}</span>
                    ${journey.internalAssigneeId
                        ? `<span>Internal assignee: ${escapeHTML(state.journeyAssignees.find(item => item.user_id === journey.internalAssigneeId)?.display_name || "Assigned staff member")}</span>`
                        : ""}
                    ${journey.desk
                        ? `<span>Internal team: ${escapeHTML(state.adminIdentity?.desks?.find(item => item.code === journey.desk)?.name || journey.desk)}</span>`
                        : ""}
                </article>
            `).join("");
        }
    }

    const deskSelect = panel.querySelector('[name="desk_id"]');
    if (deskSelect && deskSelect.dataset.optionsLoaded !== "true") {
        for (const desk of state.adminIdentity?.desks || []) {
            const option = document.createElement("option");
            option.value = desk.id;
            option.textContent = desk.name || desk.code;
            deskSelect.appendChild(option);
        }
        deskSelect.dataset.optionsLoaded = "true";
    }

    const assigneeSelect = panel.querySelector('[name="internal_assignee_id"]');
    if (assigneeSelect && assigneeSelect.dataset.optionsLoaded !== "true") {
        for (const staff of state.journeyAssignees) {
            const option = document.createElement("option");
            option.value = staff.user_id;
            option.textContent = staff.display_name || "Staff member";
            assigneeSelect.appendChild(option);
        }
        assigneeSelect.dataset.optionsLoaded = "true";
    }

    const form = panel.querySelector("[data-client-journey-form]");
    if (!form || form.dataset.bound === "true") return;

    form.dataset.bound = "true";
    form.addEventListener("submit", async event => {
        event.preventDefault();

        const submit = form.querySelector('[type="submit"]');
        const message = panel.querySelector("[data-client-journey-message]");
        const fields = new FormData(form);
        const payload = {
            client_id: clientId,
            enquiry_id: panel.dataset.enquiryId || null,
            journey_type: String(fields.get("journey_type") || "").trim(),
            title: String(fields.get("title") || "").trim(),
            destination: String(fields.get("destination") || "").trim(),
            service: String(fields.get("service") || "").trim(),
            status: String(fields.get("status") || "planning"),
            internal_assignee_id: String(fields.get("internal_assignee_id") || "") || null,
            desk_id: String(fields.get("desk_id") || "") || null
        };

        if (submit) submit.disabled = true;
        if (message) message.textContent = "Saving Journey…";

        try {
            const { data, error } = await lordblessSupabase
                .from("client_journeys")
                .insert(payload)
                .select("id, client_id, enquiry_id, journey_type, title, destination, service, status, created_at, updated_at")
                .single();

            if (error) throw error;

            const created = mapSupabaseJourney({
                ...data,
                internal_assignee_id: payload.internal_assignee_id,
                desk_id: payload.desk_id
            });
            state.journeys = [
                ...state.journeys.filter(item => item.id !== created.id),
                created
            ];
            form.reset();
            if (message) message.textContent = "Journey created.";
            renderAdminJourneyPanel(clientId);
        } catch (error) {
            if (message) message.textContent = error?.message || String(error);
        } finally {
            if (submit) submit.disabled = false;
        }
    });

}


function openEnquiry(
    reference
) {

    const enquiry =
        state.enquiries.find(
            item =>
                item.reference ===
                reference
        );


    if (!enquiry) {

        return;

    }


    renderEnquiryDetail(
    modalContent,
    enquiry,
    enquiry.client || null
);

    enquiryModal.classList.remove(
        "hidden"
    );

    if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(enquiry.client?.id || ""))
    ) {
        void Promise.all([
            loadAdminJourneys(enquiry.client.id),
            loadAdminJourneyAssignees()
        ]).then(() => renderAdminJourneyPanel(enquiry.client.id));
    }

    const portalAccessButton =
        modalContent.querySelector(
            '[data-enquiry-action="create-client-access"]'
        );

    if (portalAccessButton) {
        portalAccessButton.addEventListener("click", async () => {
            const clientId = portalAccessButton.dataset.clientId;
            const message = modalContent.querySelector(
                "[data-enquiry-action-message]"
            );

            portalAccessButton.disabled = true;
            if (message) message.textContent = "Creating Client Portal access…";

            try {
                const result = await requestClientPortalAccess(clientId);
                if (message) {
                    message.textContent = result?.already_linked
                        ? "This client already has linked Client Portal access."
                        : result?.existing_auth_user_linked
                            ? "The existing Auth account was linked to this client; no duplicate identity was created."
                            : "Client Portal invitation created successfully.";
                }
                portalAccessButton.textContent = "Portal Access Linked";
            } catch (error) {
                if (message) {
                    message.textContent =
                        error?.message || "Unable to create Client Portal access.";
                }
                portalAccessButton.disabled = false;
            }
        });
    }

    const initialAssessmentPaymentButton =
        modalContent.querySelector(
            '[data-enquiry-action="request-initial-assessment-payment"]'
        );

    if (initialAssessmentPaymentButton) {
        initialAssessmentPaymentButton.addEventListener("click", () => {
            if (
                !window.LORDBLESS_PAYMENT_REQUEST ||
                typeof window.LORDBLESS_PAYMENT_REQUEST.render !== "function"
            ) {
                window.alert("Payment Request engine is not available.");
                return;
            }

            closeEnquiryModal();
            window.LORDBLESS_PAYMENT_REQUEST.render(
                document.body,
                enquiry.client,
                null,
                {
                    purpose: "initial_assessment_consultation",
                    initialAssessment: true,
                    currency: "GHS",
                    databaseAssessment: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        String(enquiry.client?.id || "")
                    )
                }
            );
        });
    }


    initialiseStatusManager(
        enquiry
    );


    initialiseNotes(
        enquiry
    );


    initialiseFollowups(
        enquiry
    );

}

/* =========================================
   TEAM ACCESS INITIALISATION
========================================= */

function initialiseTeamAccess() {

    /*
       Team & Access is now rendered
       dynamically through renderView().
       
       No static event binding is required
       during application startup.
    */

    return;

}


/* =========================================
   PLACEHOLDER
========================================= */

function renderPlaceholder(
    title,
    message
) {

    appContent.innerHTML = `

        <section class="section">

            <div class="empty-state">

                <div class="empty-state-title">
                    ${escapeHTML(title)}
                </div>

                <div class="empty-state-text">
                    ${escapeHTML(message)}
                </div>

            </div>

        </section>

    `;

}


/* =========================================
   STAT CARD
========================================= */

function statCard(
    label,
    value,
    description
) {

    return `

        <div class="stat-card">

            <div class="stat-label">
                ${escapeHTML(label)}
            </div>

            <div class="stat-value">
                ${escapeHTML(
                    String(value)
                )}
            </div>

            <div class="stat-description">
                ${escapeHTML(
                    description
                )}
            </div>

        </div>

    `;

}


/* =========================================
   FORMAT SERVICES
========================================= */

function formatServices(
    services
) {

    if (
        !Array.isArray(services) ||
        !services.length
    ) {

        return "Not provided";

    }


    return services
        .map(
            service =>
                service.replace(
                    /-/g,
                    " "
                )
        )
        .join(", ");

}


/* =========================================
   FORMAT DATE
========================================= */

function formatDate(
    date
) {

    if (!date) {

        return "Not provided";

    }


    return new Date(
        date
    ).toLocaleDateString(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );

}


/* =========================================
   HTML ESCAPING
========================================= */

function escapeHTML(
    value
) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================
   MODAL
========================================= */

function setupModal() {

    if (!closeModal) {

        return;

    }


    closeModal.addEventListener(
        "click",
        closeEnquiryModal
    );


    document
        .querySelector(
            ".modal-backdrop"
        )
        ?.addEventListener(
            "click",
            closeEnquiryModal
        );


    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Escape"
            ) {

                closeEnquiryModal();

            }

        }
    );

}


function closeEnquiryModal() {

    if (!enquiryModal) {

        return;

    }


    enquiryModal.classList.add(
        "hidden"
    );

}


/* =========================================
   DEVELOPMENTadmin/admin.js
========================================= */

console.log(
    "LORDBLESS ADMIN PORTAL: Development UI loaded."
);
