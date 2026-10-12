/* ============================================================
   LORDBLESS CLIENT FINANCE
   ============================================================

   CLIENT-SIDE FINANCE VIEW

   PURPOSE
   - Show outstanding payment requests
   - Show outstanding balance
   - Allow client to view payment history
   - Show confirmed payments
   - Show official receipts

   IMPORTANT
   - Client does NOT submit payment
   - Client does NOT upload proof
   - Client does NOT confirm payment
   - Finance verification is authoritative
   - Once Finance verifies a payment, the request leaves
     Outstanding and appears in Payment History
   - Currency totals are kept separate
   - No currency conversion is performed

   DATA SOURCE
   - Current mock/payment bridge data
   - Designed to connect to Supabase later

   PUBLIC API
   window.LORDBLESS_CLIENT_FINANCE
   ============================================================ */

(function () {

    "use strict";


    /* =========================================================
       CONSTANTS
    ========================================================= */

    const COMPONENT_NAME =
        "LORDBLESS CLIENT FINANCE";


    const TERMINAL_REQUEST_STATUSES = [
        "paid",
        "confirmed",
        "cancelled",
        "canceled",
        "expired",
        "voided",
        "rejected",
        "refunded"
    ];


    const CURRENCY_FALLBACK =
        "EUR";


    /* =========================================================
       STATE
    ========================================================= */

    const state = {

        client: null,

        transactions: [],

        paymentRequests: [],

        payments: [],

        receipts: [],

        container: null,

        historyOpen: false

    };


    /* =========================================================
       BASIC HELPERS
    ========================================================= */

    function escapeHTML(value) {

        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    }


    function getClientId(client) {

        if (!client) {
            return null;
        }

        return (
            client.id ||
            client.clientId ||
            client.client_id ||
            client.accountId ||
            null
        );

    }


    function getClientName(client) {

        if (!client) {
            return "";
        }

        return (
            client.name ||
            client.fullName ||
            client.full_name ||
            client.displayName ||
            ""
        );

    }


    function normaliseCurrency(currency) {

        return String(
            currency ||
            CURRENCY_FALLBACK
        )
            .trim()
            .toUpperCase();

    }


    function formatAmount(amount, currency) {

        const numericAmount =
            Number(amount) || 0;

        const code =
            normaliseCurrency(currency);


        try {

            return new Intl.NumberFormat(
                undefined,
                {
                    style: "currency",
                    currency: code,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            ).format(numericAmount);

        } catch (error) {

            return (
                code +
                " " +
                numericAmount.toFixed(2)
            );

        }

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
            return "—";
        }

        try {

            return new Intl.DateTimeFormat(
                undefined,
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            ).format(date);

        } catch (error) {

            return date.toLocaleDateString();

        }

    }


    function formatDateTime(value) {

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
            return "—";
        }

        try {

            return new Intl.DateTimeFormat(
                undefined,
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                }
            ).format(date);

        } catch (error) {

            return date.toLocaleString();

        }

    }


    /* =========================================================
       CLIENT MATCHING
    ========================================================= */

    function belongsToClient(record, clientId) {

        if (!record) {
            return false;
        }

        if (!clientId) {
            return false;
        }


        const recordClientId =
            record.clientId ||
            record.client_id ||
            record.accountId ||
            record.account_id ||
            null;


        return String(recordClientId) ===
            String(clientId);

    }


    function filterClientRecords(
        records,
        clientId
    ) {

        if (!Array.isArray(records)) {
            return [];
        }

        if (!clientId) {
            return [];
        }

        return records.filter(
            function (record) {

                return belongsToClient(
                    record,
                    clientId
                );

            }
        );

    }


    /* =========================================================
       REQUEST STATUS
    ========================================================= */

    function getRequestStatus(request) {

        return String(
            request &&
            request.status ||
            "requested"
        )
            .trim()
            .toLowerCase();

    }


    function isOutstandingRequest(request) {

        if (!request) {
            return false;
        }


        const status =
            getRequestStatus(request);


        return !TERMINAL_REQUEST_STATUSES
            .includes(status);

    }


    function isConfirmedRequest(request) {

        if (!request) {
            return false;
        }


        const status =
            getRequestStatus(request);


        return (
            status === "paid" ||
            status === "confirmed" ||
            !!request.verifiedAt ||
            !!request.paidAt
        );

    }


    /* =========================================================
       PAYMENT REQUEST NORMALISATION
    ========================================================= */

    function normalisePaymentRequest(
        request
    ) {

        if (!request) {
            return null;
        }


        return {

            ...request,

            id:
                request.id ||
                request.paymentRequestId ||
                request.requestId ||
                null,

            clientId:
                request.clientId ||
                request.client_id ||
                null,

            reference:
                request.reference ||
                request.invoiceNumber ||
                request.invoice_number ||
                request.requestReference ||
                request.id ||
                "Payment Request",

            description:
                request.description ||
                request.transactionTitle ||
                request.service ||
                "Payment request",

            amount:
                Number(
                    request.amount ||
                    request.total ||
                    0
                ),

            currency:
                normaliseCurrency(
                    request.currency
                ),

            requestedDate:
                request.requestedDate ||
                request.createdAt ||
                request.created_at ||
                null,

            dueDate:
                request.dueDate ||
                request.due_date ||
                null,

            status:
                request.status ||
                "requested"

        };

    }


    /* =========================================================
       PAYMENT NORMALISATION
    ========================================================= */

    function normalisePayment(
        payment
    ) {

        if (!payment) {
            return null;
        }


        const request =
            payment.paymentRequest ||
            payment.payment_request ||
            null;


        return {

            ...payment,

            id:
                payment.id ||
                payment.paymentId ||
                payment.payment_id ||
                null,

            clientId:
                payment.clientId ||
                payment.client_id ||
                (request &&
                    (
                        request.clientId ||
                        request.client_id
                    )
                ) ||
                null,

            paymentRequestId:
                payment.paymentRequestId ||
                payment.payment_request_id ||
                payment.requestId ||
                (request && request.id) ||
                null,

            reference:
                payment.reference ||
                payment.paymentReference ||
                payment.payment_reference ||
                payment.transactionReference ||
                "Payment",

            amount:
                Number(
                    payment.amount ||
                    payment.amountReceived ||
                    payment.receivedAmount ||
                    0
                ),

            currency:
                normaliseCurrency(
                    payment.currency ||
                    payment.receivedCurrency
                ),

            paymentDate:
                payment.paymentDate ||
                payment.paidAt ||
                payment.verifiedAt ||
                payment.createdAt ||
                null,

            status:
                String(
                    payment.status ||
                    "paid"
                )
                    .trim()
                    .toLowerCase()

        };

    }


    /* =========================================================
       RECEIPT NORMALISATION
    ========================================================= */

    function normaliseReceipt(
        receipt
    ) {

        if (!receipt) {
            return null;
        }


        return {

            ...receipt,

            id:
                receipt.id ||
                receipt.receiptId ||
                receipt.receipt_id ||
                null,

            clientId:
                receipt.clientId ||
                receipt.client_id ||
                null,

            paymentId:
                receipt.paymentId ||
                receipt.payment_id ||
                null,

            paymentRequestId:
                receipt.paymentRequestId ||
                receipt.payment_request_id ||
                receipt.requestId ||
                null,

            receiptNumber:
                receipt.receiptNumber ||
                receipt.receipt_number ||
                receipt.number ||
                receipt.reference ||
                "Official Receipt",

            description:
                receipt.description ||
                receipt.service ||
                receipt.transactionTitle ||
                "Payment",

            amount:
                Number(
                    receipt.amount ||
                    receipt.receivedAmount ||
                    0
                ),

            currency:
                normaliseCurrency(
                    receipt.currency
                ),

            issuedAt:
                receipt.issuedAt ||
                receipt.issued_at ||
                receipt.createdAt ||
                receipt.created_at ||
                null,

            status:
                String(
                    receipt.status ||
                    "issued"
                )
                    .trim()
                    .toLowerCase()

        };

    }


    /* =========================================================
       PAYMENT HISTORY DERIVATION
    ========================================================= */

    function derivePaymentsFromRequests(
        requests
    ) {

        if (!Array.isArray(requests)) {
            return [];
        }


        return requests
            .filter(request => {

                if (
                    request.purpose === "initial_assessment_consultation"
                ) {
                    return String(request.status || "")
                            .trim()
                            .toLowerCase() === "paid" &&
                        String(request.verificationStatus || "")
                            .trim()
                            .toLowerCase() === "verified";
                }

                return isConfirmedRequest(request);

            })
            .map(
                function (request) {

                    const verification =
                        request.verification ||
                        request.verificationData ||
                        null;


                    return normalisePayment({

                        id:
                            request.paymentId ||
                            (
                                request.id
                                    ? "PAY-" +
                                      request.id
                                    : null
                            ),

                        clientId:
                            request.clientId,

                        paymentRequestId:
                            request.id,

                        reference:
                            request.paymentReference ||
                            request.transactionReference ||
                            (
                                verification &&
                                (
                                    verification.paymentReference ||
                                    verification.transactionReference
                                )
                            ) ||
                            request.reference,

                        amount:
                            (
                                request.receivedAmount ??
                                request.amount
                            ),

                        currency:
                            (
                                request.receivedCurrency ||
                                request.currency ||
                                (
                                    verification &&
                                    verification.currency
                                )
                            ),

                        paymentDate:
                            request.paymentDate ||
                            request.paidAt ||
                            request.verifiedAt ||
                            (
                                verification &&
                                (
                                    verification.paymentDate ||
                                    verification.verifiedAt
                                )
                            ),

                        status:
                            "paid"

                    });

                }
            )
            .filter(Boolean);

    }


    function mergePayments(
        explicitPayments,
        derivedPayments
    ) {

        const merged = [];


        function addPayment(payment) {

            if (!payment) {
                return;
            }


            const normalised =
                normalisePayment(payment);


            if (!normalised) {
                return;
            }


            const duplicate =
                merged.some(
                    function (existing) {

                        if (
                            normalised.id &&
                            existing.id
                        ) {

                            return String(
                                normalised.id
                            ) === String(
                                existing.id
                            );

                        }


                        return (
                            String(
                                normalised.paymentRequestId ||
                                ""
                            ) ===
                            String(
                                existing.paymentRequestId ||
                                ""
                            )
                        ) &&
                        Number(
                            normalised.amount
                        ) ===
                        Number(
                            existing.amount
                        );

                    }
                );


            if (!duplicate) {
                merged.push(normalised);
            }

        }


        (
            Array.isArray(explicitPayments)
                ? explicitPayments
                : []
        )
            .forEach(addPayment);


        (
            Array.isArray(derivedPayments)
                ? derivedPayments
                : []
        )
            .forEach(addPayment);


        return merged;

    }


    /* =========================================================
       DATA SOURCE
    ========================================================= */

   function getGlobalPaymentRequests() {

    if (
        Array.isArray(
            window.LORDBLESS_PAYMENT_REQUESTS
        )
    ) {

        return (
            window.LORDBLESS_PAYMENT_REQUESTS
        );

    }


    if (
        window.LORDBLESS_PAYMENT_BRIDGE &&
        typeof window.LORDBLESS_PAYMENT_BRIDGE.load === "function"
    ) {

        const bridgeData =
            window.LORDBLESS_PAYMENT_BRIDGE.load();


        if (
            bridgeData &&
            Array.isArray(
                bridgeData.paymentRequests
            )
        ) {

            return bridgeData.paymentRequests;

        }

    }


    return [];

}


    function getGlobalReceipts() {

    /*
     * Shared Admin ↔ Client receipt store.
     * This is the authoritative receipt source.
     */
    if (
        window.LORDBLESS_PAYMENT_BRIDGE &&
        typeof window.LORDBLESS_PAYMENT_BRIDGE.getReceipts ===
            "function"
    ) {

        const receipts =
            window.LORDBLESS_PAYMENT_BRIDGE.getReceipts();

        if (Array.isArray(receipts)) {

            return receipts;

        }

    }


    /*
     * Compatibility fallback for the legacy
     * in-memory receipt collection.
     */
    if (
        Array.isArray(
            window.LORDBLESS_RECEIPTS
        )
    ) {

        return window.LORDBLESS_RECEIPTS;

    }


    return [];

}
    function prepareData(data) {

        data =
            data || {};


        const client =
            data.client ||
            state.client ||
            null;


        const clientId =
            getClientId(client);


      const paymentRequests =
    Array.isArray(data.paymentRequests) &&
    data.paymentRequests.length
        ? data.paymentRequests
        : getGlobalPaymentRequests();

        const assessmentPayment = data.assessmentPayment || null;
        const filteredPaymentRequests = Array.isArray(paymentRequests)
            ? paymentRequests.filter(request => !(
                assessmentPayment &&
                request &&
                request.purpose === "initial_assessment_consultation" &&
                String(request.clientId || request.client_id || "") === String(clientId)
                || data.assessmentPaymentLoaded && request?.purpose === "initial_assessment_consultation"
            ))
            : [];
        if (
            assessmentPayment &&
            String(assessmentPayment.clientId || assessmentPayment.client_id || "") === String(clientId)
        ) filteredPaymentRequests.push(assessmentPayment);


        const payments =
            Array.isArray(
                data.payments
            )
                ? data.payments
                : getGlobalPayments();


        const receipts =
    Array.isArray(data.receipts) &&
    data.receipts.length
        ? data.receipts
        : getGlobalReceipts();


        const transactions =
            Array.isArray(
                data.transactions
            )
                ? data.transactions
                : [];


        const clientRequests =
            filterClientRecords(
                filteredPaymentRequests,
                clientId
            )
                .map(
                    normalisePaymentRequest
                )
                .filter(Boolean);


        const clientExplicitPayments =
            filterClientRecords(
                payments,
                clientId
            );


        const derivedPayments =
            derivePaymentsFromRequests(
                clientRequests
            );


        const clientPayments =
            mergePayments(
                clientExplicitPayments,
                derivedPayments
            );


        const clientReceipts =
            filterClientRecords(
                receipts,
                clientId
            )
                .map(
                    normaliseReceipt
                )
                .filter(Boolean);


        return {

            client,

            transactions,

            paymentRequests:
                clientRequests,

            payments:
                clientPayments,

            receipts:
                clientReceipts

        };

    }


    /* =========================================================
       CURRENCY TOTALS
    ========================================================= */

    function calculateTotalsByCurrency(
        records,
        amountGetter
    ) {

        const totals = {};


        (
            Array.isArray(records)
                ? records
                : []
        )
            .forEach(
                function (record) {

                    const currency =
                        normaliseCurrency(
                            record.currency
                        );


                    const amount =
                        Number(
                            amountGetter(record)
                        ) || 0;


                    if (!totals[currency]) {
                        totals[currency] = 0;
                    }


                    totals[currency] +=
                        amount;

                }
            );


        return totals;

    }


    function renderCurrencyTotals(
        totals
    ) {

        const currencies =
            Object.keys(totals);


        if (!currencies.length) {

            return `
                <div
                    class="lbc-client-finance-empty-balance"
                >
                    <strong>No outstanding balance</strong>
                    <span>There are currently no payment requests requiring attention.</span>
                </div>
            `;

        }


        return currencies
            .map(
                function (currency) {

                    return `
                        <div
                            class="lbc-client-finance-balance-line"
                        >
                            <span>
                                ${escapeHTML(currency)}
                            </span>

                            <strong>
                                ${escapeHTML(
                                    formatAmount(
                                        totals[currency],
                                        currency
                                    )
                                )}
                            </strong>
                        </div>
                    `;

                }
            )
            .join("");

    }


    /* =========================================================
       OUTSTANDING REQUESTS
    ========================================================= */

    function getOutstandingRequests() {

        return state.paymentRequests
            .filter(
                isOutstandingRequest
            )
            .sort(
                function (a, b) {

                    const first =
                        new Date(
                            a.dueDate ||
                            a.requestedDate ||
                            0
                        ).getTime();


                    const second =
                        new Date(
                            b.dueDate ||
                            b.requestedDate ||
                            0
                        ).getTime();


                    return first - second;

                }
            );

    }


    function renderOutstandingRequests(
        requests
    ) {

        if (!requests.length) {

            return `
                <div
                    class="lbc-client-finance-empty-state"
                >
                    <div
                        class="lbc-client-finance-empty-icon"
                    >
                        ✓
                    </div>

                    <div>
                        <strong>
                            No outstanding payment requests
                        </strong>

                        <p>
                            You currently have no payment request requiring action.
                        </p>
                    </div>
                </div>
            `;

        }


        return requests
            .map(
                function (request) {

                    const status =
                        getRequestStatus(
                            request
                        );


                    const isInitialAssessment =
                        request.purpose === "initial_assessment_consultation";

                    const isAwaitingVerification =
                        status === "awaiting_verification" ||
                        String(request.verificationStatus || "").toLowerCase() === "pending" ||
                        Boolean(request.clientPaymentSubmittedAt);

                    const paymentWhatsAppMessage = encodeURIComponent(
                        `I have paid for the Initial Assessment & Consultation. Payment reference: ${request.reference || ""}`
                    );

                    const statusLabel =
                        isAwaitingVerification
                            ? "Awaiting Verification"
                            : status === "overdue"
                                ? "Overdue"
                                : "Payment requested";


                    return `
                        <article
                            class="lbc-client-finance-request"
                            tabindex="-1"
                            data-payment-request-id="${escapeHTML(
                                request.id || ""
                            )}"
                        >

                            <div
                                class="lbc-client-finance-request-main"
                            >

                                <div
                                    class="lbc-client-finance-request-heading"
                                >

                                    <span
                                        class="lbc-client-finance-request-status"
                                    >
                                        ${escapeHTML(
                                            statusLabel
                                        )}
                                    </span>

                                    <h4>
                                        ${escapeHTML(
                                            request.description
                                        )}
                                    </h4>

                                </div>


                                <div
                                    class="lbc-client-finance-request-reference"
                                >
                                    Reference:
                                    ${escapeHTML(
                                        request.reference
                                    )}
                                </div>


                                ${
                                    request.dueDate
                                        ? `
                                            <div
                                                class="lbc-client-finance-request-due"
                                            >
                                                Due:
                                                ${escapeHTML(
                                                    formatDate(
                                                        request.dueDate
                                                    )
                                                )}
                                            </div>
                                        `
                                        : ""
                                }

                                ${isInitialAssessment ? `
                                    <div class="lbc-client-finance-payment-instructions">
                                        <strong>How to pay</strong>
                                        <p>Mobile Money: 0549617222</p>
                                        <p>Account name: Aboagye Richard Atta</p>
                                        <p>Pay externally, then send your payment confirmation screenshot to LORDBLESS CONSULTANCY via <a href="https://wa.me/4915754780010?text=${paymentWhatsAppMessage}" target="_blank" rel="noopener noreferrer">WhatsApp</a>.</p>
                                        <p>Finance must verify payment before your consultation can be scheduled.</p>
                                    </div>
                                ` : request.paymentInstructions ? `
                                    <div class="lbc-client-finance-payment-instructions">
                                        <strong>Payment instructions</strong>
                                        <p style="white-space:pre-line">${escapeHTML(request.paymentInstructions)}</p>
                                    </div>
                                ` : ""}

                            </div>


                            <div
                                class="lbc-client-finance-request-amount"
                            >

                                <span>
                                    ${isInitialAssessment ? "AMOUNT PAYABLE" : "AMOUNT DUE"}
                                </span>

                                <strong>
                                    ${escapeHTML(
                                        formatAmount(
                                            request.amount,
                                            request.currency
                                        )
                                    )}
                                </strong>

                            </div>

                        </article>
                    `;

                }
            )
            .join("");

    }


    /* =========================================================
       PAYMENT HISTORY
    ========================================================= */

    function renderPaymentHistory() {

        if (!state.payments.length) {

            return `
                <div
                    class="lbc-client-finance-history-empty"
                >
                    <strong>No confirmed payments yet</strong>

                    <p>
                        Confirmed payments will appear here after Finance verifies them.
                    </p>
                </div>
            `;

        }


        const totals =
            calculateTotalsByCurrency(
                state.payments,
                function (payment) {
                    return payment.amount;
                }
            );


        const totalMarkup =
            Object.keys(totals)
                .map(
                    function (currency) {

                        return `
                            <div
                                class="lbc-client-finance-history-total"
                            >
                                <span>
                                    Total paid (${escapeHTML(currency)})
                                </span>

                                <strong>
                                    ${escapeHTML(
                                        formatAmount(
                                            totals[currency],
                                            currency
                                        )
                                    )}
                                </strong>
                            </div>
                        `;

                    }
                )
                .join("");


        const rows =
            state.payments
                .slice()
                .sort(
                    function (a, b) {

                        return (
                            new Date(
                                b.paymentDate || 0
                            ).getTime()
                            -
                            new Date(
                                a.paymentDate || 0
                            ).getTime()
                        );

                    }
                )
                .map(
                    function (payment) {

                        return `
                            <article
                                class="lbc-client-finance-payment"
                            >

                                <div>

                                    <strong>
                                        ${escapeHTML(
                                            payment.reference
                                        )}
                                    </strong>

                                    <span>
                                        ${escapeHTML(
                                            formatDate(
                                                payment.paymentDate
                                            )
                                        )}
                                    </span>

                                </div>


                                <strong>
                                    ${escapeHTML(
                                        formatAmount(
                                            payment.amount,
                                            payment.currency
                                        )
                                    )}
                                </strong>

                            </article>
                        `;

                    }
                )
                .join("");


        return `
            <div
                class="lbc-client-finance-history-summary"
            >
                ${totalMarkup}
            </div>


            <div
                class="lbc-client-finance-payment-list"
            >
                ${rows}
            </div>
        `;

    }


    /* =========================================================
       RECEIPTS
    ========================================================= */

    function findReceiptForPayment(
        payment
    ) {

        if (!payment) {
            return null;
        }


        return state.receipts.find(
            function (receipt) {

                if (
                    payment.id &&
                    receipt.paymentId
                ) {

                    if (
                        String(
                            payment.id
                        ) ===
                        String(
                            receipt.paymentId
                        )
                    ) {

                        return true;

                    }

                }


                if (
                    payment.paymentRequestId &&
                    receipt.paymentRequestId
                ) {

                    if (
                        String(
                            payment.paymentRequestId
                        ) ===
                        String(
                            receipt.paymentRequestId
                        )
                    ) {

                        return true;

                    }

                }


                return false;

            }
        ) || null;

    }


    /* =========================================================
       RECEIPT ACTION / VIEWER STYLES
    ========================================================= */

    function ensureReceiptUIStyles() {

        const styleId =
            "lbc-client-finance-receipt-ui-styles";


        if (
            document.getElementById(styleId)
        ) {
            return;
        }


        const style =
            document.createElement("style");


        style.id =
            styleId;


        style.textContent = `

.lbc-client-finance-receipt-actions {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(128,128,128,.12);
}

.lbc-client-finance-receipt-action {
    appearance: none;
    border: 1px solid #17233b;
    border-radius: 7px;
    padding: 9px 13px;
    background: #17233b;
    color: #fff;
    font: inherit;
    font-size: 9px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: .05em;
    cursor: pointer;
    visibility: visible;
    opacity: 1;
}

.lbc-client-finance-receipt-action:hover {
    background: #243554;
}

.lbc-client-finance-receipt-action.secondary {
    border-color: rgba(128,128,128,.22);
    background: rgba(128,128,128,.08);
    color: inherit;
}

.lbc-client-finance-receipt-action.secondary:hover {
    background: rgba(128,128,128,.14);
}

.lbc-client-receipt-viewer {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
}

.lbc-client-receipt-viewer-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15,23,42,.62);
    backdrop-filter: blur(4px);
}

.lbc-client-receipt-viewer-card {
    position: relative;
    z-index: 1;
    width: min(920px, 100%);
    max-height: calc(100vh - 48px);
    overflow: auto;
    border-radius: 18px;
    background: #f7f8fa;
    box-shadow: 0 24px 70px rgba(15,23,42,.25);
}

.lbc-client-receipt-viewer-close {
    position: sticky;
    top: 12px;
    float: right;
    z-index: 3;
    width: 38px;
    height: 38px;
    margin: 12px 12px 0 0;
    border: 0;
    border-radius: 10px;
    background: rgba(23,35,59,.10);
    color: #17233b;
    font-size: 24px;
    cursor: pointer;
}

.lbc-client-receipt-document {
    margin: 22px;
    overflow: hidden;
    border: 1px solid #e4e7ec;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 10px 28px rgba(15,23,42,.08);
}

.lbc-client-receipt-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 26px;
    padding: 30px 34px;
    border-bottom: 1px solid #e8ebf0;
    background: linear-gradient(180deg,#fff 0%,#fbfcfe 100%);
}

.lbc-client-receipt-brand {
    display: flex;
    align-items: center;
    gap: 14px;
}

.lbc-client-receipt-logo {
    display: block;
    width: 76px;
    height: auto;
    object-fit: contain;
}

.lbc-client-receipt-brand strong {
    color: #17233b;
    font-size: 19px;
    letter-spacing: .01em;
}

.lbc-client-receipt-title {
    text-align: right;
}

.lbc-client-receipt-title > strong {
    display: block;
    margin-bottom: 10px;
    color: #9a7421;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .15em;
}

.lbc-client-receipt-title span {
    display: block;
    color: #7b8493;
    font-size: 11px;
}

.lbc-client-receipt-title b {
    display: block;
    margin-top: 4px;
    color: #17233b;
    font-size: 15px;
}

.lbc-client-receipt-title small {
    display: block;
    margin-top: 6px;
    color: #7b8493;
    font-size: 11px;
}

.lbc-client-receipt-section {
    padding: 24px 34px;
    border-bottom: 1px solid #e8ebf0;
}

.lbc-client-receipt-section h4 {
    margin: 0 0 16px;
    color: #717b8c;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .13em;
}

.lbc-client-receipt-grid {
    display: grid;
    grid-template-columns: repeat(2,minmax(0,1fr));
    gap: 0 34px;
}

.lbc-client-receipt-grid > div {
    min-width: 0;
    padding: 12px 0;
    border-top: 1px solid #eef0f3;
}

.lbc-client-receipt-grid > div:nth-child(-n+2) {
    border-top: 0;
    padding-top: 0;
}

.lbc-client-receipt-grid span {
    display: block;
    margin-bottom: 4px;
    color: #8a93a3;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
}

.lbc-client-receipt-grid strong {
    display: block;
    color: #26344d;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.lbc-client-receipt-amount {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin: 24px 34px;
    padding: 20px 22px;
    border: 1px solid #e8dfcf;
    border-radius: 13px;
    background: #fbf8f1;
}

.lbc-client-receipt-amount span:first-child {
    display: block;
    margin-bottom: 4px;
    color: #7d6a43;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .13em;
}

.lbc-client-receipt-amount strong {
    display: block;
    color: #17233b;
    font-size: 28px;
    line-height: 1.15;
}

.lbc-client-receipt-paid {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    border: 1px solid #cfe0d2;
    border-radius: 999px;
    background: #f2f8f3;
    color: #285c35;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .10em;
}

.lbc-client-receipt-description {
    margin: 0;
    color: #344054;
    font-size: 13px;
    line-height: 1.6;
}

.lbc-client-receipt-authentication {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 20px 34px;
    border-bottom: 1px solid #e8ebf0;
}

.lbc-client-receipt-authentication > span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 70px;
    height: 36px;
    border: 2px solid #285c35;
    border-radius: 7px;
    color: #285c35;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: .10em;
    transform: rotate(-3deg);
}

.lbc-client-receipt-authentication strong {
    display: block;
    margin-bottom: 4px;
    color: #26344d;
    font-size: 13px;
}

.lbc-client-receipt-authentication small {
    display: block;
    color: #667085;
    font-size: 11px;
    line-height: 1.55;
}

.lbc-client-receipt-electronic-note {
    padding: 17px 34px 22px;
    color: #8a93a3;
    font-size: 10px;
    line-height: 1.5;
    text-align: center;
}

.lbc-client-receipt-viewer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 0 22px 22px;
}

.lbc-client-receipt-viewer-button {
    appearance: none;
    border: 1px solid #17233b;
    border-radius: 8px;
    padding: 10px 14px;
    background: #17233b;
    color: #fff;
    font: inherit;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .05em;
    cursor: pointer;
}

.lbc-client-receipt-viewer-button.secondary {
    border-color: rgba(128,128,128,.22);
    background: #fff;
    color: #344054;
}

@media (max-width: 680px) {

    .lbc-client-finance-receipt-actions {
        justify-content: stretch;
    }

    .lbc-client-finance-receipt-action {
        flex: 1 1 auto;
    }

    .lbc-client-receipt-viewer {
        padding: 0;
    }

    .lbc-client-receipt-viewer-card {
        width: 100%;
        height: 100vh;
        max-height: 100vh;
        border-radius: 0;
    }

    .lbc-client-receipt-document {
        margin: 12px;
    }

    .lbc-client-receipt-header {
        flex-direction: column;
        padding: 24px;
    }

    .lbc-client-receipt-title {
        width: 100%;
        text-align: left;
    }

    .lbc-client-receipt-section {
        padding: 22px 24px;
    }

    .lbc-client-receipt-grid {
        grid-template-columns: 1fr;
    }

    .lbc-client-receipt-grid > div:nth-child(2) {
        border-top: 1px solid #eef0f3;
        padding-top: 12px;
    }

    .lbc-client-receipt-amount {
        margin: 20px 24px;
        align-items: flex-start;
        flex-direction: column;
    }

    .lbc-client-receipt-authentication,
    .lbc-client-receipt-electronic-note {
        padding-left: 24px;
        padding-right: 24px;
    }

    .lbc-client-receipt-viewer-actions {
        padding-left: 12px;
        padding-right: 12px;
    }

    .lbc-client-receipt-viewer-button {
        flex: 1 1 auto;
    }

}
`;

        document.head.appendChild(style);
    }


    function renderReceipts() {

        if (!state.receipts.length) {

            return `
                <div
                    class="lbc-client-finance-history-empty"
                >
                    <strong>No official receipts yet</strong>

                    <p>
                        Official receipts will appear here after Finance issues them.
                    </p>
                </div>
            `;

        }


        ensureReceiptUIStyles();


        return `
            <div
                class="lbc-client-finance-receipts"
            >

                ${state.receipts
                    .slice()
                    .sort(
                        function (a, b) {

                            return (
                                new Date(
                                    b.issuedAt ||
                                    b.issued_at ||
                                    0
                                ).getTime()
                                -
                                new Date(
                                    a.issuedAt ||
                                    a.issued_at ||
                                    0
                                ).getTime()
                            );

                        }
                    )
                    .map(
                        function (receipt) {

                            const receiptId =
                                receipt.id ||
                                receipt.receiptNumber ||
                                receipt.receipt_number ||
                                "";

                            const receiptNumber =
                                receipt.receiptNumber ||
                                receipt.receipt_number ||
                                "Official Receipt";

                            const description =
                                receipt.description ||
                                receipt.service ||
                                receipt.transactionTitle ||
                                "Payment Request";

                            const amount =
                                Number(
                                    receipt.amount ||
                                    receipt.receivedAmount ||
                                    0
                                );

                            const currency =
                                receipt.currency ||
                                CURRENCY_FALLBACK;

                            const issuedAt =
                                receipt.issuedAt ||
                                receipt.issued_at ||
                                receipt.createdAt ||
                                receipt.created_at ||
                                null;


                            return `
                                <article
                                    class="lbc-client-finance-receipt"
                                >

                                    <div>

                                        <span>
                                            OFFICIAL RECEIPT
                                        </span>

                                        <strong>
                                            ${escapeHTML(
                                                receiptNumber
                                            )}
                                        </strong>

                                        <small>
                                            ${escapeHTML(
                                                description
                                            )}
                                        </small>

                                    </div>


                                    <div
                                        class="lbc-client-finance-receipt-meta"
                                    >

                                        <strong>
                                            ${escapeHTML(
                                                formatAmount(
                                                    amount,
                                                    currency
                                                )
                                            )}
                                        </strong>

                                        <span>
                                            ${escapeHTML(
                                                formatDate(
                                                    issuedAt
                                                )
                                            )}
                                        </span>

                                    </div>


                                    <div
                                        class="lbc-client-finance-receipt-actions"
                                    >

                                        <button
                                            type="button"
                                            class="lbc-client-finance-receipt-action"
                                            data-finance-action="view-receipt"
                                            data-receipt-id="${escapeHTML(
                                                receiptId
                                            )}"
                                            aria-label="View official receipt ${escapeHTML(
                                                receiptNumber
                                            )}"
                                        >
                                            VIEW RECEIPT
                                        </button>


                                        <button
                                            type="button"
                                            class="lbc-client-finance-receipt-action secondary"
                                            data-finance-action="download-receipt"
                                            data-receipt-id="${escapeHTML(
                                                receiptId
                                            )}"
                                            aria-label="Download official receipt ${escapeHTML(
                                                receiptNumber
                                            )}"
                                        >
                                            DOWNLOAD
                                        </button>

                                    </div>

                                </article>
                            `;

                        }
                    )
                    .join("")}

            </div>
        `;

    }



    /* =========================================================
       MAIN RENDER
    ========================================================= */

    function render(
        container,
        data
    ) {

        if (!container) {

            console.warn(
                COMPONENT_NAME +
                ": No container supplied."
            );

            return null;

        }


        state.container =
            container;


        const prepared =
            prepareData(
                data
            );


        state.client =
            prepared.client;


        state.transactions =
            prepared.transactions;


        state.paymentRequests =
            prepared.paymentRequests;


        state.payments =
            prepared.payments;


        state.receipts =
            prepared.receipts;


        const outstandingRequests =
            getOutstandingRequests();


        const outstandingTotals =
            calculateTotalsByCurrency(
                outstandingRequests,
                function (request) {
                    return request.amount;
                }
            );


        const clientName =
            getClientName(
                state.client
            );


        container.innerHTML = `

            <div
                class="lbc-client-finance"
            >

                <div
                    class="lbc-client-finance-header"
                >

                    <div>

                        <p
                            class="lbc-client-finance-eyebrow"
                        >
                            FINANCE
                        </p>

                        <h2>
                            ${clientName
                                ? `Your financial information`
                                : `Financial information`
                            }
                        </h2>

                        <p>
                            View outstanding payment requests,
                            confirmed payments and official receipts.
                        </p>

                    </div>

                </div>


                <section
                    class="lbc-client-finance-balance-card"
                >

                    <div
                        class="lbc-client-finance-balance-heading"
                    >

                        <span>
                            OUTSTANDING BALANCE
                        </span>

                    </div>


                    <div
                        class="lbc-client-finance-balance-values"
                    >

                        ${renderCurrencyTotals(
                            outstandingTotals
                        )}

                    </div>

                </section>


                         ${
                    outstandingRequests.length
                        ? `
                            <section
                                class="lbc-client-finance-section"
                            >

                                <div
                                    class="lbc-client-finance-section-heading"
                                >

                                    <div>

                                        <p>
                                            PAYMENT REQUESTS
                                        </p>

                                        <h3>
                                            Outstanding payments
                                        </h3>

                                    </div>

                                    <span>
                                        ${outstandingRequests.length}
                                    </span>

                                </div>


                                <div
                                    class="lbc-client-finance-request-list"
                                >

                                    ${renderOutstandingRequests(
                                        outstandingRequests
                                    )}

                                </div>

                            </section>
                        `
                        : ""
                }


                <section
                    class="lbc-client-finance-history-section"
                >

                    <button
                        type="button"
                        class="lbc-client-finance-history-toggle"
                        data-finance-action="toggle-history"
                        aria-expanded="${state.historyOpen ? "true" : "false"}"
                    >

                        <span>
                            View Payment History
                        </span>

                        <span
                            class="lbc-client-finance-history-toggle-icon"
                        >
                            ${state.historyOpen ? "−" : "+"}
                        </span>

                    </button>


                    <div
                        class="lbc-client-finance-history-panel"
                        data-finance-history-panel
                        ${
                            state.historyOpen
                                ? ""
                                : "hidden"
                        }
                    >

                        <div
                            class="lbc-client-finance-section-heading"
                        >

                            <div>

                                <p>
                                    PAYMENT HISTORY
                                </p>

                                <h3>
                                    Confirmed payments
                                </h3>

                            </div>

                        </div>


                        ${renderPaymentHistory()}


                        <div
                            class="lbc-client-finance-receipts-section"
                        >

                            <div
                                class="lbc-client-finance-section-heading"
                            >

                                <div>

                                    <p>
                                        RECEIPTS
                                    </p>

                                    <h3>
                                        Official receipts
                                    </h3>

                                </div>

                            </div>


                            ${renderReceipts()}

                        </div>

                    </div>

                </section>

            </div>

        `;


        bindEvents(
            container
        );


        return getState();

    }


    /* =========================================================
       EVENT BINDING
    ========================================================= */

