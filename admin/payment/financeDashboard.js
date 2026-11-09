/* ============================================================
   LORDBLESS CONSULTANCY
   FINANCE DASHBOARD
   ------------------------------------------------------------
   Admin / Finance workspace dashboard.

   Current stage:
   - Local / mock data
   - Uses shared payment bridge
   - No Supabase
   - No payment gateway

   Structure:

   Finance Dashboard
        ↓
   Client Account
        ↓
   Payment Requests
        ↓
   Verification
        ↓
   Official Receipt
============================================================ */

(function () {

    "use strict";


    /* =========================================================
       CONSTANTS
    ========================================================= */

    const CURRENCIES = {

        EUR: {
            code: "EUR",
            symbol: "€",
            label: "Euro"
        },

        USD: {
            code: "USD",
            symbol: "$",
            label: "US Dollar"
        },

        GHS: {
            code: "GHS",
            symbol: "GH₵",
            label: "Ghanaian Cedi"
        }

    };


    const STATUS_LABELS = {

        requested: "Requested",
        awaiting_verification: "Awaiting Verification",
        viewed: "Viewed",
        paid: "Paid",
        overdue: "Overdue",
        cancelled: "Cancelled",
        rejected: "Rejected"

    };


    const state = {

        search: "",
        status: "all",
        activeContainer: null

    };

    let paymentRequestProtectionData = null;


    /* =========================================================
       HELPERS
    ========================================================= */

    function escapeHTML(value) {

        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    }


    function formatAmount(
        amount,
        currency
    ) {

        const numeric =
            Number(amount) || 0;

        const config =
            CURRENCIES[currency] ||
            CURRENCIES.EUR;

        return (
            new Intl.NumberFormat(
                "en-GB",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            ).format(numeric)
            +
            " "
            +
            config.symbol
        );

    }


    function formatDate(value) {

        if (!value) {
            return "—";
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return String(value);
        }

        return date.toLocaleDateString(
            "en-GB",
            {
                day: "2-digit",
                month: "short",
                year: "numeric"
            }
        );

    }


    function getStatusLabel(status) {

        return (
            STATUS_LABELS[status] ||
            status ||
            "Unknown"
        );

    }


    /* =========================================================
       DATA
    ========================================================= */

    function getPaymentRequests() {

        let requests = [];

        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof
                window.LORDBLESS_PAYMENT_BRIDGE
                    .load === "function"
        ) {

            const data =
                window.LORDBLESS_PAYMENT_BRIDGE
                    .load();

            requests = Array.isArray(
                data.paymentRequests
            )
                ? data.paymentRequests
                : [];

        } else if (
            Array.isArray(
                window.LORDBLESS_PAYMENT_REQUESTS
            )
        ) {

            requests = window
                .LORDBLESS_PAYMENT_REQUESTS;

        } else if (
            window.LORDBLESS_PAYMENT_REQUEST &&
            typeof
                window.LORDBLESS_PAYMENT_REQUEST
                    .getAll === "function"
        ) {

            requests = window
                .LORDBLESS_PAYMENT_REQUEST
                .getAll();
        }

        const assessmentRequests = Array.isArray(window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY)
            ? window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY
            : [];
        const assessmentClients = new Set(assessmentRequests.flatMap(request => [
            request.clientId,
            request.clientCode,
            request.clientUuid
        ].filter(Boolean).map(String)));
        const assessmentReferences = new Set(assessmentRequests.map(request => String(request.reference || "")).filter(Boolean));

        return [
            ...requests.filter(request => {
                const assessmentLike = request?.purpose === "initial_assessment_consultation" ||
                    request?.requestType === "initial_assessment_consultation" ||
                    /initial assessment.*consultation/i.test(String(request?.description || "")) ||
                    /initial assessment.*consultation/i.test(String(request?.requestType || ""));
                const clientKeys = [request?.clientId, request?.client_id, request?.clientUuid, request?.client_code]
                    .filter(Boolean).map(String);
                return !(assessmentLike && (
                    assessmentReferences.has(String(request?.reference || request?.invoiceNumber || "")) ||
                    clientKeys.some(clientKey => assessmentClients.has(clientKey))
                ));
            }),
            ...assessmentRequests
        ];

    }


    function getClients() {

        if (
            typeof getAdminClients ===
            "function"
        ) {

            return getAdminClients();

        }


        if (
            window.LORDBLESS_ADMIN_ACCESS &&
            typeof
                window.LORDBLESS_ADMIN_ACCESS
                    .getVisibleClients ===
                "function"
        ) {

            return window
                .LORDBLESS_ADMIN_ACCESS
                .getVisibleClients();

        }


        return [];

    }


    function normalisePayment(
        payment
    ) {

        return {

            id:
                payment.id,

            reference:
                payment.reference ||
                payment.invoiceNumber ||
                payment.invoice_number ||
                payment.id,

            clientId:
                payment.clientId ||
                payment.client_id ||
                payment.client?.id ||
                null,

            clientName:
                payment.clientName ||
                payment.client_name ||
                payment.client?.name ||
                "Unknown Client",

            transactionId:
                payment.transactionId ||
                payment.transaction_id ||
                payment.enquiryReference ||
                payment.enquiry_reference ||
                null,

            transactionTitle:
                payment.transactionTitle ||
                payment.transaction_title ||
                payment.enquiryReference ||
                "Journey",

            amount:
                Number(
                    payment.amount ??
                    payment.total ??
                    0
                ),

            currency:
                payment.currency ||
                payment.primaryCurrency ||
                "EUR",

            status:
                String(payment.status || "requested")
                    .trim()
                    .toLowerCase()
                    .replace(/[\s-]+/g, "_"),

            verificationStatus:
                payment.verificationStatus ||
                payment.verification_status ||
                "not_verified",

            invoiceId: payment.invoiceId || payment.invoice_id || null,

            purpose:
                payment.purpose || payment.requestType || null,

            databaseAssessment:
                Boolean(payment.databaseAssessment),

            receiptId:
                payment.receiptId ||
                payment.receipt_id ||
                null,

            dueDate:
                payment.dueDate ||
                payment.due_date ||
                null,

            createdAt:
                payment.createdAt ||
                payment.created_at ||
                null,

            updatedAt:
                payment.updatedAt || payment.updated_at || null,

            cancellationReason:
                payment.cancellationReason || payment.cancellation_reason || "",

            modificationHistory:
                Array.isArray(payment.modificationHistory)
                    ? payment.modificationHistory
                    : []

        };

    }


    function getNormalisedPayments() {

        return getPaymentRequests()
            .map(
                normalisePayment
            );

    }


    /* =========================================================
       CLIENT ACCOUNTS
    ========================================================= */

    function buildClientAccounts() {

        const payments =
            getNormalisedPayments();

        const clients =
            getClients();

        const accounts = {};


        /*
         * First create accounts from
         * registered clients.
         */

        clients.forEach(
            client => {

                if (!client.id) {
                    return;
                }

                accounts[
                    client.id
                ] = {

                    clientId:
                        client.id,

                    clientName:
                        client.name ||
                        client.fullName ||
                        client.clientName ||
                        "Unknown Client",

                    email:
                        client.email ||
                        "",

                    payments: [],

                    totals: {

                        EUR: {
                            paid: 0,
                            outstanding: 0
                        },

                        USD: {
                            paid: 0,
                            outstanding: 0
                        },

                        GHS: {
                            paid: 0,
                            outstanding: 0
                        }

                    }

                };

            }
        );


        /*
         * Then attach payment requests.
         */

        payments.forEach(
            payment => {

                const clientId =
                    payment.clientId ||
                    "UNKNOWN";


                if (
                    !accounts[clientId]
                ) {

                    accounts[clientId] = {

                        clientId,

                        clientName:
                            payment.clientName ||
                            "Unknown Client",

                        email: "",

                        payments: [],

                        totals: {

                            EUR: {
                                paid: 0,
                                outstanding: 0
                            },

                            USD: {
                                paid: 0,
                                outstanding: 0
                            },

                            GHS: {
                                paid: 0,
                                outstanding: 0
                            }

                        }

                    };

                }


                const account =
                    accounts[clientId];


                account.payments
                    .push(payment);


                const currency =
                    CURRENCIES[
                        payment.currency
                    ]
                        ? payment.currency
                        : "EUR";


                if (
                    payment.status ===
                    "paid"
                ) {

                    account
                        .totals[
                            currency
                        ]
                        .paid +=
                        payment.amount;

                }


                if (
                    [
                        "requested",
                        "awaiting_verification",
                        "viewed",
                        "overdue"
                    ].includes(
                        payment.status
                    )
                ) {

                    account
                        .totals[
                            currency
                        ]
                        .outstanding +=
                        payment.amount;

                }

            }
        );


        return Object.values(
            accounts
        );

    }


    /* =========================================================
       TOTALS
    ========================================================= */

    function calculateTotals(
        payments
    ) {

        const totals = {

            EUR: {
                paid: 0,
                outstanding: 0
            },

            USD: {
                paid: 0,
                outstanding: 0
            },

            GHS: {
                paid: 0,
                outstanding: 0
            }

        };


        payments.forEach(
            payment => {

                const currency =
                    CURRENCIES[
                        payment.currency
                    ]
                        ? payment.currency
                        : "EUR";


                if (
                    payment.status ===
                    "paid"
                ) {

                    totals[
                        currency
                    ].paid +=
                        payment.amount;

                }


                if (
                    [
                        "requested",
                        "awaiting_verification",
                        "viewed",
                        "overdue"
                    ].includes(
                        payment.status
                    )
                ) {

                    totals[
                        currency
                    ].outstanding +=
                        payment.amount;

                }

            }
        );


        return totals;

    }


    /* =========================================================
       SUMMARY
    ========================================================= */

    function renderSummary(
        payments
    ) {

        const totals =
            calculateTotals(
                payments
            );


        const pending =
            payments.filter(
                payment =>
                    [
                        "requested",
                        "awaiting_verification",
                        "viewed",
                        "overdue"
                    ].includes(
                        payment.status
                    )
            ).length;


        const verified =
            payments.filter(
                payment =>
                    payment.verificationStatus ===
                    "verified"
            ).length;


        return `

            <div class="lbc-finance-summary">

                <div class="lbc-finance-summary-card">

                    <span>
                        CLIENTS
                    </span>

                    <strong>
                        ${buildClientAccounts().length}
                    </strong>

                </div>


                <div class="lbc-finance-summary-card">

                    <span>
                        PAID
                    </span>

                    <strong>
                        ${formatCurrencySummary(
                            totals,
                            "paid"
                        )}
                    </strong>

                </div>


                <div class="lbc-finance-summary-card">

                    <span>
                        OUTSTANDING
                    </span>

                    <strong>
                        ${formatCurrencySummary(
                            totals,
                            "outstanding"
                        )}
                    </strong>

                </div>


                <div class="lbc-finance-summary-card">

                    <span>
                        PENDING
                    </span>

                    <strong>
                        ${pending}
                    </strong>

                </div>


                <div class="lbc-finance-summary-card">

                    <span>
                        VERIFIED
                    </span>

                    <strong>
                        ${verified}
                    </strong>

                </div>

            </div>

        `;

    }


    function formatCurrencySummary(
        totals,
        field
    ) {

        const parts = [];


        ["EUR", "USD", "GHS"]
            .forEach(
                currency => {

                    const value =
                        totals[
                            currency
                        ][field];

                    if (
                        value > 0
                    ) {

                        parts.push(
                            formatAmount(
                                value,
                                currency
                            )
                        );

                    }

                }
            );


        return parts.length
            ? parts.join(" · ")
            : "€0.00";

    }


    /* =========================================================
       TOOLBAR
    ========================================================= */

    function renderToolbar() {

        return `

            <div class="lbc-finance-toolbar">

                <div>

                    <input
                        type="search"
                        id="lbc-finance-client-search"
                        placeholder="Search clients..."
                        value="${escapeHTML(
                            state.search
                        )}"
                    >

                </div>


                <div>

                    <select
                        id="lbc-finance-status-filter"
                    >

                        <option
                            value="all"
                        >
                            All statuses
                        </option>

                        <option
                            value="requested"
                        >
                            Requested
                        </option>

                        <option
                            value="awaiting_verification"
                        >
                            Awaiting verification
                        </option>

                        <option
                            value="viewed"
                        >
                            Viewed
                        </option>

                        <option
                            value="paid"
                        >
                            Paid
                        </option>

                        <option
                            value="overdue"
                        >
                            Overdue
                        </option>

                    </select>

                </div>

            </div>

        `;

    }


    /* =========================================================
       FILTER
    ========================================================= */

    function getFilteredAccounts() {

        let accounts =
            buildClientAccounts();


        const search =
            state.search
                .trim()
                .toLowerCase();


        if (search) {

            accounts =
                accounts.filter(
                    account =>
                        (
                            account.clientName ||
                            ""
                        )
                            .toLowerCase()
                            .includes(search)
                        ||
                        (
                            account.email ||
                            ""
                        )
                            .toLowerCase()
                            .includes(search)
                );

        }


        if (
            state.status !==
            "all"
        ) {

            accounts =
                accounts.filter(
                    account =>
                        account.payments
                            .some(
                                payment =>
                                    payment.status ===
                                    state.status
                            )
                );

        }


        return accounts;

    }


    /* =========================================================
       CLIENT TABLE
    ========================================================= */

    function renderClientTable(
        accounts
    ) {

        if (!accounts.length) {

            return `

                <div class="empty-state">

                    <h3>
                        No client payment accounts
                    </h3>

                    <p>
                        Payment activity will appear here once payment requests are created.
                    </p>

                </div>

            `;

        }


        return `

            <table class="lbc-finance-client-table">

                <thead>

                    <tr>

                        <th>
                            Client
                        </th>

                        <th>
                            Payment Requests
                        </th>

                        <th>
                            Paid
                        </th>

                        <th>
                            Outstanding
                        </th>

                        <th>
                            Status
                        </th>

                        <th>
                        </th>

                    </tr>

                </thead>


                <tbody>

                    ${accounts.map(
                        account => {

                            const pending =
                                account.payments
                                    .filter(
                                        payment =>
                                            [
                                                "requested",
                                                "awaiting_verification",
                                                "viewed",
                                                "overdue"
                                            ].includes(
                                                payment.status
                                            )
                                    )
                                    .length;


                            const paid =
                                account.payments
                                    .filter(
                                        payment =>
                                            payment.status ===
                                            "paid"
                                    )
                                    .length;


                            return `

                                <tr>

                                    <td>

                                        <strong>
                                            ${escapeHTML(
                                                account.clientName
                                            )}
                                        </strong>

                                        ${
                                            account.email
                                                ? `
                                                    <small>
                                                        ${escapeHTML(
                                                            account.email
                                                        )}
                                                    </small>
                                                `
                                                : ""
                                        }

                                    </td>


                                    <td>
                                        ${account.payments.length}
                                    </td>


                                    <td>

                                        ${renderAccountAmounts(
                                            account,
                                            "paid"
                                        )}

                                    </td>


                                    <td>

                                        ${renderAccountAmounts(
                                            account,
                                            "outstanding"
                                        )}

                                    </td>


                                    <td>

                                        ${
                                            pending
                                                ? `
                                                    <span class="lbc-finance-status pending">
                                                        ${pending} pending
                                                    </span>
                                                `
                                                : paid
                                                    ? `
                                                        <span class="lbc-finance-status paid">
                                                            ${paid} paid
                                                        </span>
                                                    `
                                                    : `
                                                        <span class="lbc-finance-status">
                                                            No activity
                                                        </span>
                                                    `
                                        }

                                    </td>


                                    <td>

                                        <button
                                            type="button"
                                            class="lbc-btn lbc-btn-secondary"
                                            data-finance-client="${escapeHTML(
                                                account.clientId
                                            )}"
                                        >
                                            View
                                        </button>

                                    </td>

                                </tr>

                            `;

                        }
                    ).join("")}

                </tbody>

            </table>

        `;

    }


    function renderAccountAmounts(
        account,
        field
    ) {

        const parts = [];


        ["EUR", "USD", "GHS"]
            .forEach(
                currency => {

                    const value =
                        account
                            .totals[
                                currency
                            ][field];


                    if (
                        value > 0
                    ) {

                        parts.push(
                            formatAmount(
                                value,
                                currency
                            )
                        );

                    }

                }
            );


        return parts.length
            ? parts.join("<br>")
            : "—";

    }


    /* =========================================================
       CLIENT DETAIL
    ========================================================= */

    function openClient(
        clientId
    ) {

        paymentRequestProtectionData = window.LORDBLESS_PAYMENT_BRIDGE?.load?.() || null;

        const account =
            buildClientAccounts()
                .find(
                    item =>
                        String(
                            item.clientId
                        ) ===
                        String(clientId)
                );


        if (!account) {
            return;
        }


        const overlay =
            document.createElement(
                "div"
            );


        overlay.className =
            "lbc-finance-payment-detail-overlay";


        overlay.innerHTML = `

            <div
                class="lbc-finance-payment-detail-backdrop"
            ></div>


            <div
                class="lbc-finance-payment-detail"
            >

                <div
                    class="lbc-finance-payment-detail-header"
                >

                    <div>

                        <span>
                            CLIENT ACCOUNT
                        </span>

                        <h2>
                            ${escapeHTML(
                                account.clientName
                            )}
                        </h2>

                        ${
                            account.email
                                ? `
                                    <p>
                                        ${escapeHTML(
                                            account.email
                                        )}
                                    </p>
                                `
                                : ""
                        }

                    </div>


                    <button
                        type="button"
                        class="lbc-finance-payment-detail-close"
                    >
                        ×
                    </button>

                </div>


                <div
                    class="lbc-finance-client-payment-list"
                >

                    ${
                        account.payments.length
                            ? account.payments
                                .map(
                                    payment =>
                                        renderPaymentRow(
                                            payment
                                        )
                                )
                                .join("")
                            : `
                                <div class="empty-state">

                                    <h3>
                                        No payment activity
                                    </h3>

                                    <p>
                                        No payment requests have been created for this client.
                                    </p>

                                </div>
                            `
                    }

                </div>


                <div
                    class="lbc-finance-detail-actions"
                >

                    <button
                        type="button"
                        class="lbc-btn lbc-btn-primary"
                        data-finance-close-payment
                    >
                        Close
                    </button>

                </div>

            </div>

        `;


        document.body.appendChild(
            overlay
        );


        function close() {

            overlay.remove();

        }


        overlay
            .querySelector(
                ".lbc-finance-payment-detail-close"
            )
            .addEventListener(
                "click",
                close
            );


        overlay
            .querySelector(
                ".lbc-finance-payment-detail-backdrop"
            )
            .addEventListener(
                "click",
                close
            );


        overlay
            .querySelector(
                "[data-finance-close-payment]"
            )
            .addEventListener(
                "click",
                close
            );

        overlay.querySelectorAll("[data-payment-request-edit]").forEach(button => {
            button.addEventListener("click", () => openEditPaymentRequest(button.dataset.paymentRequestEdit, close));
        });

        overlay.querySelectorAll("[data-payment-request-cancel]").forEach(button => {
            button.addEventListener("click", () => cancelPaymentRequest(button.dataset.paymentRequestCancel, close));
        });

    }


    function renderPaymentRow(
        payment
    ) {

        const canManage = canManagePaymentRequests();
        const canChange = canChangePaymentRequest(payment);
        const changes = Array.isArray(payment.modificationHistory)
            ? payment.modificationHistory
            : [];

        return `

            <div
                class="lbc-finance-payment-row"
            >

                <div>

                    <strong>
                        ${escapeHTML(
                            payment.reference
                        )}
                    </strong>

                    <span>
                        ${escapeHTML(
                            payment.transactionTitle
                        )}
                    </span>

                    ${payment.cancellationReason ? `
                        <small class="lbc-finance-request-cancellation">
                            Cancellation reason: ${escapeHTML(payment.cancellationReason)}
                        </small>
                    ` : ""}

                    ${changes.length ? `
                        <details class="lbc-finance-request-history">
                            <summary>${changes.length} recorded change${changes.length === 1 ? "" : "s"}</summary>
                            ${changes.slice().reverse().map(renderPaymentRequestChange).join("")}
                        </details>
                    ` : ""}

                </div>


                <div>

                    <strong>
                        ${formatAmount(
                            payment.amount,
                            payment.currency
                        )}
                    </strong>

                    <span>
                        ${escapeHTML(
                            getStatusLabel(
                                payment.status
                            )
                        )}
                    </span>

                </div>


                <div>

                    <small>
                        Created
                        ${formatDate(
                            payment.createdAt
                        )}
                    </small>

                    ${
                        payment.dueDate
                            ? `
                                <small>
                                    Due
                                    ${formatDate(
                                        payment.dueDate
                                    )}
                                </small>
                            `
                            : ""
                    }

                </div>

                ${canManage && canChange ? `
                    <div class="lbc-finance-request-actions">
                        <button type="button" class="lbc-btn lbc-btn-secondary" data-payment-request-edit="${escapeHTML(payment.id)}">Edit</button>
                        <button type="button" class="lbc-btn lbc-btn-danger" data-payment-request-cancel="${escapeHTML(payment.id)}">Cancel</button>
                    </div>
                ` : ""}

            </div>

        `;

    }


    function canManagePaymentRequests() {
        return typeof getCurrentUser === "function" &&
            typeof hasPermission === "function" &&
            hasPermission(getCurrentUser(), "finance.requests");
    }


    function renderPaymentRequestChange(change) {
        const previous = change.previous || {};
        const current = change.current || {};
        const fields = [
            ["Service / journey", "transactionTitle"],
            ["Service details", "service"],
            ["Description", "description"],
            ["Amount", "amount"],
            ["Currency", "currency"],
            ["Due date", "dueDate"],
            ["Payment instructions", "paymentInstructions"],
            ["Status", "status"]
        ];
        const differences = fields.filter(([, key]) =>
            String(previous[key] ?? "") !== String(current[key] ?? "")
        );

        return `
            <p>
                <strong>${escapeHTML(change.action || "Updated")}</strong>
                · ${escapeHTML(formatDate(change.changedAt))}
                ${change.changedByName ? `· ${escapeHTML(change.changedByName)}` : ""}
                ${differences.length ? `<br>${differences.map(([label, key]) => {
                    const oldValue = key === "amount"
                        ? formatAmount(previous[key], previous.currency || "EUR")
                        : previous[key] || "—";
                    const newValue = key === "amount"
                        ? formatAmount(current[key], current.currency || previous.currency || "EUR")
                        : current[key] || "—";
                    return `${escapeHTML(label)}: ${escapeHTML(oldValue)} → ${escapeHTML(newValue)}`;
                }).join("<br>")}` : ""}
                ${change.reason ? `<br>Reason: ${escapeHTML(change.reason)}` : ""}
            </p>
        `;
    }


    function normaliseRequestStatus(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_");
    }


    function getRequestForChange(requestId) {
        const bridge = window.LORDBLESS_PAYMENT_BRIDGE;
        if (!bridge || typeof bridge.getPaymentRequest !== "function") return null;
        return bridge.getPaymentRequest(requestId);
    }


    function getRequestProtection(request) {
        const status = normaliseRequestStatus(request?.status);
        const verification = normaliseRequestStatus(request?.verificationStatus || request?.verification_status);
        const purpose = String(request?.purpose || request?.requestType || "").toLowerCase();

        if (!request || !request.id) return "This payment request is unavailable.";
        if (request.databaseAssessment || purpose === "initial_assessment_consultation" || /initial assessment.*consultation/i.test(purpose)) {
            return "Assessment payment requests are managed by the assessment payment workflow.";
        }
        if (["paid", "verified", "confirmed"].includes(status) || verification === "verified" ||
            request.receiptId || request.receipt_id || request.paidAt || request.paid_at || request.verifiedAt || request.verified_at) {
            return "Paid or receipted requests cannot be changed.";
        }
        if (request.invoiceId || request.invoice_id) {
            return "An invoice is linked to this request, so it cannot be changed through this screen.";
        }
        if (["cancelled", "canceled", "voided", "refunded"].includes(status)) {
            return "This payment request is already closed.";
        }
        if (["pending", "submitted", "payment_pending", "payment_submitted", "client_payment_submitted", "awaiting_verification", "under_review"].includes(status) ||
            ["pending", "submitted", "under_review"].includes(verification)) {
            return "A payment claim is being verified. This request is protected from changes.";
        }

        const bridge = window.LORDBLESS_PAYMENT_BRIDGE;
        const data = paymentRequestProtectionData || bridge?.load?.();
        const linkedRecords = Array.isArray(data?.paymentRecords)
            ? data.paymentRecords.filter(record => String(record.paymentRequestId || record.payment_request_id || "") === String(request.id))
            : [];
        if (linkedRecords.some(record => {
            const recordStatus = normaliseRequestStatus(record.status);
            const recordVerification = normaliseRequestStatus(record.verificationStatus || record.verification_status);
            return !["rejected", "cancelled", "canceled", "voided"].includes(recordStatus) &&
                !["rejected", "cancelled", "canceled"].includes(recordVerification);
        })) {
            return "A payment submission is linked to this request. Resolve its verification before changing the request.";
        }

        const receipts = Array.isArray(data?.receipts) ? data.receipts : [];
        if (receipts.some(receipt =>
            String(receipt.paymentRequestId || receipt.payment_request_id || "") === String(request.id) ||
            String(receipt.paymentRequestReference || receipt.payment_request_reference || "") === String(request.reference || "")
        )) {
            return "A receipt is linked to this request, so it cannot be changed.";
        }

        return "";
    }


    function canChangePaymentRequest(payment) {
        if (!canManagePaymentRequests()) return false;
        return !getRequestProtection(payment);
    }


    function getStaffActor() {
        const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
        return {
            id: user?.id || user?.user_id || user?.userId || null,
            name: user?.name || user?.fullName || user?.full_name || user?.email || "Authorised staff"
        };
    }


    function getRequestSnapshot(request) {
        return {
            clientId: request.clientId || request.client_id || null,
            clientName: request.clientName || request.client_name || "",
            clientEmail: request.clientEmail || request.client_email || "",
            clientCode: request.clientCode || request.client_code || "",
            transactionTitle: request.transactionTitle || request.transaction_title || "",
            service: request.service || "",
            description: request.description || "",
            amount: Number(request.amount ?? request.total ?? 0),
            currency: String(request.currency || request.primaryCurrency || "EUR").toUpperCase(),
            dueDate: request.dueDate || request.due_date || "",
            paymentInstructions: request.paymentInstructions || request.payment_instructions || "",
            status: normaliseRequestStatus(request.status)
        };
    }


    function updateExistingRequestNotification(request, cancelled = false) {
        const bridge = window.LORDBLESS_PAYMENT_BRIDGE;
        if (!bridge || typeof bridge.load !== "function" || typeof bridge.save !== "function") return;

        const data = bridge.load();
        const notification = data.messages.find(message => message && message.id === `NOTIF-${request.id}`);
        if (!notification) return;

        const currency = String(request.currency || "EUR").toUpperCase();
        const amount = Number(request.amount ?? request.total ?? 0);
        let formattedAmount = `${currency} ${amount.toFixed(2)}`;
        try {
            formattedAmount = new Intl.NumberFormat("en-GB", {
                style: "currency", currency, currencyDisplay: "code",
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(amount);
        } catch (error) { /* Keep explicit currency formatting. */ }

        notification.title = cancelled ? "Payment Request Cancelled" : "Payment Request Updated";
        notification.message = cancelled
            ? `Payment request ${request.reference || ""} has been cancelled. No payment is due.`
            : `Payment request ${request.reference || ""} was updated. The current amount is ${formattedAmount}.`;
        notification.amount = amount;
        notification.currency = currency;
        notification.paymentRequestId = request.id;
        notification.paymentRequestReference = request.reference || notification.paymentRequestReference || "";

        if (bridge.save(data)) {
            window.dispatchEvent(new CustomEvent("lordbless:payment-data-updated", {
                detail: { type: "message-created", payload: notification }
            }));
        }
    }


    function saveRequestChange(request, action, reason, updates, closeDetails) {
        if (!canManagePaymentRequests()) {
            window.alert("You are not authorised to manage payment requests.");
            return false;
        }

        paymentRequestProtectionData = window.LORDBLESS_PAYMENT_BRIDGE?.load?.() || null;
        const latest = getRequestForChange(request.id);
        const protection = getRequestProtection(latest);
        if (protection) {
            window.alert(protection);
            return false;
        }

        const bridge = window.LORDBLESS_PAYMENT_BRIDGE;
        if (!bridge || typeof bridge.updatePaymentRequest !== "function") {
            window.alert("The existing payment data bridge is unavailable. No changes were saved.");
            return false;
        }

        const actor = getStaffActor();
        const before = getRequestSnapshot(latest);
        const candidate = {
            ...updates,
            modificationHistory: [
                ...(Array.isArray(latest.modificationHistory) ? latest.modificationHistory : []),
                {
                    action,
                    reason: reason || "",
                    changedAt: new Date().toISOString(),
                    changedBy: actor.id,
                    changedByName: actor.name,
                    previous: before,
                    current: { ...before, ...updates }
                }
            ]
        };

        const saved = bridge.updatePaymentRequest(request.id, candidate);
        if (!saved) {
            window.alert("The payment request could not be saved. Please retry.");
            return false;
        }

        updateExistingRequestNotification(saved, action === "cancelled");
        if (typeof closeDetails === "function") closeDetails();
        handleFinancialChange();
        openClient(saved.clientId || saved.client_id);
        window.alert(action === "cancelled" ? "Payment request cancelled." : "Payment request updated.");
        return true;
    }


    function openEditPaymentRequest(requestId, closeDetails) {
        if (!canManagePaymentRequests()) {
            window.alert("You are not authorised to manage payment requests.");
            return;
        }

        paymentRequestProtectionData = window.LORDBLESS_PAYMENT_BRIDGE?.load?.() || null;
        const request = getRequestForChange(requestId);
        const protection = getRequestProtection(request);
        if (protection) {
            window.alert(protection);
            return;
        }

        const details = getRequestSnapshot(request);
        const openedUpdatedAt = request.updatedAt || request.updated_at || request.createdAt || request.created_at || "";
        const overlay = document.createElement("div");
        overlay.className = "lbc-finance-payment-detail-overlay";
        overlay.innerHTML = `
            <div class="lbc-finance-payment-detail-backdrop"></div>
            <section class="lbc-finance-payment-detail lbc-finance-request-editor" role="dialog" aria-modal="true" aria-labelledby="lbc-finance-request-editor-title">
                <div class="lbc-finance-payment-detail-header">
                    <div><span>EDIT PAYMENT REQUEST</span><h2 id="lbc-finance-request-editor-title">${escapeHTML(request.reference || request.id)}</h2><p>${escapeHTML(details.clientName || "Client")} · ${escapeHTML(details.clientEmail)}</p></div>
                    <button type="button" class="lbc-finance-payment-detail-close" aria-label="Close">×</button>
                </div>
                <p class="lbc-finance-request-identity">Client identity and request reference are fixed to preserve the existing request record.</p>
                <form data-payment-request-edit-form>
                    <label>Service / journey<input name="transactionTitle" maxlength="180" value="${escapeHTML(details.transactionTitle)}"></label>
                    <label>Service details<input name="service" maxlength="180" value="${escapeHTML(details.service)}"></label>
                    <label>Description<textarea name="description" rows="3" maxlength="1000" required>${escapeHTML(details.description)}</textarea></label>
                    <div class="lbc-finance-request-form-grid">
                        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" value="${escapeHTML(details.amount)}" required></label>
                        <label>Currency<select name="currency"><option value="GHS" ${details.currency === "GHS" ? "selected" : ""}>GHS</option><option value="EUR" ${details.currency === "EUR" ? "selected" : ""}>EUR</option><option value="USD" ${details.currency === "USD" ? "selected" : ""}>USD</option></select></label>
                        <label>Due date<input name="dueDate" type="date" value="${escapeHTML(details.dueDate)}"></label>
                    </div>
                    <label>Payment instructions<textarea name="paymentInstructions" rows="3" maxlength="1500">${escapeHTML(details.paymentInstructions)}</textarea></label>
                    <div class="lbc-finance-detail-actions">
                        <button type="button" class="lbc-btn lbc-btn-secondary" data-request-edit-cancel>Cancel</button>
                        <button type="submit" class="lbc-btn lbc-btn-primary">Save changes</button>
                    </div>
                </form>
            </section>`;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector(".lbc-finance-payment-detail-close").addEventListener("click", close);
        overlay.querySelector(".lbc-finance-payment-detail-backdrop").addEventListener("click", close);
        overlay.querySelector("[data-request-edit-cancel]").addEventListener("click", close);
        overlay.querySelector("form").addEventListener("submit", event => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const amount = Number(values.get("amount"));
            const description = String(values.get("description") || "").trim();
            const currency = String(values.get("currency") || "").toUpperCase();
            if (!Number.isFinite(amount) || amount <= 0 || !description || !["GHS", "EUR", "USD"].includes(currency)) {
                window.alert("Enter a valid amount, description and currency.");
                return;
            }

            const latest = getRequestForChange(requestId);
            const latestUpdatedAt = latest?.updatedAt || latest?.updated_at || latest?.createdAt || latest?.created_at || "";
            if (String(latestUpdatedAt) !== String(openedUpdatedAt)) {
                window.alert("This payment request changed while the edit form was open. Reopen it and review the latest saved values.");
                close();
                return;
            }
            const latestProtection = getRequestProtection(latest);
            if (latestProtection) {
                window.alert(latestProtection);
                close();
                return;
            }

            const updates = {
                transactionTitle: String(values.get("transactionTitle") || "").trim(),
                service: String(values.get("service") || "").trim(),
                description,
                amount,
                total: amount,
                currency,
                dueDate: String(values.get("dueDate") || "") || null,
                paymentInstructions: String(values.get("paymentInstructions") || "").trim()
            };
            if (saveRequestChange(latest, "edited", "", updates, close)) close();
        });
    }


    function cancelPaymentRequest(requestId, closeDetails) {
        if (!canManagePaymentRequests()) {
            window.alert("You are not authorised to manage payment requests.");
            return;
        }

        paymentRequestProtectionData = window.LORDBLESS_PAYMENT_BRIDGE?.load?.() || null;
        const request = getRequestForChange(requestId);
        const protection = getRequestProtection(request);
        if (protection) {
            window.alert(protection);
            return;
        }

        const confirmed = window.confirm("Are you sure you want to cancel this payment request? The client will no longer be required to pay this amount. This action will not record a payment or generate a receipt.");
        if (!confirmed) return;

        const reason = window.prompt("Cancellation reason (optional):", "");
        if (reason === null) return;
        const actor = getStaffActor();
        saveRequestChange(request, "cancelled", reason.trim(), {
            status: "cancelled",
            cancelledAt: new Date().toISOString(),
            cancellationReason: reason.trim(),
            cancelledBy: actor.id,
            cancelledByName: actor.name
        }, closeDetails);
    }


    /* =========================================================
       EVENT BINDING
    ========================================================= */

    function bindDashboardEvents(
        container
    ) {

        const search =
            container.querySelector(
                "#lbc-finance-client-search"
            );


        const status =
            container.querySelector(
                "#lbc-finance-status-filter"
            );


        if (search) {

            search.addEventListener(
                "input",
                function (event) {

                    state.search =
                        event.target.value;

                    renderTableOnly();

                }
            );

        }


        if (status) {

            status.value =
                state.status;


            status.addEventListener(
                "change",
                function (event) {

                    state.status =
                        event.target.value;

                    renderTableOnly();

                }
            );

        }


        container
            .querySelectorAll(
                "[data-finance-client]"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        function () {

                            openClient(
                                button.dataset
                                    .financeClient
                            );

                        }
                    );

                }
            );

    }


    function renderTableOnly() {

        if (
            !state.activeContainer
        ) {
            return;
        }


        const table =
            state.activeContainer
                .querySelector(
                    ".lbc-finance-client-table-wrap"
                );


        if (!table) {
            return;
        }


        table.innerHTML =
            renderClientTable(
                getFilteredAccounts()
            );


        bindDashboardEvents(
            state.activeContainer
        );

    }


    /* =========================================================
       MAIN RENDER
    ========================================================= */

    function render(
        container,
        options
    ) {

        if (!container) {

            throw new Error(
                "Finance Dashboard requires a container."
            );

        }


        const opts =
            options || {};


        state.search =
            opts.search || "";


        state.status =
            opts.status || "all";


        state.activeContainer =
            container;

        paymentRequestProtectionData = window.LORDBLESS_PAYMENT_BRIDGE?.load?.() || null;


        const payments =
            getNormalisedPayments();


        const accounts =
            getFilteredAccounts();


        container.innerHTML = `

            <div
                class="lbc-finance-dashboard"
            >

                <div
                    class="lbc-finance-header"
                >

                    <div>

                        <span
                            class="lbc-finance-eyebrow"
                        >
                            FINANCE & ADMINISTRATION
                        </span>

                        <h2>
                            Finance Dashboard
                        </h2>

                        <p>
                            Client-centred payment tracking,
                            verification and receipt records.
                        </p>

                    </div>

                </div>


                ${renderSummary(
                    payments
                )}


                ${renderToolbar()}


                <section
                    class="lbc-finance-client-section"
                >

                    <div
                        class="lbc-finance-section-heading"
                    >

                        <div>

                            <h3>
                                Client Payment Accounts
                            </h3>

                            <span>
                                ${accounts.length}
                                client(s)
                            </span>

                        </div>

                    </div>


                    <div
                        class="lbc-finance-client-table-wrap"
                    >

                        ${renderClientTable(
                            accounts
                        )}

                    </div>

                </section>

            </div>

        `;


        bindDashboardEvents(
            container
        );


        return {

            payments,

            accounts,

            totals:
                calculateTotals(
                    payments
                )

        };

    }


    /* =========================================================
       REFRESH
    ========================================================= */

    function refresh(
        container,
        options
    ) {

        return render(
            container ||
                state.activeContainer,

            options ||
                {}
        );

    }


    /* =========================================================
       DATA CHANGE LISTENERS
    ========================================================= */

    function handleFinancialChange() {

        if (
            state.activeContainer
        ) {

            refresh(
                state.activeContainer
            );

        }

    }


    document.addEventListener(
        "lordbless:payment-request-created",
        handleFinancialChange
    );


    document.addEventListener(
        "lordbless:payment-verified",
        handleFinancialChange
    );


    document.addEventListener(
        "lordbless:receipt-issued",
        handleFinancialChange
    );


    document.addEventListener(
        "lordbless:receipt-voided",
        handleFinancialChange
    );


    /* =========================================================
       PUBLIC API
    ========================================================= */

    window.LORDBLESS_FINANCE_DASHBOARD = {

        render,

        refresh,

        getData:
            function () {

                const payments =
                    getNormalisedPayments();

                return {

                    payments,

                    accounts:
                        buildClientAccounts(),

                    totals:
                        calculateTotals(
                            payments
                        )

                };

            },

        getClientAccounts:
            buildClientAccounts,

        getTotals:
            calculateTotals,

        currencies:
            CURRENCIES,

        statuses:
            STATUS_LABELS,

        formatAmount,

        formatDate

    };


})();
