/* ============================================================
   LORDBLESS CONSULTANCY
   ADMIN PAYMENT HISTORY
   ------------------------------------------------------------
   Admin / Finance reporting layer.

   Responsibilities:
   - Read shared payment data
   - Read payment requests
   - Read verification data
   - Read official receipts
   - Build unified payment history records
   - Render Financial Reports
   - Support search and status filtering
   - Open payment details
   - Refresh automatically when shared payment data changes

   Data architecture:

        PAYMENT REQUEST
              ↓
        PAYMENT VERIFICATION
              ↓
        OFFICIAL RECEIPT
              ↓
        PAYMENT HISTORY / REPORTS

   Shared persistence:
   window.LORDBLESS_PAYMENT_BRIDGE
   ============================================================ */

(function () {

    "use strict";


    /* ============================================================
       CONSTANTS
    ============================================================ */

    const PAYMENT_STATUS = Object.freeze({

        REQUESTED: "requested",
        VIEWED: "viewed",
        PAID: "paid",
        CANCELLED: "cancelled",
        OVERDUE: "overdue",
        REJECTED: "rejected",
        EXPIRED: "expired"

    });


    const VERIFICATION_STATUS = Object.freeze({

        NOT_VERIFIED: "not_verified",
        VERIFIED: "verified",
        REJECTED: "rejected"

    });


    const RECEIPT_STATUS = Object.freeze({

        ACTIVE: "active",
        ISSUED: "issued",
        VOID: "void"

    });


    /* ============================================================
       MODULE STATE
    ============================================================ */

    const state = {

        mode: "admin",

        clientId: null,

        transactionId: null,

        search: "",

        status: "all"

    };


    let activeContext = {

        container: null,

        options: {}

    };


    /* ============================================================
       HTML SAFETY
    ============================================================ */

    function escapeHTML(value) {

        return String(value == null ? "" : value)

            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    }


    /* ============================================================
       DATE HELPERS
    ============================================================ */

    function formatDate(value) {

        if (!value) {

            return "—";

        }


        const date = new Date(value);


        if (Number.isNaN(date.getTime())) {

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


    function formatDateTime(value) {

        if (!value) {

            return "—";

        }


        const date = new Date(value);


        if (Number.isNaN(date.getTime())) {

            return String(value);

        }


        return date.toLocaleString(

            "en-GB",

            {

                day: "2-digit",

                month: "short",

                year: "numeric",

                hour: "2-digit",

                minute: "2-digit"

            }

        );

    }


    /* ============================================================
       MONEY
    ============================================================ */

    function formatAmount(amount, currency) {

        const value = Number(amount);


        if (!Number.isFinite(value)) {

            return "—";

        }


        const code = currency || "EUR";


        try {

            return new Intl.NumberFormat(

                "en-GB",

                {

                    style: "currency",

                    currency: code,

                    minimumFractionDigits: 2

                }

            ).format(value);

        } catch (error) {

            return `${code} ${value.toFixed(2)}`;

        }

    }


    /* ============================================================
       SHARED BRIDGE
    ============================================================ */

    function getBridge() {

        if (

            window.LORDBLESS_PAYMENT_BRIDGE &&

            typeof window.LORDBLESS_PAYMENT_BRIDGE === "object"

        ) {

            return window.LORDBLESS_PAYMENT_BRIDGE;

        }


        return null;

    }


    /* ============================================================
       PAYMENT REQUESTS
    ============================================================ */

    function mergeDatabaseAssessmentRequests(requests) {
        const databaseRequests = Array.isArray(window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY)
            ? window.LORDBLESS_ASSESSMENT_FINANCE_HISTORY
            : [];
        const databaseClients = new Set(databaseRequests.flatMap(request => [
            String(request.clientId),
            String(request.clientCode || ""),
            String(request.clientUuid || "")
        ]));
        const localRequests = Array.isArray(requests) ? requests : [];
        return [
            ...localRequests.filter(request => !(
                request?.purpose === "initial_assessment_consultation" &&
                databaseClients.has(String(request.clientId))
            )),
            ...databaseRequests
        ];
    }

    function mergeDatabaseAssessmentReceipts(receipts) {
        const databaseReceipts = Array.isArray(window.LORDBLESS_ASSESSMENT_FINANCE_RECEIPTS)
            ? window.LORDBLESS_ASSESSMENT_FINANCE_RECEIPTS
            : [];
        const numbers = new Set(databaseReceipts.map(receipt => String(receipt.receiptNumber)));
        const requestIds = new Set(databaseReceipts.map(receipt => String(receipt.paymentRequestId)));
        return [
            ...(Array.isArray(receipts) ? receipts : []).filter(receipt =>
                !numbers.has(String(receipt?.receiptNumber || receipt?.receipt_number || "")) &&
                !requestIds.has(String(receipt?.paymentRequestId || receipt?.payment_request_id || ""))
            ),
            ...databaseReceipts
        ];
    }

    function getPaymentRequests() {

        const bridge = getBridge();


        /*
         * The shared bridge is authoritative.
         *
         * This is important because the Admin and Client
         * portals need to read the same persisted records.
         */

        if (

            bridge &&

            typeof bridge.getPaymentRequests === "function"

        ) {

            const requests = bridge.getPaymentRequests();


            if (Array.isArray(requests)) {

                return mergeDatabaseAssessmentRequests(requests);

            }

        }


        /*
         * Compatibility with the existing Admin payment
         * request module.
         */

        if (

            window.LORDBLESS_PAYMENT_REQUEST &&

            typeof window.LORDBLESS_PAYMENT_REQUEST.getAll ===
                "function"

        ) {

            const requests =
                window.LORDBLESS_PAYMENT_REQUEST.getAll();


            if (Array.isArray(requests)) {

                return mergeDatabaseAssessmentRequests(requests);

            }

        }


        /*
         * Final legacy fallback.
         */

        if (

            Array.isArray(

                window.LORDBLESS_PAYMENT_REQUESTS

            )

        ) {

            return mergeDatabaseAssessmentRequests(window.LORDBLESS_PAYMENT_REQUESTS);

        }


        return mergeDatabaseAssessmentRequests([]);

    }


    /* ============================================================
       PAYMENT RECORDS
    ============================================================ */

    function getPaymentRecords() {

        const bridge = getBridge();


        if (

            bridge &&

            typeof bridge.getPaymentRecords === "function"

        ) {

            const records =
                bridge.getPaymentRecords();


            if (Array.isArray(records)) {

                return records;

            }

        }


        return [];

    }


    /* ============================================================
       RECEIPTS
    ============================================================ */

    function getReceipts() {

        const bridge = getBridge();


        /*
         * Shared bridge receipts are preferred because these
         * are the persisted Admin ↔ Client receipt records.
         */

        if (

            bridge &&

            typeof bridge.getReceipts === "function"

        ) {

            const receipts =
                bridge.getReceipts();


            if (Array.isArray(receipts)) {

                return mergeDatabaseAssessmentReceipts(receipts);

            }

        }


        /*
         * Compatibility fallback to the receipt generator.
         */

        if (

            window.LORDBLESS_RECEIPT_GENERATOR &&

            typeof window.LORDBLESS_RECEIPT_GENERATOR.getAll ===
                "function"

        ) {

            const receipts =
                window.LORDBLESS_RECEIPT_GENERATOR.getAll();


            if (Array.isArray(receipts)) {

                return mergeDatabaseAssessmentReceipts(receipts);

            }

        }


        /*
         * Legacy fallback.
         */

        if (

            Array.isArray(

                window.LORDBLESS_RECEIPTS

            )

        ) {

            return mergeDatabaseAssessmentReceipts(window.LORDBLESS_RECEIPTS);

        }


        return mergeDatabaseAssessmentReceipts([]);

    }


    /* ============================================================
       PAYMENT REQUEST LOOKUP
    ============================================================ */

    function getPaymentRequestById(requestId) {

        if (!requestId) {

            return null;

        }


        const requests =
            getPaymentRequests();


        return (

            requests.find(

                request =>

                    request &&

                    String(request.id) ===
                        String(requestId)

            ) || null

        );

    }


    /* ============================================================
       PAYMENT RECORD MATCHING
    ============================================================ */

    function findPaymentRecord(request) {

        if (!request) {

            return null;

        }


        const records =
            getPaymentRecords();


        if (!records.length) {

            return null;

        }


        return (

            records.find(

                payment => {

                    if (!payment) {

                        return false;

                    }


                    if (

                        payment.paymentRequestId &&

                        String(payment.paymentRequestId) ===
                            String(request.id)

                    ) {

                        return true;

                    }


                    if (

                        payment.requestId &&

                        String(payment.requestId) ===
                            String(request.id)

                    ) {

                        return true;

                    }


                    if (

                        payment.reference &&

                        payment.reference ===
                            request.reference

                    ) {

                        return true;

                    }


                    if (

                        payment.paymentReference &&

                        request.reference &&

                        payment.paymentReference ===
                            request.reference

                    ) {

                        return true;

                    }


                    return false;

                }

            ) || null

        );

    }


    /* ============================================================
       RECEIPT MATCHING
    ============================================================ */

    function findReceiptForRequest(request) {

        if (!request) {

            return null;

        }


        const receipts =
            getReceipts();


        if (!receipts.length) {

            return null;

        }


        return (

            receipts.find(

                receipt => {

                    if (!receipt) {

                        return false;

                    }


                    if (

                        receipt.paymentRequestId &&

                        String(receipt.paymentRequestId) ===
                            String(request.id)

                    ) {

                        return true;

                    }


                    if (

                        receipt.requestId &&

                        String(receipt.requestId) ===
                            String(request.id)

                    ) {

                        return true;

                    }


                    if (

                        request.receiptId &&

                        String(receipt.id) ===
                            String(request.receiptId)

                    ) {

                        return true;

                    }


                    if (

                        request.receiptNumber &&

                        receipt.receiptNumber ===
                            request.receiptNumber

                    ) {

                        return true;

                    }


                    return false;

                }

            ) || null

        );

    }


    /* ============================================================
       VERIFICATION
    ============================================================ */

    function getVerification(request) {

        if (

            request &&

            request.verification

        ) {

            return request.verification;

        }


        return null;

    }


    /* ============================================================
       STATUS LABELS
    ============================================================ */

    function getStatusLabel(status) {

        const labels = {

            requested: "Requested",

            viewed: "Viewed",

            paid: "Paid",

            cancelled: "Cancelled",

            overdue: "Overdue",

            rejected: "Rejected",

            expired: "Expired"

        };


        return (

            labels[status] ||

            status ||

            "Unknown"

        );

    }


    function getVerificationLabel(status) {

        const labels = {

            not_verified: "Not Verified",

            verified: "Verified",

            rejected: "Rejected"

        };


        return (

            labels[status] ||

            "Not Verified"

        );

    }


    function getReceiptLabel(status) {

        if (

            status === RECEIPT_STATUS.VOID

        ) {

            return "Void";

        }


        if (

            status === RECEIPT_STATUS.ISSUED

        ) {

            return "Issued";

        }


        if (

            status === RECEIPT_STATUS.ACTIVE

        ) {

            return "Active";

        }


        return "Not Issued";

    }


    /* ============================================================
       DERIVE UNIFIED PAYMENT RECORD
    ============================================================ */

    function deriveRecord(request) {

        const verification =
            getVerification(request);


        const receipt =
            findReceiptForRequest(request);


        const paymentRecord =
            findPaymentRecord(request);


        const amount = Number(

            verification &&

            verification.receivedAmount != null

                ? verification.receivedAmount

                : paymentRecord &&

                  paymentRecord.amount != null

                ? paymentRecord.amount

                : request.amount

        ) || 0;


        const currency =

            (

                verification &&

                verification.currency

            ) ||

            (

                paymentRecord &&

                paymentRecord.currency

            ) ||

            request.currency ||

            "EUR";


        const paymentDate =

            (

                verification &&

                (

                    verification.paymentDate ||

                    verification.paidAt

                )

            ) ||

            (

                paymentRecord &&

                (

                    paymentRecord.paymentDate ||

                    paymentRecord.paidAt ||

                    paymentRecord.createdAt

                )

            ) ||

            request.paidAt ||

            null;


        const paymentMethod =

            (

                verification &&

                (

                    verification.method ||

                    verification.paymentMethod

                )

            ) ||

            (

                paymentRecord &&

                (

                    paymentRecord.method ||

                    paymentRecord.paymentMethod

                )

            ) ||

            null;


        const paymentReference =

            (

                verification &&

                (

                    verification.paymentReference ||

                    verification.transactionReference

                )

            ) ||

            (

                paymentRecord &&

                (

                    paymentRecord.paymentReference ||

                    paymentRecord.reference

                )

            ) ||

            null;


        const verificationStatus =

            request.verificationStatus ||

            (

                verification &&

                (

                    verification.status === "verified" ||

                    verification.status === "confirmed"

                )

                    ? VERIFICATION_STATUS.VERIFIED

                    : verification &&

                      verification.status === "rejected"

                    ? VERIFICATION_STATUS.REJECTED

                    : VERIFICATION_STATUS.NOT_VERIFIED

            ) ||

            VERIFICATION_STATUS.NOT_VERIFIED;


        return {

            id:

                request.id ||


                request.reference ||


                (

                    paymentRecord &&

                    paymentRecord.id

                ) ||


                `PAY-${Date.now()}`,


            reference:

                request.reference ||


                request.invoiceNumber ||


                request.invoice_number ||


                (

                    paymentRecord &&

                    (

                        paymentRecord.reference ||

                        paymentRecord.invoiceNumber

                    )

                ) ||


                request.id ||


                "Payment",


            clientId:

                request.clientId ||

                request.client_id ||

                (

                    paymentRecord &&

                    (

                        paymentRecord.clientId ||

                        paymentRecord.client_id

                    )

                ) ||

                null,


            clientName:

                request.clientName ||

                request.client_name ||

                (

                    paymentRecord &&

                    (

                        paymentRecord.clientName ||

                        paymentRecord.client_name

                    )

                ) ||

                "Unknown Client",


            transactionId:

                request.transactionId ||

                request.transaction_id ||

                (

                    paymentRecord &&

                    (

                        paymentRecord.transactionId ||

                        paymentRecord.transaction_id

                    )

                ) ||

                null,


            transactionTitle:

                request.transactionTitle ||

                request.transaction_title ||

                (

                    paymentRecord &&

                    (

                        paymentRecord.transactionTitle ||

                        paymentRecord.transaction_title

                    )

                ) ||

                "Journey",


            destination:

                request.destination ||

                (

                    paymentRecord &&

                    paymentRecord.destination

                ) ||

                "",


            service:

                request.service ||

                (

                    paymentRecord &&

                    paymentRecord.service

                ) ||

                "",


            requestType:

                request.requestType ||

                (

                    paymentRecord &&

                    paymentRecord.requestType

                ) ||

                "other",


            description:

                request.description ||

                (

                    paymentRecord &&

                    paymentRecord.description

                ) ||

                "Payment",


            amount: amount,


            currency: currency,


            requestedDate:

                request.requestedDate ||

                request.createdAt ||

                null,


            dueDate:

                request.dueDate ||

                request.due_date ||

                null,


            status:

                request.status ||

                (

                    paymentRecord &&

                    paymentRecord.status

                ) ||

                PAYMENT_STATUS.REQUESTED,


            verificationStatus:


                verificationStatus,


            verification:


                verification,


            paymentRecord:


                paymentRecord,


            paymentDate:


                paymentDate,


            paymentMethod:


                paymentMethod,


            paymentReference:


                paymentReference,


            verifiedAt:


                request.verifiedAt ||

                (

                    verification &&

                    verification.verifiedAt

                ) ||

                null,


            verifiedBy:


                request.verifiedBy ||

                (

                    verification &&

                    verification.verifiedBy

                ) ||

                null,


            receiptId:


                request.receiptId ||


                (

                    receipt &&

                    receipt.id

                ) ||


                null,


            receiptNumber:


                request.receiptNumber ||


                (

                    receipt &&

                    (

                        receipt.receiptNumber ||

                        receipt.receipt_number

                    )

                ) ||


                null,


            receiptStatus:


                receipt

                    ? (

                        receipt.status ||

                        RECEIPT_STATUS.ACTIVE

                    )

                    : null,


            receipt:


                receipt,


            createdAt:


                request.createdAt ||


                (

                    paymentRecord &&

                    paymentRecord.createdAt

                ) ||


                null,


            updatedAt:


                request.updatedAt ||


                (

                    verification &&

                    verification.updatedAt

                ) ||


                (

                    receipt &&

                    receipt.updatedAt

                ) ||


                request.createdAt ||


                (

                    paymentRecord &&

                    paymentRecord.updatedAt

                ) ||


                null

        };

    }


    /* ============================================================
       HISTORY
    ============================================================ */

    function getHistory(options) {

        const opts =
            options || {};


        const requests =
            getPaymentRequests();


        let records =
            requests

                .filter(Boolean)

                .map(deriveRecord);


        /*
         * Add payment records that do not have a corresponding
         * payment request.
         *
         * This protects the reports layer from losing valid
         * payment records if a payment record was created
         * independently.
         */

        const paymentRecords =
            getPaymentRecords();


        paymentRecords.forEach(

            payment => {

                if (!payment) {

                    return;

                }


                const alreadyExists =
                    records.some(

                        record =>

                            (

                                payment.paymentRequestId &&

                                String(

                                    record.id

                                ) ===

                                String(

                                    payment.paymentRequestId

                                )

                            ) ||


                            (

                                payment.requestId &&

                                String(

                                    record.id

                                ) ===

                                String(

                                    payment.requestId

                                )

                            ) ||


                            (

                                payment.reference &&

                                record.reference ===

                                payment.reference

                            )

                    );


                if (alreadyExists) {

                    return;

                }


                const syntheticRequest = {

                    id:

                        payment.paymentRequestId ||

                        payment.requestId ||

                        payment.id,


                    reference:

                        payment.reference ||

                        payment.invoiceNumber ||

                        payment.id,


                    clientId:

                        payment.clientId ||

                        payment.client_id ||

                        null,


                    clientName:

                        payment.clientName ||

                        payment.client_name ||

                        "Unknown Client",


                    transactionId:

                        payment.transactionId ||

                        payment.transaction_id ||

                        null,


                    transactionTitle:

                        payment.transactionTitle ||

                        payment.transaction_title ||

                        "Journey",


                    description:

                        payment.description ||

                        "Payment",


                    amount:

                        payment.amount ||

                        payment.total ||

                        0,


                    currency:

                        payment.currency ||

                        "EUR",


                    status:

                        payment.status ||

                        PAYMENT_STATUS.PAID,


                    verificationStatus:

                        payment.verificationStatus ||

                        VERIFICATION_STATUS.VERIFIED,


                    verification:

                        payment.verification || null,


                    receiptId:

                        payment.receiptId ||

                        null,


                    receiptNumber:

                        payment.receiptNumber ||

                        null,


                    createdAt:

                        payment.createdAt ||

                        null,


                    updatedAt:

                        payment.updatedAt ||

                        payment.createdAt ||

                        null

                };


                records.push(

                    deriveRecord(

                        syntheticRequest

                    )

                );

            }

        );


        /*
         * Client filter
         */

        if (opts.clientId) {

            records =
                records.filter(

                    record =>

                        String(

                            record.clientId || ""

                        ) ===

                        String(

                            opts.clientId

                        )

                );

        }


        /*
         * Journey / transaction filter
         */

        if (opts.transactionId) {

            records =
                records.filter(

                    record =>

                        String(

                            record.transactionId || ""

                        ) ===

                        String(

                            opts.transactionId

                        )

                );

        }


        /*
         * Status filter
         */

        if (

            opts.status &&

            opts.status !== "all"

        ) {

            records =
                records.filter(

                    record =>

                        record.status ===

                        opts.status

                );

        }


        /*
         * Search
         */

        const search = String(

            opts.search || ""

        )

            .trim()

            .toLowerCase();


        if (search) {

            records =
                records.filter(

                    record =>

                        [

                            record.reference,

                            record.clientId,

                            record.clientName,

                            record.transactionId,

                            record.transactionTitle,

                            record.destination,

                            record.service,

                            record.description,

                            record.receiptNumber,

                            record.paymentReference

                        ].some(

                            value =>

                                String(

                                    value || ""

                                )

                                    .toLowerCase()

                                    .includes(search)

                        )

                );

        }


        /*
         * Most recently updated first.
         */

        records.sort(

            (a, b) =>

                new Date(

                    b.updatedAt || 0

                ).getTime() -

                new Date(

                    a.updatedAt || 0

                ).getTime()

        );


        return records;

    }


    /* ============================================================
       FILTER HELPERS
    ============================================================ */

    function getClientHistory(

        clientId,

        options

    ) {

        return getHistory(

            Object.assign(

                {},

                options || {},

                {

                    clientId:

                        clientId

                }

            )

        );

    }


    function getJourneyHistory(

        transactionId,

        options

    ) {

        return getHistory(

            Object.assign(

                {},

                options || {},

                {

                    transactionId:

                        transactionId

                }

            )

        );

    }


    /* ============================================================
       SUMMARY
    ============================================================ */

    function getSummary(records) {

        const list =

            Array.isArray(records)

                ? records

                : [];


        const summary = {

            totalRequests: 0,


            totalCount: 0,


            paidCount: 0,


            outstandingCount: 0,


            verifiedCount: 0,


            receiptCount: 0,


            voidReceiptCount: 0,


            rejectedCount: 0,


            currencies: {}

        };


        list.forEach(

            record => {

                summary.totalRequests += 1;

                summary.totalCount += 1;


                if (

                    record.status ===

                    PAYMENT_STATUS.PAID

                ) {

                    summary.paidCount += 1;

                }


                if (

                    [

                        PAYMENT_STATUS.REQUESTED,

                        PAYMENT_STATUS.VIEWED,

                        PAYMENT_STATUS.OVERDUE

                    ].includes(

                        record.status

                    )

                ) {

                    summary.outstandingCount += 1;

                }


                if (

                    record.status ===

                    PAYMENT_STATUS.REJECTED

                ) {

                    summary.rejectedCount += 1;

                }


                if (

                    record.verificationStatus ===

                    VERIFICATION_STATUS.VERIFIED

                ) {

                    summary.verifiedCount += 1;

                }


                if (

                    record.receiptNumber

                ) {

                    summary.receiptCount += 1;

                }


                if (

                    record.receiptStatus ===

                    RECEIPT_STATUS.VOID

                ) {

                    summary.voidReceiptCount += 1;

                }


                const currency =

                    record.currency ||

                    "EUR";


                if (

                    !summary.currencies[

                        currency

                    ]

                ) {

                    summary.currencies[

                        currency

                    ] = {

                        count: 0,

                        amount: 0,

                        paidAmount: 0,

                        outstandingAmount: 0

                    };

                }


                summary.currencies[

                    currency

                ].count += 1;


                summary.currencies[

                    currency

                ].amount +=

                    Number(

                        record.amount

                    ) || 0;


                if (

                    record.status ===

                    PAYMENT_STATUS.PAID

                ) {

                    summary.currencies[

                        currency

                    ].paidAmount +=

                        Number(

                            record.amount

                        ) || 0;

                }


                if (

                    [

                        PAYMENT_STATUS.REQUESTED,

                        PAYMENT_STATUS.VIEWED,

                        PAYMENT_STATUS.OVERDUE

                    ].includes(

                        record.status

                    )

                ) {

                    summary.currencies[

                        currency

                    ].outstandingAmount +=

                        Number(

                            record.amount

                        ) || 0;

                }

            }

        );


        return summary;

    }


    /* ============================================================
       SUMMARY CURRENCY DISPLAY
    ============================================================ */

    function formatCurrencyBreakdown(summaryKey) {

        const currencies =

            Object.keys(

                summaryKey.currencies || {}

            );


        if (!currencies.length) {

            return "—";

        }


        return currencies

            .sort()

            .map(

                currency =>

                    formatAmount(

                        summaryKey.currencies[

                            currency

                        ].amount,

                        currency

                    )

            )

            .join(" • ");

    }


    /* ============================================================
       SUMMARY RENDERING
    ============================================================ */

    function renderSummary(

        container,

        summary

    ) {

        if (!container) {

            return;

        }


        container.innerHTML = `

            <div class="lbc-payment-history-summary">

                <div class="lbc-payment-history-summary-card">

                    <span>

                        PAYMENT REQUESTS

                    </span>

                    <strong>

                        ${summary.totalCount}

                    </strong>

                    <small>

                        ${summary.verifiedCount}
                        verified

                    </small>

                </div>


                <div class="lbc-payment-history-summary-card">

                    <span>

                        PAID

                    </span>

                    <strong>

                        ${summary.paidCount}

                    </strong>

                    <small>

                        ${escapeHTML(

                            formatCurrencyBreakdown(

                                summary

                            )

                        )}

                    </small>

                </div>


                <div class="lbc-payment-history-summary-card">

                    <span>

                        OUTSTANDING

                    </span>

                    <strong>

                        ${summary.outstandingCount}

                    </strong>

                </div>


                <div class="lbc-payment-history-summary-card">

                    <span>

                        OFFICIAL RECEIPTS

                    </span>

                    <strong>

                        ${summary.receiptCount}

                    </strong>

                    <small>

                        ${summary.voidReceiptCount}

                        void

                    </small>

                </div>

            </div>

        `;

    }


    /* ============================================================
       FILTERS
    ============================================================ */

    function renderFilters(

        container

    ) {

        if (!container) {

            return;

        }


        container.innerHTML = `

            <div class="lbc-payment-history-toolbar">

                <input

                    type="search"

                    id="lbc-payment-history-search"

                    placeholder="Search client, payment, journey or receipt..."

                    value="${escapeHTML(

                        state.search

                    )}"

                >


                <select

                    id="lbc-payment-history-status"

                >

                    <option value="all">

                        All statuses

                    </option>

                    <option value="requested">

                        Requested

                    </option>

                    <option value="viewed">

                        Viewed

                    </option>

                    <option value="paid">

                        Paid

                    </option>

                    <option value="overdue">

                        Overdue

                    </option>

                    <option value="rejected">

                        Rejected

                    </option>

                    <option value="cancelled">

                        Cancelled

                    </option>

                </select>

            </div>

        `;


        const searchInput =

            container.querySelector(

                "#lbc-payment-history-search"

            );


        const statusInput =

            container.querySelector(

                "#lbc-payment-history-status"

            );


        if (statusInput) {

            statusInput.value =

                state.status;

        }


        if (searchInput) {

            searchInput.addEventListener(

                "input",

                function (event) {

                    state.search =

                        event.target.value;


                    renderTable();

                }

            );

        }


        if (statusInput) {

            statusInput.addEventListener(

                "change",

                function (event) {

                    state.status =

                        event.target.value;


                    renderTable();

                }

            );

        }

    }


    /* ============================================================
       TABLE ROW
    ============================================================ */

    function renderRow(

        record

    ) {

        return `

            <tr>

                <td>

                    <button

                        type="button"

                        class="lbc-payment-history-reference"

                        data-payment-history-view="${escapeHTML(

                            record.id

                        )}"

                    >

                        ${escapeHTML(

                            record.reference

                        )}

                    </button>


                    <small>

                        ${escapeHTML(

                            record.description

                        )}

                    </small>

                </td>


                <td>

                    <strong>

                        ${escapeHTML(

                            record.clientName

                        )}

                    </strong>


                    <small>

                        ${escapeHTML(

                            record.transactionTitle

                        )}

                    </small>

                </td>


                <td>

                    <strong>

                        ${escapeHTML(

                            formatAmount(

                                record.amount,

                                record.currency

                            )

                        )}

                    </strong>

                </td>


                <td>

                    <span

                        class="lbc-payment-history-status lbc-payment-history-status-${escapeHTML(

                            record.status

                        )}"

                    >

                        ${escapeHTML(

                            getStatusLabel(

                                record.status

                            )

                        )}

                    </span>

                </td>


                <td>

                    ${escapeHTML(

                        getVerificationLabel(

                            record.verificationStatus

                        )

                    )}

                </td>


                <td>

    ${record.receiptNumber
        ? `

            <button
                type="button"
                class="lbc-payment-history-receipt-number"
                data-payment-history-receipt="${escapeHTML(
                    record.id
                )}"
                title="View official receipt"
            >

                ${escapeHTML(
                    record.receiptNumber
                )}

            </button>

        `
        : `

            <span>
                Not issued
            </span>

        `
    }

</td>


                <td>

                    ${escapeHTML(

                        formatDate(

                            record.updatedAt ||

                            record.createdAt

                        )

                    )}

                </td>

            </tr>

        `;

    }


    /* ============================================================
       TABLE RENDER
    ============================================================ */

    function renderTable() {

        const root =

            activeContext.container;


        if (!root) {

            return;

        }


        const options =

            activeContext.options || {};


        const records =

            getHistory({

                clientId:

                    options.clientId ||

                    state.clientId,


                transactionId:

                    options.transactionId ||

                    state.transactionId,


                search:

                    state.search,


                status:

                    state.status

            });


        const tableContainer =

            root.querySelector(

                ".lbc-payment-history-table-wrap"

            );


        if (!tableContainer) {

            return;

        }


        /*
         * Update summary every time filters change.
         */

        const summaryContainer =

            root.querySelector(

                ".lbc-payment-history-summary-wrap"

            );


        if (summaryContainer) {

            renderSummary(

                summaryContainer,

                getSummary(records)

            );

        }


        if (!records.length) {

            tableContainer.innerHTML = `

                <div

                    class="lbc-payment-history-empty"

                >

                    <strong>

                        No payment records found.

                    </strong>


                    <span>

                        Payment requests and verified
                        payments will appear here.

                    </span>

                </div>

            `;


            return;

        }


        tableContainer.innerHTML = `

            <div

                class="lbc-payment-history-table-scroll"

            >

                <table

                    class="lbc-payment-history-table"

                >

                    <thead>

                        <tr>

                            <th>

                                Payment

                            </th>


                            <th>

                                Client / Journey

                            </th>


                            <th>

                                Amount

                            </th>


                            <th>

                                Status

                            </th>


                            <th>

                                Verification

                            </th>


                            <th>

                                Receipt

                            </th>


                            <th>

                                Updated

                            </th>

                        </tr>

                    </thead>


                    <tbody>

                        ${records

                            .map(

                                renderRow

                            )

                            .join("")}

                    </tbody>

                </table>

            </div>

        `;


        tableContainer

            .querySelectorAll(

                "[data-payment-history-view]"

            )

            .forEach(

                button => {

                    button.addEventListener(

                        "click",

                        function () {

                            const recordId =

                                button.getAttribute(

                                    "data-payment-history-view"

                                );


                            const record =

                                records.find(

                                    item =>

                                        String(

                                            item.id

                                        ) ===

                                        String(

                                            recordId

                                        )

                                );


                            if (record) {

                                openDetail(

                                    record

                                );

                            }

                        }

                    );

                }

            );


        /* ============================================================
           OFFICIAL RECEIPT CLICK
        ============================================================ */

        tableContainer
            .querySelectorAll(
                "[data-payment-history-receipt]"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        function () {

                            const recordId =
                                button.getAttribute(
                                    "data-payment-history-receipt"
                                );

                            const record =
                                records.find(
                                    item =>
                                        String(
                                            item.id
                                        ) ===
                                        String(
                                            recordId
                                        )
                                );


                            if (
                                record &&
                                record.receipt
                            ) {

                                openReceiptPreview(
                                    record.receipt
                                );

                            }

                        }
                    );

                }
            );

    }