function bindEvents(
    container
) {

    const toggle =
        container.querySelector(
            '[data-finance-action="toggle-history"]'
        );


    if (toggle) {

        toggle.addEventListener(
            "click",
            function () {

                state.historyOpen =
                    !state.historyOpen;


                render(
                    state.container,
                    state
                );

            }
        );

    }


    /* =========================================================
       RECEIPT ACTIONS
    ========================================================= */

    container
        .querySelectorAll(
            '[data-finance-action="view-receipt"]'
        )
        .forEach(
            function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        viewReceipt(
                            button.getAttribute(
                                "data-receipt-id"
                            )
                        );

                    }
                );

            }
        );


    container
        .querySelectorAll(
            '[data-finance-action="download-receipt"]'
        )
        .forEach(
            function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        downloadReceipt(
                            button.getAttribute(
                                "data-receipt-id"
                            )
                        );

                    }
                );

            }
        );

}

/* =========================================================
   VIEW RECEIPT
========================================================= */

function viewReceipt(
    receiptId
) {

    const receipt =
        state.receipts.find(
            function (item) {

                return String(
                    item.id ||
                    item.receiptNumber ||
                    item.receipt_number ||
                    ""
                ) === String(
                    receiptId
                );

            }
        );


    if (!receipt) {

        showMessage(
            "Receipt could not be found.",
            true
        );

        return;

    }


    openReceiptViewer(
        receipt
    );

}


