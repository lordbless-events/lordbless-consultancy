/* ============================================================
   LORDBLESS CONSULTANCY
   ADMIN PAYMENT VERIFICATION
   ------------------------------------------------------------
   Finance/Admin verifies payments received by MoMo,
   Bank Transfer, or other approved channels.
   ============================================================ */

(function () {
    "use strict";


    let verificationState = {
        paymentRequest: null,
        amountReceived: "",
        currency: "EUR",
        paymentDate: "",
        transactionReference: "",
        financeNote: "",
        verifiedBy: ""
    };


    /* ---------------------------------------------------------
       HELPERS
       --------------------------------------------------------- */

    function escapeHtml(value) {

        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    }


    function formatMoney(value, currency) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {

            return "—";

        }


        const number =
            Number(value);


        if (!Number.isFinite(number)) {

            return "—";

        }


        return new Intl.NumberFormat("en", {

            style: "currency",

            currency:
                currency || "EUR",

            minimumFractionDigits: 2

        }).format(number);

    }


    function getClientName() {

        const request =
            verificationState.paymentRequest;


        return (
            request?.client?.name ||
            request?.clientName ||
            "Client"
        );

    }


    function getInvoiceNumber() {

        const request =
            verificationState.paymentRequest;


        return (
            request?.invoiceNumber ||
            request?.reference ||
            "Payment Request"
        );

    }


    function getRequestedAmount() {

        const request =
            verificationState.paymentRequest;


        return Number(
            request?.total ??
            request?.amount ??
            0
        );

    }


    function getRequestedCurrency() {

        const request =
            verificationState.paymentRequest;


        return (
            request?.primaryCurrency ||
            request?.currency ||
            "EUR"
        );

    }


    /* ---------------------------------------------------------
       RENDER
       --------------------------------------------------------- */

   function render(
    container,
    requestId,
    options
) {
    if (!container) {
        return;
    }

    /*
     * The Admin Finance engine passes the
     * payment request ID, not the full object.
     *
     * Resolve the actual payment request from
     * the shared payment bridge.
     */
    let paymentRequest =
        null;

    if (
        requestId &&
        typeof requestId === "object"
    ) {
        paymentRequest =
            requestId;
    } else if (
        window.LORDBLESS_PAYMENT_BRIDGE &&
        typeof
            window.LORDBLESS_PAYMENT_BRIDGE
                .getPaymentRequestById ===
            "function"
    ) {
        paymentRequest =
            window.LORDBLESS_PAYMENT_BRIDGE
                .getPaymentRequestById(
                    requestId
                );
    }

    /*
     * Compatibility fallback for the
     * temporary local payment store.
     */
    if (
        !paymentRequest &&
        Array.isArray(
            window.LORDBLESS_PAYMENT_REQUESTS
        )
    ) {
        paymentRequest =
            window.LORDBLESS_PAYMENT_REQUESTS.find(
                request => {
                    return (
                        request &&
                        request.id ===
                            requestId
                    );
                }
            ) || null;
    }

    if (
        !paymentRequest ||
        !paymentRequest.id
    ) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-title">
                    Payment Request Not Found
                </div>
                <div class="empty-state-text">
                    The selected payment request could not
                    be loaded from the shared payment data.
                </div>
            </div>
        `;

        console.error(
            "LORDBLESS PAYMENT VERIFICATION: " +
            "Could not resolve payment request.",
            requestId
        );

        return;
    }

    const requestedAmount =
        paymentRequest?.total ??
        paymentRequest?.amount ??
        "";

    const requestedCurrency =
        paymentRequest?.primaryCurrency ||
        paymentRequest?.currency ||
        "EUR";


        verificationState = {

            paymentRequest:
                paymentRequest || null,

            amountReceived:
                requestedAmount,

            currency:
                requestedCurrency,

            paymentDate:
                new Date()
                    .toISOString()
                    .split("T")[0],

            transactionReference:
                "",

            financeNote:
                "",

            verifiedBy:
                "",

            onComplete:
                typeof options?.onClose === "function" ? options.onClose : null

        };


        container.innerHTML = `

            <div
                class="lbc-payment-verification"
            >

                <div
                    class="lbc-verification-header"
                >

                    <div>

                        <span
                            class="lbc-payment-eyebrow"
                        >
                            FINANCE
                        </span>


                        <h3>
                            PAYMENT VERIFICATION
                        </h3>


                        <p>
                            Verify that the requested payment has
                            actually been received before confirming it.
                        </p>

                    </div>


                    <span
                        class="lbc-verification-status"
                    >
                        PAYMENT PENDING
                    </span>

                </div>


                <div
                    class="lbc-verification-summary"
                >

                    ${verificationState.paymentRequest?.databaseAssessment ? `
                        <div>
                            <span>CLIENT ID</span>
                            <strong>${escapeHtml(verificationState.paymentRequest.clientCode || "ID pending")}</strong>
                        </div>
                        <div>
                            <span>STANDARD FEE</span>
                            <strong>${formatMoney(verificationState.paymentRequest.standardAmount ?? 1000, "GHS")}</strong>
                        </div>
                        <div>
                            <span>AUTHORIZED DISCOUNT</span>
                            <strong>${formatMoney(verificationState.paymentRequest.discountAmount ?? 0, "GHS")}</strong>
                        </div>
                    ` : ""}

                    <div>

                        <span>
                            CLIENT
                        </span>


                        <strong>
                            ${escapeHtml(
                                getClientName()
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            INVOICE
                        </span>


                        <strong>
                            ${escapeHtml(
                                getInvoiceNumber()
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            AMOUNT DUE
                        </span>


                        <strong>
                            ${formatMoney(
                                getRequestedAmount(),
                                getRequestedCurrency()
                            )}
                        </strong>

                    </div>

                </div>


                <div
                    class="lbc-verification-form"
                >

                    <div
                        class="lbc-verification-row"
                    >

                        <div>

                            <label>
                                AMOUNT RECEIVED
                            </label>


                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value="${escapeHtml(
                                    verificationState.amountReceived
                                )}"
                                data-field="amountReceived"
                            />

                        </div>


                        <div>

                            <label>
                                CURRENCY
                            </label>


                            <select
                                data-field="currency"
                                ${verificationState.paymentRequest?.databaseAssessment ? "disabled" : ""}
                            >

                                <option
                                    value="EUR"
                                    ${
                                        verificationState.currency === "EUR"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    EUR
                                </option>


                                <option
                                    value="GHS"
                                    ${
                                        verificationState.currency === "GHS"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    GHS
                                </option>


                                <option
                                    value="USD"
                                    ${
                                        verificationState.currency === "USD"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    USD
                                </option>


                                <option
                                    value="CAD"
                                    ${
                                        verificationState.currency === "CAD"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    CAD
                                </option>


                                <option
                                    value="GBP"
                                    ${
                                        verificationState.currency === "GBP"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    GBP
                                </option>


                                <option
                                    value="CNY"
                                    ${
                                        verificationState.currency === "CNY"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    CNY
                                </option>

                            </select>

                        </div>


                        <div>

                            <label>
                                PAYMENT DATE
                            </label>


                            <input
                                type="date"
                                value="${escapeHtml(
                                    verificationState.paymentDate
                                )}"
                                data-field="paymentDate"
                            />

                        </div>

                    </div>


                    <div>

                        <label>
                            PAYMENT / TRANSACTION REFERENCE
                        </label>


                        <input
                            type="text"
                            placeholder="Optional MoMo or bank reference"
                            value="${escapeHtml(
                                verificationState.transactionReference
                            )}"
                            data-field="transactionReference"
                        />

                    </div>


                    <div>

                        <label>
                            FINANCE NOTE
                        </label>


                        <textarea
                            placeholder="Optional internal verification note..."
                            data-field="financeNote"
                        >${escapeHtml(
                            verificationState.financeNote
                        )}</textarea>

                    </div>

                </div>


                <div
                    class="lbc-verification-warning"
                >

                    <strong>
                        Important
                    </strong>


                    <span>
                        Only confirm this payment after Finance has
                        independently verified that the funds were received.
                    </span>

                </div>


                <div
                    class="lbc-verification-actions"
                >

                    <button
                        type="button"
                        class="lbc-btn lbc-btn-secondary"
                        data-action="reject"
                    >
                        REJECT PAYMENT
                    </button>


                    <button
                        type="button"
                        class="lbc-btn lbc-btn-primary"
                        data-action="confirm"
                    >
                        CONFIRM PAYMENT
                    </button>

                </div>

            </div>

        `;


        bindEvents(
            container
        );

    }


    /* ---------------------------------------------------------
       EVENTS
       --------------------------------------------------------- */

    function bindEvents(
        container
    ) {

        container
            .querySelectorAll(
                "[data-field]"
            )
            .forEach(
                field => {

                    field.addEventListener(
                        "input",
                        updateField
                    );


                    field.addEventListener(
                        "change",
                        updateField
                    );

                }
            );


        container
            .querySelectorAll(
                "[data-action]"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        function () {

                            if (
                                this.dataset.action ===
                                "confirm"
                            ) {

                                confirmPayment();

                            }


                            if (
                                this.dataset.action ===
                                "reject"
                            ) {

                                rejectPayment();

                            }

                        }
                    );

                }
            );

    }


    function updateField(
        event
    ) {

        const field =
            event.target.dataset.field;


        if (!field) {

            return;

        }


        verificationState[field] =
            event.target.value;

    }


    /* ---------------------------------------------------------
       VALIDATION
       --------------------------------------------------------- */

    function validateVerification() {

        const amount =
            Number(
                verificationState.amountReceived
            );


        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            return (
                "Enter the amount actually received."
            );

        }


        if (
            !verificationState.paymentDate
        ) {

            return (
                "Enter the payment date."
            );

        }


        if (
            !verificationState.paymentRequest
        ) {

            return (
                "Payment request could not be found."
            );

        }


        if (
            !verificationState.paymentRequest.id
        ) {

            return (
                "Payment request ID is missing."
            );

        }


        return null;

    }


    /* ---------------------------------------------------------
       CONFIRM
       --------------------------------------------------------- */

    async function confirmPayment() {

        const currentRequest =
            verificationState.paymentRequest;

        if (
            currentRequest &&
            currentRequest.purpose === "initial_assessment_consultation" &&
            !currentRequest.databaseAssessment
        ) {
            const bridge =
                window.LORDBLESS_PAYMENT_BRIDGE;

            const latestRequest =
                bridge &&
                typeof bridge.getPaymentRequest === "function"
                    ? bridge.getPaymentRequest(currentRequest.id)
                    : null;

            if (!latestRequest) {
                showMessage(
                    "The Initial Assessment payment could not be verified because its current saved request is unavailable.",
                    true
                );
                return;
            }

            verificationState.paymentRequest =
                latestRequest;

            const requestStatus =
                String(latestRequest.status || "")
                    .trim()
                    .toLowerCase()
                    .replace(/[\s-]+/g, "_");

            const verificationStatus =
                String(latestRequest.verificationStatus || "")
                    .trim()
                    .toLowerCase();

            const eligibleStatuses = new Set([
                "requested",
                "client_viewed",
                "payment_pending",
                "payment_submitted",
                "awaiting_verification",
                "pending",
                "submitted",
                "under_review"
            ]);

            if (
                !latestRequest.clientId ||
                !Number.isFinite(Number(latestRequest.amount)) ||
                Number(latestRequest.amount) <= 0 ||
                String(latestRequest.currency || "").toUpperCase() !== "GHS" ||
                String(verificationState.currency || "").toUpperCase() !== "GHS"
            ) {
                showMessage(
                    "This Initial Assessment payment request is invalid and cannot be verified.",
                    true
                );
                return;
            }

            if (
                requestStatus === "paid" ||
                requestStatus === "rejected" ||
                requestStatus === "cancelled" ||
                requestStatus === "canceled" ||
                verificationStatus === "verified" ||
                verificationStatus === "rejected"
            ) {
                showMessage(
                    "This Initial Assessment payment is already finalized and cannot be verified again.",
                    true
                );
                return;
            }

            if (!eligibleStatuses.has(requestStatus)) {
                showMessage(
                    "This Initial Assessment payment has not been requested or submitted for verification.",
                    true
                );
                return;
            }
        }

        const error =
            validateVerification();


        if (error) {

            showMessage(
                error,
                true
            );

            return;

        }


        const requestedAmount =
            getRequestedAmount();


        const receivedAmount =
            Number(
                verificationState.amountReceived
            );


        if (
            verificationState.paymentRequest?.databaseAssessment &&
            (receivedAmount !== requestedAmount ||
                String(verificationState.currency).toUpperCase() !== "GHS")
        ) {
            showMessage(
                `Enter the exact final amount received in GHS (${formatMoney(requestedAmount, "GHS")}).`,
                true
            );
            return;
        }

        if (
            verificationState.currency ===
            getRequestedCurrency() &&
            receivedAmount < requestedAmount
        ) {

            const proceed =
                window.confirm(
                    "The amount received is lower than the amount requested. Confirm this payment anyway?"
                );


            if (!proceed) {

                return;

            }

        }


        const verifiedAt =
            new Date().toISOString();


        /*
         * Keep both field names for compatibility:
         *
         * receivedAmount
         *     Used by the receipt generator.
         *
         * amountReceived
         *     Used by the verification/event layer.
         */
        const verification = {

            status:
                "confirmed",

            receivedAmount:
                receivedAmount,

            amountReceived:
                receivedAmount,

            currency:
                verificationState.currency,

            paymentDate:
                verificationState.paymentDate,

            transactionReference:
                verificationState.transactionReference
                    .trim(),

            financeNote:
                verificationState.financeNote
                    .trim(),

            verifiedAt:
                verifiedAt,

            verifiedBy:
                verificationState.verifiedBy ||
                "Finance"

        };


        const originalRequest =
            verificationState.paymentRequest;

        if (originalRequest?.databaseAssessment) {
            if (!verificationState.transactionReference.trim()) {
                showMessage("Enter the verified bank or mobile money transaction reference.", true);
                return;
            }
            const confirmButton = document.querySelector(
                ".lbc-payment-verification [data-action='confirm']"
            );
            if (confirmButton) confirmButton.disabled = true;
            try {
                const { data: verificationData, error: verificationError } = await lordblessSupabase.rpc(
                    "verify_initial_assessment_payment",
                    {
                        p_payment_id: originalRequest.id,
                        p_amount_received: receivedAmount,
                        p_payment_date: verification.paymentDate,
                        p_transaction_reference: verification.transactionReference,
                        p_finance_note: verification.financeNote || null
                    }
                );
                if (verificationError) throw verificationError;
                const verifiedPayment = verificationData?.payment || {};
                const receiptMessage = verifiedPayment.receipt_number
                    ? ` Receipt ${verifiedPayment.receipt_number} was issued.`
                    : verificationData?.already_verified
                        ? " No duplicate receipt was created."
                        : "";
                showMessage(`Payment of ${formatMoney(requestedAmount, getRequestedCurrency())} verified. Client access is active or will activate after password setup.${receiptMessage}`);
                window.dispatchEvent(new CustomEvent("lordbless:assessment-payment-verified", {
                    detail: { payment: verifiedPayment }
                }));
                if (typeof verificationState.onComplete === "function") {
                    verificationState.onComplete();
                }
            } catch (error) {
                showMessage(error?.message || "The assessment payment could not be verified.", true);
                if (confirmButton) confirmButton.disabled = false;
            }
            return;
        }


        /*
         * The shared payment bridge is the authoritative
         * Admin ↔ Client persistence layer while the system
         * is still running locally.
         */
        let savedRequest =
            null;


        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof
                window.LORDBLESS_PAYMENT_BRIDGE
                    .updatePaymentRequest ===
                "function"
        ) {

            savedRequest =
                window.LORDBLESS_PAYMENT_BRIDGE
                    .updatePaymentRequest(

                        originalRequest.id,

                        {

                            status:
                                "paid",

                            verificationStatus:
                                "verified",

                            verification:
                                verification,

                            paidAt:
                                verification
                                    .paymentDate,

                            verifiedAt:
                                verification
                                    .verifiedAt,

                            updatedAt:
                                verification
                                    .verifiedAt

                        }

                    );

        }

        if (
            originalRequest.purpose === "initial_assessment_consultation" &&
            !savedRequest
        ) {
            showMessage(
                "The Initial Assessment payment verification could not be saved. No receipt was issued.",
                true
            );
            return;
        }


        /*
         * If the bridge is available and saved the request,
         * use the bridge result as the current state.
         *
         * Otherwise keep a local updated representation so
         * the event payload still contains the complete
         * verified payment.
         */
        if (savedRequest) {

            verificationState.paymentRequest =
                savedRequest;

        } else {

            verificationState.paymentRequest = {

                ...originalRequest,

                status:
                    "paid",

                verificationStatus:
                    "verified",

                verification:
                    verification,

                paidAt:
                    verification.paymentDate,

                verifiedAt:
                    verification.verifiedAt,

                updatedAt:
                    verification.verifiedAt

            };

        }


        const payload = {

            paymentRequest:
                verificationState.paymentRequest,

            verification:
                verification

        };


        console.log(
            "LORDBLESS PAYMENT CONFIRMED:",
            payload
        );


        /*
         * Primary verification event.
         */
        document.dispatchEvent(
            new CustomEvent(
                "lordbless:payment-verified",
                {
                    detail:
                        payload
                }
            )
        );


        /*
         * Compatibility event.
         *
         * Existing receipt/admin listeners may already
         * be listening for payment-confirmed.
         */
        document.dispatchEvent(
            new CustomEvent(
                "lordbless:payment-confirmed",
                {
                    detail:
                        payload
                }
            )
        );


        showMessage(
            "Payment confirmed. Generating official receipt..."
        );

    }


    /* ---------------------------------------------------------
       REJECT
       --------------------------------------------------------- */

    function rejectPayment() {

        const reason =
            window.prompt(
                "Reason for rejecting this payment:"
            );


        if (reason === null) {

            return;

        }


        const request =
            verificationState.paymentRequest;


        /*
         * Persist the rejected status when the shared
         * bridge is available.
         */
        let savedRequest =
            null;


        if (
            request &&
            request.id &&
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof
                window.LORDBLESS_PAYMENT_BRIDGE
                    .updatePaymentRequest ===
                "function"
        ) {

            savedRequest =
                window.LORDBLESS_PAYMENT_BRIDGE
                    .updatePaymentRequest(

                        request.id,

                        {

                            status:
                                "rejected",

                            verificationStatus:
                                "rejected",

                            rejectionReason:
                                reason.trim(),

                            verifiedAt:
                                new Date().toISOString(),

                            verifiedBy:
                                verificationState
                                    .verifiedBy ||
                                "Finance"

                        }

                    );

        }


        if (savedRequest) {

            verificationState.paymentRequest =
                savedRequest;

        }


        const payload = {

            paymentRequest:
                verificationState.paymentRequest,

            verification: {

                status:
                    "rejected",

                rejectionReason:
                    reason.trim(),

                verifiedAt:
                    new Date().toISOString(),

                verifiedBy:
                    verificationState.verifiedBy ||
                    "Finance"

            }

        };


        console.log(
            "LORDBLESS PAYMENT REJECTED:",
            payload
        );


        document.dispatchEvent(
            new CustomEvent(
                "lordbless:payment-rejected",
                {
                    detail:
                        payload
                }
            )
        );


        showMessage(
            "Payment marked as rejected."
        );

    }


    /* ---------------------------------------------------------
       MESSAGE
       --------------------------------------------------------- */

    function showMessage(
        message,
        isError = false
    ) {

        const existing =
            document.querySelector(
                ".lbc-payment-toast"
            );


        if (existing) {

            existing.remove();

        }


        const toast =
            document.createElement(
                "div"
            );


        toast.className =
            `lbc-payment-toast ${
                isError
                    ? "error"
                    : "success"
            }`;


        toast.textContent =
            message;


        document.body.appendChild(
            toast
        );


        setTimeout(
            () => {

                toast.remove();

            },
            4000
        );

    }


    /* ---------------------------------------------------------
       PUBLIC API
       --------------------------------------------------------- */

    window.LORDBLESS_PAYMENT_VERIFICATION = {

        render,


        getState: function () {

            return {

                ...verificationState

            };

        }

    };


})();
