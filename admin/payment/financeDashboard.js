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
                payment.status ||
                "requested",

            verificationStatus:
                payment.verificationStatus ||
                payment.verification_status ||
                "not_verified",

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
                null

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

    }


    function renderPaymentRow(
        payment
    ) {

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

            </div>

        `;

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