/* =========================================================
   RECEIPT VIEWER
========================================================= */

function openReceiptViewer(
    receipt
) {

    if (!receipt) {
        return;
    }


    const existing =
        document.querySelector(
            ".lbc-client-receipt-viewer"
        );


    if (existing) {
        existing.remove();
    }


    const receiptNumber =
        receipt.receiptNumber ||
        receipt.receipt_number ||
        "Official Receipt";


    const amount =
        receipt.amount ??
        receipt.totalPaid ??
        receipt.total_paid ??
        0;


    const currency =
        receipt.currency ||
        "EUR";


    const clientName =
        receipt.clientName ||
        receipt.client_name ||
        state.client?.fullName ||
        state.client?.name ||
        "—";


    const clientId =
        receipt.clientId ||
        receipt.client_id ||
        state.client?.id ||
        "—";


    const journey =
        receipt.transactionTitle ||
        receipt.transaction_title ||
        receipt.service ||
        "—";


    const destination =
        receipt.destination ||
        "—";


    const paymentDate =
        receipt.paymentDate ||
        receipt.payment_date ||
        receipt.paidAt ||
        receipt.paid_at ||
        receipt.issuedAt ||
        receipt.issued_at ||
        null;


    const paymentMethod =
        receipt.paymentMethod ||
        receipt.payment_method ||
        "—";


    const paymentReference =
        receipt.paymentReference ||
        receipt.payment_reference ||
        receipt.transactionReference ||
        receipt.transaction_reference ||
        "—";

    const paymentRequestReference = receipt.paymentRequestReference || receipt.payment_request_reference || "—";
    const verifiedAt = receipt.verifiedAt || receipt.verified_at || null;
    const verifiedByName = receipt.verifiedByName || receipt.verified_by_name || "—";


    const description =
        receipt.description ||
        receipt.serviceDescription ||
        receipt.service_description ||
        "Payment received";


    const issuedAt =
        receipt.issuedAt ||
        receipt.issued_at ||
        null;


    const overlay =
        document.createElement(
            "div"
        );


    overlay.className =
        "lbc-client-receipt-viewer";


    overlay.innerHTML = `

        <div
            class="lbc-client-receipt-viewer-backdrop"
            data-receipt-close
        ></div>


        <div
            class="lbc-client-receipt-viewer-card"
            role="dialog"
            aria-modal="true"
            aria-label="Official receipt"
        >

            <button
                type="button"
                class="lbc-client-receipt-viewer-close"
                data-receipt-close
                aria-label="Close receipt"
            >
                ×
            </button>


            <div
                class="lbc-client-receipt-document"
                id="lbc-client-receipt-document"
            >

                <div
                    class="lbc-client-receipt-header"
                >

                    <div>

                        <div
                            class="lbc-client-receipt-brand"
                        >
                            <img
                                src="../images/service-images/lordbless-header-logo.png"
                                alt="LORDBLESS CONSULTANCY"
                                class="lbc-client-receipt-logo"
                            >

                            <strong>
                                LORDBLESS CONSULTANCY
                            </strong>
                        </div>

                    </div>


                    <div
                        class="lbc-client-receipt-title"
                    >

                        <strong>
                            OFFICIAL PAYMENT RECEIPT
                        </strong>

                        <span>
                            Receipt No.
                        </span>

                        <b>
                            ${escapeHTML(
                                receiptNumber
                            )}
                        </b>

                        <small>
                            Issued
                            ${escapeHTML(
                                formatDate(
                                    issuedAt
                                )
                            )}
                        </small>

                    </div>

                </div>


                <div
                    class="lbc-client-receipt-section"
                >

                    <h4>
                        PAYMENT DETAILS
                    </h4>


                    <div
                        class="lbc-client-receipt-grid"
                    >

                        <div>
                            <span>CLIENT</span>
                            <strong>
                                ${escapeHTML(
                                    clientName
                                )}
                            </strong>
                        </div>


                        <div>
                            <span>CLIENT ID</span>
                            <strong>
                                ${escapeHTML(
                                    clientId
                                )}
                            </strong>
                        </div>


                        <div>
                            <span>JOURNEY</span>
                            <strong>
                                ${escapeHTML(
                                    journey
                                )}
                            </strong>
                        </div>


                        <div>
                            <span>DESTINATION</span>
                            <strong>
                                ${escapeHTML(
                                    destination
                                )}
                            </strong>
                        </div>


                        <div>
                            <span>PAYMENT DATE</span>
                            <strong>
                                ${escapeHTML(
                                    formatDate(
                                        paymentDate
                                    )
                                )}
                            </strong>
                        </div>


                        <div>
                            <span>PAYMENT METHOD</span>
                            <strong>
                                ${escapeHTML(
                                    paymentMethod
                                )}
                            </strong>
                        </div>


                        <div>
                            <span>PAYMENT REFERENCE</span>
                            <strong>
                                ${escapeHTML(
                                    paymentReference
                                )}
                            </strong>
                        </div>

                        <div>
                            <span>PAYMENT REQUEST REFERENCE</span>
                            <strong>${escapeHTML(paymentRequestReference)}</strong>
                        </div>

                        <div>
                            <span>VERIFIED BY</span>
                            <strong>${escapeHTML(verifiedByName)}</strong>
                        </div>

                        <div>
                            <span>VERIFICATION DATE</span>
                            <strong>${escapeHTML(formatDate(verifiedAt))}</strong>
                        </div>

                    </div>

                </div>

                <div
                    class="lbc-client-receipt-amount"
                >

                    <div>

                        <span>
                            AMOUNT PAID
                        </span>

                        <strong>
                            ${escapeHTML(
                                formatAmount(
                                    amount,
                                    currency
                                )
                            )}
                        </strong>

                    </div>


                    <span
                        class="lbc-client-receipt-paid"
                    >
                        ✓ PAID
                    </span>

                </div>


                <div
                    class="lbc-client-receipt-section"
                >

                    <h4>
                        DESCRIPTION
                    </h4>

                    <p
                        class="lbc-client-receipt-description"
                    >
                        ${escapeHTML(
                            description
                        )}
                    </p>

                </div>


                <div
                    class="lbc-client-receipt-authentication"
                >

                    <span>
                        PAID
                    </span>

                    <div>

                        <strong>
                            Payment received
                        </strong>

                        <small>
                            Payment received and recorded by
                            LORDBLESS CONSULTANCY.
                        </small>

                    </div>

                </div>


                <div
                    class="lbc-client-receipt-electronic-note"
                >
                    This receipt was electronically generated.
                    No physical signature is required.
                </div>

            </div>


            <div
                class="lbc-client-receipt-viewer-actions"
            >

                <button
                    type="button"
                    class="lbc-client-receipt-viewer-button secondary"
                    data-receipt-close
                >
                    CLOSE
                </button>


                <button
                    type="button"
                    class="lbc-client-receipt-viewer-button"
                    data-receipt-print
                >
                    DOWNLOAD / SAVE PDF
                </button>

            </div>

        </div>

    `;


    document.body.appendChild(
        overlay
    );


    /* =========================================================
       CLOSE
    ========================================================= */

    const close =
        function () {

            overlay.remove();

        };


    overlay
        .querySelectorAll(
            "[data-receipt-close]"
        )
        .forEach(
            function (element) {

                element.addEventListener(
                    "click",
                    close
                );

            }
        );


    /* =========================================================
       PRINT / SAVE PDF
    ========================================================= */

    const printButton =
        overlay.querySelector(
            "[data-receipt-print]"
        );


    if (printButton) {

        printButton.addEventListener(
            "click",
            function () {

                printReceipt(
                    receipt
                );

            }
        );

    }


    document.addEventListener(
        "keydown",
        function receiptEscapeHandler(
            event
        ) {

            if (
                event.key ===
                "Escape"
            ) {

                close();

                document.removeEventListener(
                    "keydown",
                    receiptEscapeHandler
                );

            }

        }
    );

}