/* ============================================================
   OFFICIAL RECEIPT PREVIEW
============================================================ */

function openReceiptPreview(
    receipt
) {

    if (!receipt) {
        return;
    }


    /*
     * Close any existing payment-history
     * detail/receipt overlay first.
     */

    const old =
        document.querySelector(
            ".lbc-payment-history-detail-overlay"
        );

    if (old) {
        old.remove();
    }


    /*
     * Create the same overlay structure
     * already used by Payment History.
     */

    const overlay =
        document.createElement(
            "div"
        );

    overlay.className =
        "lbc-payment-history-detail-overlay";


    overlay.innerHTML = `

        <div
            class="lbc-payment-history-detail-backdrop"
        ></div>


        <div
            class="lbc-payment-history-detail-panel"
        >

            <button
                type="button"
                class="lbc-payment-history-detail-close"
                aria-label="Close official receipt"
            >
                ×
            </button>


            <div
                class="lbc-payment-history-detail-header"
            >

                <span>
                    OFFICIAL RECEIPT
                </span>

                <h3>
                    ${escapeHTML(
                        receipt.receiptNumber ||
                        "Payment Receipt"
                    )}
                </h3>

                <p>
                    LORDBLESS CONSULTANCY
                </p>

            </div>


            <div
                class="lbc-payment-history-receipt-preview"
            ></div>


            <div
                class="lbc-payment-history-detail-actions"
            >

                <button
                    type="button"
                    class="lbc-btn lbc-btn-primary"
                    data-payment-history-receipt-close
                >
                    Close
                </button>

            </div>

        </div>

    `;


    document.body.appendChild(
        overlay
    );


    /*
     * Use the EXISTING official receipt
     * renderer.
     *
     * We are NOT rebuilding the receipt here.
     */

    const previewContainer =
        overlay.querySelector(
            ".lbc-payment-history-receipt-preview"
        );


    if (
        window.LORDBLESS_RECEIPT_GENERATOR &&
        typeof
            window.LORDBLESS_RECEIPT_GENERATOR.preview ===
            "function"
    ) {

        window.LORDBLESS_RECEIPT_GENERATOR.preview(
            previewContainer,
            receipt
        );

    } else {

        previewContainer.innerHTML = `

            <div
                class="lbc-payment-history-empty"
            >

                <strong>
                    Receipt preview unavailable.
                </strong>

                <span>
                    The official receipt renderer is not available.
                </span>

            </div>

        `;

    }


    /*
     * Close behaviour.
     */

    const close =
        function () {

            overlay.remove();

        };


    const closeButton =
        overlay.querySelector(
            ".lbc-payment-history-detail-close"
        );


    const backdrop =
        overlay.querySelector(
            ".lbc-payment-history-detail-backdrop"
        );


    const bottomButton =
        overlay.querySelector(
            "[data-payment-history-receipt-close]"
        );


    if (closeButton) {

        closeButton.addEventListener(
            "click",
            close
        );

    }


    if (backdrop) {

        backdrop.addEventListener(
            "click",
            close
        );

    }


    if (bottomButton) {

        bottomButton.addEventListener(
            "click",
            close
        );

    }

}


/* ============================================================
   DETAIL PANEL
============================================================ */

    function openDetail(

        record

    ) {

        const old =

            document.querySelector(

                ".lbc-payment-history-detail-overlay"

            );


        if (old) {

            old.remove();

        }


        const verification =

            record.verification;


        const verificationHTML =

            verification

                ? `

                    <section

                        class="lbc-payment-history-detail-section"

                    >

                        <h4>

                            Payment Verification

                        </h4>


                        <div

                            class="lbc-payment-history-detail-grid"

                        >

                            <div>

                                <span>

                                    Status

                                </span>

                                <strong>

                                    ${escapeHTML(

                                        getVerificationLabel(

                                            record.verificationStatus

                                        )

                                    )}

                                </strong>

                            </div>


                            <div>

                                <span>

                                    Payment Date

                                </span>

                                <strong>

                                    ${escapeHTML(

                                        formatDate(

                                            record.paymentDate

                                        )

                                    )}

                                </strong>

                            </div>


                            <div>

                                <span>

                                    Method

                                </span>

                                <strong>

                                    ${escapeHTML(

                                        record.paymentMethod ||

                                        "—"

                                    )}

                                </strong>

                            </div>


                            <div>

                                <span>

                                    Payment Reference

                                </span>

                                <strong>

                                    ${escapeHTML(

                                        record.paymentReference ||

                                        "—"

                                    )}

                                </strong>

                            </div>


                            <div>

                                <span>

                                    Verified At

                                </span>

                                <strong>

                                    ${escapeHTML(

                                        formatDateTime(

                                            record.verifiedAt

                                        )

                                    )}

                                </strong>

                            </div>


                            <div>

                                <span>

                                    Verified By

                                </span>

                                <strong>

                                    ${escapeHTML(

                                        record.verifiedBy ||

                                        "—"

                                    )}

                                </strong>

                            </div>

                        </div>

                    </section>

                `

                : `

                    <section

                        class="lbc-payment-history-detail-section"

                    >

                        <h4>

                            Payment Verification

                        </h4>


                        <p>

                            This payment has not yet
                            been verified.

                        </p>

                    </section>

                `;


        const receiptHTML =

            record.receiptNumber

                ? `

                    <section

                        class="lbc-payment-history-detail-section"

                    >

                        <h4>

                            Official Receipt

                        </h4>


                        <div

                            class="lbc-payment-history-receipt-box"

                        >

                            <strong>

                                ${escapeHTML(

                                    record.receiptNumber

                                )}

                            </strong>


                            <span>

                                Status:

                                ${escapeHTML(

                                    getReceiptLabel(

                                        record.receiptStatus

                                    )

                                )}

                            </span>


                            <span>

                                Issued:

                                ${escapeHTML(

                                    formatDate(

                                        record.receipt &&

                                        (

                                            record.receipt

                                                .issuedAt ||

                                            record.receipt

                                                .createdAt

                                        )

                                    )

                                )}

                            </span>

                        </div>

                    </section>

                `

                : `

                    <section

                        class="lbc-payment-history-detail-section"

                    >

                        <h4>

                            Official Receipt

                        </h4>


                        <p>

                            No official receipt has been
                            issued yet.

                        </p>

                    </section>

                `;


        const overlay =

            document.createElement(

                "div"

            );


        overlay.className =

            "lbc-payment-history-detail-overlay";


        overlay.innerHTML = `

            <div

                class="lbc-payment-history-detail-backdrop"

            ></div>


            <div

                class="lbc-payment-history-detail-panel"

            >

                <button

                    type="button"

                    class="lbc-payment-history-detail-close"

                    aria-label="Close payment details"

                >

                    ×

                </button>


                <div

                    class="lbc-payment-history-detail-header"

                >

                    <span>

                        PAYMENT RECORD

                    </span>


                    <h3>

                        ${escapeHTML(

                            record.reference

                        )}

                    </h3>


                    <p>

                        ${escapeHTML(

                            record.description ||

                            record.transactionTitle

                        )}

                    </p>

                </div>


                <section

                    class="lbc-payment-history-detail-section"

                >

                    <h4>

                        Payment Request

                    </h4>


                    <div

                        class="lbc-payment-history-detail-grid"

                    >

                        <div>

                            <span>

                                Client

                            </span>

                            <strong>

                                ${escapeHTML(

                                    record.clientName

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Client ID

                            </span>

                            <strong>

                                ${escapeHTML(

                                    record.clientId ||

                                    "—"

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Journey

                            </span>

                            <strong>

                                ${escapeHTML(

                                    record.transactionTitle

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Transaction

                            </span>

                            <strong>

                                ${escapeHTML(

                                    record.transactionId ||

                                    "—"

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Amount

                            </span>

                            <strong>

                                ${escapeHTML(

                                    formatAmount(

                                        record.amount,

                                        record.currency

                                    )

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Currency

                            </span>

                            <strong>

                                ${escapeHTML(

                                    record.currency

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Status

                            </span>

                            <strong>

                                ${escapeHTML(

                                    getStatusLabel(

                                        record.status

                                    )

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Due Date

                            </span>

                            <strong>

                                ${escapeHTML(

                                    formatDate(

                                        record.dueDate

                                    )

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Created

                            </span>

                            <strong>

                                ${escapeHTML(

                                    formatDateTime(

                                        record.createdAt

                                    )

                                )}

                            </strong>

                        </div>


                        <div>

                            <span>

                                Updated

                            </span>

                            <strong>

                                ${escapeHTML(

                                    formatDateTime(

                                        record.updatedAt

                                    )

                                )}

                            </strong>

                        </div>

                    </div>

                </section>


                ${verificationHTML}


                ${receiptHTML}


                <div

                    class="lbc-payment-history-detail-actions"

                >

                    <button

                        type="button"

                        class="lbc-btn lbc-btn-primary"

                        data-payment-history-close

                    >

                        Close

                    </button>

                </div>

            </div>

        `;


        document.body.appendChild(

            overlay

        );


        const close =

            function () {

                overlay.remove();

            };


        const closeButton =

            overlay.querySelector(

                ".lbc-payment-history-detail-close"

            );


        const backdrop =

            overlay.querySelector(

                ".lbc-payment-history-detail-backdrop"

            );


        const bottomButton =

            overlay.querySelector(

                "[data-payment-history-close]"

            );


        if (closeButton) {

            closeButton.addEventListener(

                "click",

                close

            );

        }


        if (backdrop) {

            backdrop.addEventListener(

                "click",

                close

            );

        }


        if (bottomButton) {

            bottomButton.addEventListener(

                "click",

                close

            );

        }

    }


    /* ============================================================
       MAIN RENDER
    ============================================================ */

    function render(

        container,

        options

    ) {

        if (!container) {

            throw new Error(

                "LORDBLESS PAYMENT HISTORY: " +

                "A render container is required."

            );

        }


        const opts =

            options || {};


        state.mode =

            opts.mode ||

            "admin";


        state.clientId =

            opts.clientId ||

            null;


        state.transactionId =

            opts.transactionId ||

            null;


        state.search =

            opts.search ||

            "";


        state.status =

            opts.status ||

            "all";


        activeContext = {

            container: container,

            options: opts

        };


        container.innerHTML = `

            <div

                class="lbc-payment-history"

                data-payment-history-mode="${escapeHTML(

                    state.mode

                )}"

            >

                <div

                    class="lbc-payment-history-header"

                >

                    <div>

                        <span

                            class="lbc-payment-history-eyebrow"

                        >

                            ${state.mode === "client"

                                ? "MY PAYMENTS"

                                : "FINANCE & PAYMENTS"

                            }

                        </span>


                        <h2>

                            Payment History

                        </h2>


                        <p>

                            ${state.mode === "client"

                                ? "View your payment requests, verified payments and official receipts."

                                : "Track payment requests, payment verification and official receipt records."

                            }

                        </p>

                    </div>

                </div>


                <div

                    class="lbc-payment-history-summary-wrap"

                ></div>


                <div

                    class="lbc-payment-history-filters"

                ></div>


                <div

                    class="lbc-payment-history-table-wrap"

                ></div>

            </div>

        `;


        const records =

            getHistory({

                clientId:

                    state.clientId,


                transactionId:

                    state.transactionId,


                search:

                    state.search,


                status:

                    state.status

            });


        renderSummary(

            container.querySelector(

                ".lbc-payment-history-summary-wrap"

            ),

            getSummary(

                records

            )

        );


        renderFilters(

            container.querySelector(

                ".lbc-payment-history-filters"

            )

        );


        renderTable();


        return {

            records: records,

            summary:

                getSummary(

                    records

                )

        };

    }


    /* ============================================================
       REFRESH
    ============================================================ */

    function refresh(

        container,

        options

    ) {

        const target =

            container ||

            activeContext.container;


        if (!target) {

            return null;

        }


        const mergedOptions =

            Object.assign(

                {},

                activeContext.options || {},

                options || {}

            );


        /*
         * Preserve the current interactive filters unless
         * explicit values are passed.
         */

        if (

            options &&

            Object.prototype.hasOwnProperty.call(

                options,

                "search"

            )

        ) {

            state.search =

                options.search || "";

        }


        if (

            options &&

            Object.prototype.hasOwnProperty.call(

                options,

                "status"

            )

        ) {

            state.status =

                options.status || "all";

        }


        mergedOptions.search =

            state.search;


        mergedOptions.status =

            state.status;


        return render(

            target,

            mergedOptions

        );

    }


    /* ============================================================
       ADMIN RENDER
    ============================================================ */

    function renderForAdmin(

        container,

        options

    ) {

        return render(

            container,

            Object.assign(

                {},

                options || {},

                {

                    mode: "admin"

                }

            )

        );

    }


    /* ============================================================
       CLIENT RENDER COMPATIBILITY
    ============================================================ */

    function renderForClient(

        container,

        clientId,

        options

    ) {

        return render(

            container,

            Object.assign(

                {},

                options || {},

                {

                    mode: "client",

                    clientId:

                        clientId

                }

            )

        );

    }


    /* ============================================================
       REFRESH ON DATA CHANGES
    ============================================================ */

    function handleDataChange() {

        if (!activeContext.container) {

            return;

        }


        refresh();

    }


    document.addEventListener(

        "lordbless:payment-request-created",

        handleDataChange

    );


    document.addEventListener(

        "lordbless:payment-verified",

        handleDataChange

    );


    document.addEventListener(

        "lordbless:payment-confirmed",

        handleDataChange

    );


    document.addEventListener(

        "lordbless:payment-rejected",

        handleDataChange

    );


    document.addEventListener(

        "lordbless:receipt-issued",

        handleDataChange

    );


    document.addEventListener(

        "lordbless:receipt-voided",

        handleDataChange

    );


    window.addEventListener(

        "storage",

        function (event) {

            if (

                event.key ===

                "LORDBLESS_PORTAL_DATA_BRIDGE_V1"

            ) {

                handleDataChange();

            }

        }

    );


    window.addEventListener(

        "lordbless:payment-data-updated",

        handleDataChange

    );


    document.addEventListener(

        "lordbless:payment-data-updated",

        handleDataChange

    );


    /* ============================================================
       PUBLIC API
    ============================================================ */

    window.LORDBLESS_PAYMENT_HISTORY = {

        render:

            render,


        refresh:

            refresh,


        renderForAdmin:

            renderForAdmin,


        renderForClient:

            renderForClient,


        getHistory:

            getHistory,


        getClientHistory:

            getClientHistory,


        getJourneyHistory:

            getJourneyHistory,


        getSummary:

            getSummary,


        deriveRecord:

            deriveRecord,


        getPaymentRequests:

            getPaymentRequests,


        getPaymentRecords:

            getPaymentRecords,


        getReceipts:

            getReceipts,


        getStatusLabel:

            getStatusLabel,


        getVerificationLabel:

            getVerificationLabel,


        getReceiptLabel:

            getReceiptLabel,


        statuses:

            PAYMENT_STATUS,


        verificationStatuses:

            VERIFICATION_STATUS,


        receiptStatuses:

            RECEIPT_STATUS,


        formatAmount:

            formatAmount,


        formatDate:

            formatDate,


        formatDateTime:

            formatDateTime

    };


    /* ============================================================
       READY
    ============================================================ */

    console.log(

        "LORDBLESS PAYMENT HISTORY: " +

        "Admin finance history engine loaded."

    );

})();