/* =========================================================
   DOWNLOAD / SAVE PDF
========================================================= */

function downloadReceipt(
    receiptId
) {

    const receipt =
        state.receipts.find(
            function (item) {

                return String(
                    item.id ||
                    item.receiptNumber ||
                    item.receipt_number ||
                    ""
                ) === String(
                    receiptId
                );

            }
        );


    if (!receipt) {

        showMessage(
            "Receipt could not be found.",
            true
        );

        return;

    }


    printReceipt(
        receipt
    );

}


/* =========================================================
   PRINT RECEIPT
   Browser allows client to choose:
   Save as PDF / Printer
========================================================= */

function printReceipt(
    receipt
) {

    const receiptNumber =
        receipt.receiptNumber ||
        receipt.receipt_number ||
        "Official Receipt";


    const amount =
        receipt.amount ??
        receipt.totalPaid ??
        receipt.total_paid ??
        0;


    const currency =
        receipt.currency ||
        "EUR";


    const clientName =
        receipt.clientName ||
        receipt.client_name ||
        state.client?.fullName ||
        state.client?.name ||
        "—";


    const clientId =
        receipt.clientId ||
        receipt.client_id ||
        state.client?.id ||
        "—";


    const journey =
        receipt.transactionTitle ||
        receipt.transaction_title ||
        receipt.service ||
        "—";


    const destination =
        receipt.destination ||
        "—";


    const paymentDate =
        receipt.paymentDate ||
        receipt.payment_date ||
        receipt.paidAt ||
        receipt.paid_at ||
        receipt.issuedAt ||
        receipt.issued_at ||
        null;


    const paymentMethod =
        receipt.paymentMethod ||
        receipt.payment_method ||
        "—";


    const paymentReference =
        receipt.paymentReference ||
        receipt.payment_reference ||
        receipt.transactionReference ||
        receipt.transaction_reference ||
        "—";


    const description =
        receipt.description ||
        receipt.serviceDescription ||
        receipt.service_description ||
        "Payment received";


    const issuedAt =
        receipt.issuedAt ||
        receipt.issued_at ||
        null;


    const printWindow =
        window.open(
            "",
            "_blank",
            "width=900,height=1000"
        );


    if (!printWindow) {

        showMessage(
            "Please allow pop-ups to download the receipt.",
            true
        );

        return;

    }


    printWindow.document.open();


    printWindow.document.write(`

        <!DOCTYPE html>

        <html>

        <head>

            <meta charset="UTF-8">

            <title>
                ${escapeHTML(receiptNumber)}
            </title>


            <style>

                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    padding: 30px;
                    background: #f2f3f5;
                    font-family:
                        Arial,
                        Helvetica,
                        sans-serif;
                    color: #24324a;
                }

                .receipt {
                    width: 100%;
                    max-width: 900px;
                    margin: 0 auto;
                    background: #ffffff;
                    padding: 42px;
                }

                .header {
                    display: flex;
                    justify-content: space-between;
                    gap: 30px;
                    padding-bottom: 30px;
                    border-bottom: 1px solid #e5e7eb;
                }

                .brand-block {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }

                .logo {
                    width: 78px;
                    height: auto;
                    object-fit: contain;
                }

                .brand {
                    font-size: 25px;
                    font-weight: 800;
                    letter-spacing: 1px;
                }

                .subtitle {
                    margin-top: 8px;
                    font-size: 10px;
                    letter-spacing: 1.5px;
                    color: #9a8055;
                }

                .title {
                    text-align: right;
                }

                .title strong {
                    display: block;
                    font-size: 16px;
                    letter-spacing: 2px;
                }

                .title span,
                .title small {
                    display: block;
                    margin-top: 8px;
                    color: #737b87;
                }

                .title b {
                    display: block;
                    margin-top: 5px;
                    font-size: 18px;
                }

                .section {
                    margin-top: 30px;
                }

                .section h4 {
                    margin: 0 0 22px;
                    font-size: 13px;
                    letter-spacing: 2px;
                }

                .grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 25px 45px;
                }

                .grid span,
                .amount span {
                    display: block;
                    font-size: 10px;
                    letter-spacing: 1.5px;
                    color: #8a919b;
                    margin-bottom: 7px;
                }

                .grid strong {
                    font-size: 15px;
                }

                .amount {
                    margin-top: 35px;
                    padding: 24px;
                    border: 1px solid #e5e0d4;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .amount strong {
                    display: block;
                    font-size: 31px;
                    margin-top: 5px;
                }

                .paid {
                    border: 1px solid #c8c8c8;
                    border-radius: 30px;
                    padding: 9px 17px;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                }

                .description {
                    margin-top: 30px;
                    padding: 22px;
                    border: 1px solid #eeeeee;
                    border-radius: 8px;
                }

                .authentication {
                    margin-top: 30px;
                    display: flex;
                    gap: 20px;
                    align-items: center;
                }

                .authentication > span {
                    border: 2px solid #24324a;
                    padding: 9px 16px;
                    font-weight: 800;
                    letter-spacing: 2px;
                }

                .authentication strong,
                .authentication small {
                    display: block;
                }

                .authentication small {
                    margin-top: 6px;
                    color: #737b87;
                }

                .note {
                    margin-top: 35px;
                    text-align: center;
                    color: #777;
                    font-size: 11px;
                }

                @media print {

                    body {
                        padding: 0;
                        background: white;
                    }

                    .receipt {
                        max-width: none;
                        padding: 25px;
                    }

                }

            </style>

        </head>


        <body>

            <div class="receipt">

                <div class="header">

                    <div class="brand-block">

                        <img
                            class="logo"
                            src="../images/service-images/lordbless-header-logo.png"
                            alt="LORDBLESS CONSULTANCY"
                        >

                        <div class="brand">
                            LORDBLESS CONSULTANCY
                        </div>

                    </div>


                    <div class="title">

                        <strong>
                            OFFICIAL PAYMENT RECEIPT
                        </strong>

                        <span>
                            Receipt No.
                        </span>

                        <b>
                            ${escapeHTML(receiptNumber)}
                        </b>

                        <small>
                            Issued ${escapeHTML(
                                formatDate(
                                    issuedAt
                                )
                            )}
                        </small>

                    </div>

                </div>


                <div class="section">

                    <h4>
                        PAYMENT DETAILS
                    </h4>


                    <div class="grid">

                        <div>
                            <span>CLIENT</span>
                            <strong>
                                ${escapeHTML(clientName)}
                            </strong>
                        </div>

                        <div>
                            <span>CLIENT ID</span>
                            <strong>
                                ${escapeHTML(clientId)}
                            </strong>
                        </div>

                        <div>
                            <span>JOURNEY</span>
                            <strong>
                                ${escapeHTML(journey)}
                            </strong>
                        </div>

                        <div>
                            <span>DESTINATION</span>
                            <strong>
                                ${escapeHTML(destination)}
                            </strong>
                        </div>

                        <div>
                            <span>PAYMENT DATE</span>
                            <strong>
                                ${escapeHTML(
                                    formatDate(
                                        paymentDate
                                    )
                                )}
                            </strong>
                        </div>

                        <div>
                            <span>PAYMENT METHOD</span>
                            <strong>
                                ${escapeHTML(paymentMethod)}
                            </strong>
                        </div>

                        <div>
                            <span>PAYMENT REFERENCE</span>
                            <strong>
                                ${escapeHTML(paymentReference)}
                            </strong>
                        </div>

                    </div>

                </div>


                <div class="amount">

                    <div>

                        <span>
                            AMOUNT PAID
                        </span>

                        <strong>
                            ${escapeHTML(
                                formatAmount(
                                    amount,
                                    currency
                                )
                            )}
                        </strong>

                    </div>


                    <div class="paid">
                        ✓ PAID
                    </div>

                </div>


                <div class="section">

                    <h4>
                        DESCRIPTION
                    </h4>

                    <div class="description">
                        ${escapeHTML(description)}
                    </div>

                </div>


                <div class="authentication">

                    <span>
                        PAID
                    </span>

                    <div>

                        <strong>
                            Payment received
                        </strong>

                        <small>
                            Payment received and recorded by
                            LORDBLESS CONSULTANCY.
                        </small>

                    </div>

                </div>


                <div class="note">
                    This receipt was electronically generated.
                    No physical signature is required.
                </div>

            </div>

        </body>

        </html>

    `);


    printWindow.document.close();


    printWindow.focus();


    setTimeout(
        function () {

            printWindow.print();

        },
        500
    );

}


    /* =========================================================
       MESSAGE
    ========================================================= */

    function showMessage(
        message,
        isError = false
    ) {

        const existing =
            document.querySelector(
                ".lbc-client-finance-toast"
            );

        if (existing) {
            existing.remove();
        }


        const toast =
            document.createElement(
                "div"
            );

        toast.className =
            `lbc-client-finance-toast ${
                isError ? "error" : "success"
            }`;

        toast.textContent =
            message;

        document.body.appendChild(
            toast
        );


        setTimeout(
            function () {
                toast.remove();
            },
            4000
        );

    }




    /* =========================================================
       REFRESH
    ========================================================= */

    function refresh(
        data
    ) {

        if (!state.container) {
            return null;
        }


        return render(
            state.container,
            data || state
        );

    }


    /* =========================================================
       SET DATA
    ========================================================= */

    function setData(
        data
    ) {

        data =
            data || {};


        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "client"
            )
        ) {

            state.client =
                data.client;

        }


        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "transactions"
            )
        ) {

            state.transactions =
                Array.isArray(
                    data.transactions
                )
                    ? data.transactions
                    : [];

        }


        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "paymentRequests"
            )
        ) {

            state.paymentRequests =
                Array.isArray(
                    data.paymentRequests
                )
                    ? data.paymentRequests
                    : [];

        }


        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "payments"
            )
        ) {

            state.payments =
                Array.isArray(
                    data.payments
                )
                    ? data.payments
                    : [];

        }


        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "receipts"
            )
        ) {

            state.receipts =
                Array.isArray(
                    data.receipts
                )
                    ? data.receipts
                    : [];

        }


        if (state.container) {

            return render(
                state.container,
                state
            );

        }


        return getState();

    }


    /* =========================================================
       EVENT DATA EXTRACTION
    ========================================================= */

    function extractRequestFromEvent(
        event
    ) {

        const detail =
            event &&
            event.detail;


        if (!detail) {
            return null;
        }


        return (
            detail.paymentRequest ||
            detail.payment_request ||
            detail.request ||
            detail
        );

    }


    function extractVerificationFromEvent(
        event
    ) {

        const detail =
            event &&
            event.detail;


        if (!detail) {
            return null;
        }


        return (
            detail.verification ||
            detail.verificationData ||
            null
        );

    }


    /* =========================================================
       LIVE PAYMENT REQUEST EVENT
    ========================================================= */

    function handlePaymentRequestCreated(
        event
    ) {

        const request =
            extractRequestFromEvent(
                event
            );


        if (!request) {
            return;
        }


        const clientId =
            getClientId(
                state.client
            );


        if (
            !belongsToClient(
                request,
                clientId
            )
        ) {

            return;

        }


        const normalised =
            normalisePaymentRequest(
                request
            );


        if (!normalised) {
            return;
        }


        const existingIndex =
            state.paymentRequests.findIndex(
                function (item) {

                    return (
                        item.id &&
                        normalised.id &&
                        String(item.id) ===
                        String(normalised.id)
                    );

                }
            );


        if (existingIndex >= 0) {

            state.paymentRequests[
                existingIndex
            ] = normalised;

        } else {

            state.paymentRequests.push(
                normalised
            );

        }


        refresh();

    }


    /* =========================================================
       LIVE PAYMENT VERIFICATION EVENT
    ========================================================= */

    function handlePaymentVerified(
        event
    ) {

        const request =
            extractRequestFromEvent(
                event
            );


        if (!request) {
            return;
        }


        const clientId =
            getClientId(
                state.client
            );


        if (
            !belongsToClient(
                request,
                clientId
            )
        ) {

            return;

        }


        const verification =
            extractVerificationFromEvent(
                event
            );


        const normalisedRequest =
            normalisePaymentRequest({

                ...request,

                status:
                    "paid",

                paidAt:
                    request.paidAt ||
                    (
                        verification &&
                        verification.paymentDate
                    ) ||
                    new Date().toISOString(),

                verifiedAt:
                    request.verifiedAt ||
                    (
                        verification &&
                        verification.verifiedAt
                    ) ||
                    new Date().toISOString(),

                verifiedBy:
                    request.verifiedBy ||
                    (
                        verification &&
                        verification.verifiedBy
                    ) ||
                    "Finance",

                receivedAmount:
                    request.receivedAmount ??
                    (
                        verification &&
                        (
                            verification.amountReceived ??
                            verification.receivedAmount
                        )
                    ),

                receivedCurrency:
                    request.receivedCurrency ||
                    (
                        verification &&
                        verification.currency
                    ),

                paymentReference:
                    request.paymentReference ||
                    (
                        verification &&
                        (
                            verification.paymentReference ||
                            verification.transactionReference
                        )
                    )

            });


        const existingIndex =
            state.paymentRequests.findIndex(
                function (item) {

                    return (
                        item.id &&
                        normalisedRequest.id &&
                        String(item.id) ===
                        String(
                            normalisedRequest.id
                        )
                    );

                }
            );


        if (existingIndex >= 0) {

            state.paymentRequests[
                existingIndex
            ] = normalisedRequest;

        } else {

            state.paymentRequests.push(
                normalisedRequest
            );

        }


        const derived =
            derivePaymentsFromRequests([
                normalisedRequest
            ]);


        state.payments =
            mergePayments(
                state.payments,
                derived
            );


        refresh();

    }


    /* =========================================================
       LIVE RECEIPT EVENT
    ========================================================= */

    function handleReceiptIssued(
        event
    ) {

        const detail =
            event &&
            event.detail;


        if (!detail) {
            return;
        }


        const receipt =
            normaliseReceipt(
                detail.receipt ||
                detail
            );


        if (!receipt) {
            return;
        }


        const clientId =
            getClientId(
                state.client
            );


        if (
            !belongsToClient(
                receipt,
                clientId
            )
        ) {

            return;

        }


        const existingIndex =
            state.receipts.findIndex(
                function (item) {

                    return (
                        item.id &&
                        receipt.id &&
                        String(item.id) ===
                        String(receipt.id)
                    );

                }
            );


        if (existingIndex >= 0) {

            state.receipts[
                existingIndex
            ] = receipt;

        } else {

            state.receipts.push(
                receipt
            );

        }


        refresh();

    }


    /* =========================================================
       EVENT LISTENERS
    ========================================================= */

    document.addEventListener(
        "lordbless:payment-request-created",
        handlePaymentRequestCreated
    );


    document.addEventListener(
        "lordbless:payment-verified",
        handlePaymentVerified
    );


    /*
     * Compatibility with the earlier verification event.
     * The current Finance flow uses payment-verified.
     */
    document.addEventListener(
        "lordbless:payment-confirmed",
        handlePaymentVerified
    );


    document.addEventListener(
        "lordbless:receipt-issued",
        handleReceiptIssued
    );


    /*
     * Compatibility with receipt engines that may use
     * receipt-generated.
     */
    document.addEventListener(
        "lordbless:receipt-generated",
        handleReceiptIssued
    );

    document.addEventListener(
    "lordbless:payment-data-updated",
    function (event) {

        const detail =
            event &&
            event.detail;

        if (!detail) {
            return;
        }

        if (
            detail.type !==
            "receipt-updated"
        ) {
            return;
        }

        const receipt =
            detail.payload;

        if (!receipt) {
            return;
        }

        handleReceiptIssued({
            detail: {
                receipt: receipt
            }
        });

    }
);

    /* =========================================================
       STATE ACCESS
    ========================================================= */

    function getState() {

        return {

            client:
                state.client,

            transactions:
                state.transactions.slice(),

            paymentRequests:
                state.paymentRequests.slice(),

            payments:
                state.payments.slice(),

            receipts:
                state.receipts.slice(),

            historyOpen:
                state.historyOpen

        };

    }


    /* =========================================================
       PUBLIC API
    ========================================================= */

    window.LORDBLESS_CLIENT_FINANCE = {

        render,

        refresh,

        setData,

        getState,

        formatAmount,

        formatDate,

        getOutstandingRequests,

        isOutstandingRequest

    };


    console.log(
        COMPONENT_NAME +
        ": Loaded."
    );


})();
