/* ============================================================
   LORDBLESS CONSULTANCY | OFFICIAL RECEIPT GENERATOR
   Surgical production version. Bridge logic preserved.
   ============================================================ */
(function () {
    "use strict";

    const RECEIPT_STATUS = Object.freeze({
        ISSUED: "issued",
        VOID: "void"
    });

    const RECEIPT_TYPES = Object.freeze({
        PAYMENT: "payment"
    });

    const RECEIPT_TYPE_LABELS = Object.freeze({
        payment: "Payment Receipt"
    });

    function escapeHTML(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function nowISO() {
        return new Date().toISOString();
    }

    function todayISO() {
        return new Date().toISOString().slice(0, 10);
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(
            String(value).length === 10
                ? value + "T00:00:00"
                : value
        );

        if (Number.isNaN(date.getTime())) {
            return value;
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
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
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

    function formatAmount(amount, currency) {
        const numeric = Number(amount);

        if (!Number.isFinite(numeric)) {
            return "—";
        }

        return new Intl.NumberFormat(
            "en-GB",
            {
                style: "currency",
                currency: currency || "EUR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        ).format(numeric);
    }

    function createId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)
            .toUpperCase()}`;
    }

    function ensureReceiptStore() {

        if (!Array.isArray(window.LORDBLESS_RECEIPTS)) {
            window.LORDBLESS_RECEIPTS = [];
        }

        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof window.LORDBLESS_PAYMENT_BRIDGE
                .getReceipts === "function"
        ) {

            const saved =
                window.LORDBLESS_PAYMENT_BRIDGE
                    .getReceipts();

            if (Array.isArray(saved)) {
                window.LORDBLESS_RECEIPTS =
                    saved.slice();
            }
        }

        return window.LORDBLESS_RECEIPTS;
    }

    function createReceiptNumber() {

        const year =
            new Date().getFullYear();

        const sequence =
            ensureReceiptStore().reduce(
                (max, receipt) => {

                    const match =
                        String(
                            receipt.receiptNumber || ""
                        ).match(
                            /^LBC-REC-(\d{4})-(\d+)$/
                        );

                    if (
                        !match ||
                        Number(match[1]) !== year
                    ) {
                        return max;
                    }

                    return Math.max(
                        max,
                        Number(match[2])
                    );
                },
                0
            ) + 1;

        return (
            `LBC-REC-${year}-` +
            `${String(sequence).padStart(5, "0")}`
        );
    }

    function getCurrentAdminIdentity() {

        const user =
            window.LORDBLESS_CURRENT_USER || {};

        return {
            id:
                user.id ||
                user.userId ||
                "USR-001",

            name:
                user.fullName ||
                user.name ||
                user.email ||
                "LORDBLESS Admin"
        };
    }

    function getPaymentRequest(requestId) {

        if (!requestId) {
            return null;
        }

        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof window.LORDBLESS_PAYMENT_BRIDGE
                .getPaymentRequestById === "function"
        ) {

            return (
                window.LORDBLESS_PAYMENT_BRIDGE
                    .getPaymentRequestById(
                        requestId
                    ) || null
            );
        }

        if (
            window.LORDBLESS_PAYMENT_REQUEST &&
            typeof window.LORDBLESS_PAYMENT_REQUEST
                .get === "function"
        ) {

            return (
                window.LORDBLESS_PAYMENT_REQUEST
                    .get(requestId) || null
            );
        }

        const store =
            Array.isArray(
                window.LORDBLESS_PAYMENT_REQUESTS
            )
                ? window.LORDBLESS_PAYMENT_REQUESTS
                : [];

        return (
            store.find(
                request =>
                    request &&
                    request.id === requestId
            ) || null
        );
    }

    function getExistingReceiptForPayment(
        requestId
    ) {

        return (
            ensureReceiptStore().find(
                receipt =>
                    receipt &&
                    receipt.paymentRequestId ===
                        requestId &&
                    receipt.status !==
                        RECEIPT_STATUS.VOID
            ) || null
        );
    }

    function buildReceiptRecord(data) {

        const request =
            data.paymentRequest;

        const verification =
            data.verification ||
            request.verification ||
            null;

        const admin =
            data.issuedBy ||
            getCurrentAdminIdentity();

        const createdAt =
            data.createdAt ||
            nowISO();

        const paymentReference =
            verification &&
            (
                verification.paymentReference ||
                verification.transactionReference ||
                ""
            );

        const receivedAmount =
            verification &&
            verification.receivedAmount != null

                ? verification.receivedAmount

                : verification &&
                  verification.amountReceived != null

                    ? verification.amountReceived

                    : request.amount;

        return {

            id:
                data.id ||
                createId("REC"),

            receiptNumber:
                data.receiptNumber ||
                createReceiptNumber(),

            receiptType:
                RECEIPT_TYPES.PAYMENT,

            status:
                RECEIPT_STATUS.ISSUED,

            paymentRequestId:
                request.id,

            paymentRequestReference:
                request.reference ||
                null,

            standardAmount:
                Number(request.standardAmount ?? request.standard_amount ?? request.amount ?? 0),

            discountAmount:
                Number(request.discountAmount ?? request.discount_amount ?? 0),

            verificationId:
                verification &&
                verification.id
                    ? verification.id
                    : null,

            clientId:
                request.clientId ||
                null,

            clientName:
                request.clientName ||
                null,

            transactionId:
                request.transactionId ||
                null,

            transactionTitle:
                request.transactionTitle ||
                null,

            destination:
                request.destination ||
                null,

            service:
                request.service ||
                null,

            description:
                request.description ||
                "Payment received",

            paymentType:
                request.requestType ||
                null,

            amount:
                Number(receivedAmount),

            currency:
                (
                    verification &&
                    verification.currency
                ) ||
                request.currency ||
                "EUR",

            paymentDate:
                (
                    verification &&
                    verification.paymentDate
                ) ||
                request.paidAt ||
                todayISO(),

            verifiedAt:
                (verification && verification.verifiedAt) ||
                request.verifiedAt ||
                null,

            verifiedByName:
                (verification && (verification.verifiedByName || verification.verifiedBy)) ||
                request.verifiedByName ||
                null,

            paymentMethod:
                (
                    verification &&
                    (
                        verification.method ||
                        verification.paymentMethod
                    )
                ) ||
                request.paymentMethod ||
                null,

            payerName:
                (
                    verification &&
                    verification.payerName
                ) ||
                request.clientName ||
                null,

            paymentReference:
                paymentReference,

            issuedAt:
                createdAt,

            issuedBy: {
                id:
                    admin.id,

                name:
                    admin.name
            },

            notes:
                data.notes ||
                "",

            verificationStatus:
                request.verificationStatus ||
                "verified",

            createdAt:
                createdAt,

            updatedAt:
                createdAt,

            voidedAt:
                null,

            voidedBy:
                null,

            voidReason:
                null
        };
    }

    function validateVerifiedPayment(request) {

        if (!request) {

            return {
                valid: false,
                message:
                    "Payment request could not be found."
            };
        }

        if (request.status !== "paid") {

            return {
                valid: false,
                message:
                    "Only a paid payment request can receive an official receipt."
            };
        }

        if (
            request.verificationStatus !==
            "verified"
        ) {

            return {
                valid: false,
                message:
                    "The payment must be successfully verified before a receipt can be issued."
            };
        }

        if (!request.verification) {

            return {
                valid: false,
                message:
                    "Verified payment details are missing."
            };
        }

        const amount =
            Number(
                request.verification.receivedAmount ??
                request.verification.amountReceived
            );

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            return {
                valid: false,
                message:
                    "The verified payment amount is invalid."
            };
        }

        return {
            valid: true
        };
    }

    function issueReceipt(
        requestId,
        options
    ) {

        options =
            options || {};

        const request =
            getPaymentRequest(
                requestId
            );

        const validation =
            validateVerifiedPayment(
                request
            );

        if (!validation.valid) {
            return validation;
        }

        const existing =
            getExistingReceiptForPayment(
                requestId
            );

        if (existing) {

            window.dispatchEvent(
                new CustomEvent(
                    "lordbless:receipt-issued",
                    {
                        detail: {
                            receipt: existing,
                            paymentRequest: request
                        }
                    }
                )
            );

            return {
                success: true,
                existing: true,
                receipt: existing,
                message:
                    `Receipt ${existing.receiptNumber} already exists for this payment.`
            };
        }

        let receipt =
            buildReceiptRecord({

                paymentRequest:
                    request,

                verification:
                    request.verification,

                issuedBy:
                    options.issuedBy,

                notes:
                    options.notes
            });

        let persistedReceipt =
            receipt;

        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof window.LORDBLESS_PAYMENT_BRIDGE
                .saveReceipt === "function"
        ) {

            persistedReceipt =
                window.LORDBLESS_PAYMENT_BRIDGE
                    .saveReceipt(
                        receipt
                    ) ||
                receipt;
        }

        const receiptStore =
            ensureReceiptStore();

        if (
            !receiptStore.some(
                item =>
                    item &&
                    item.id ===
                        persistedReceipt.id
            )
        ) {

            receiptStore.unshift(
                persistedReceipt
            );
        }

        receipt =
            persistedReceipt;

        request.receiptId =
            receipt.id;

        request.receiptNumber =
            receipt.receiptNumber;

        request.updatedAt =
            nowISO();

        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof window.LORDBLESS_PAYMENT_BRIDGE
                .updatePaymentRequest ===
                "function"
        ) {

            window.LORDBLESS_PAYMENT_BRIDGE
                .updatePaymentRequest(
                    request.id,
                    {
                        receiptId:
                            receipt.id,

                        receiptNumber:
                            receipt.receiptNumber,

                        updatedAt:
                            request.updatedAt
                    }
                );
        }

        window.dispatchEvent(
            new CustomEvent(
                "lordbless:receipt-issued",
                {
                    detail: {
                        receipt,
                        paymentRequest:
                            request
                    }
                }
            )
        );

        return {
            success: true,
            existing: false,
            receipt,
            message:
                `Receipt ${receipt.receiptNumber} issued successfully.`
        };
    }

    function getReceipt(receiptId) {

        return (
            ensureReceiptStore().find(
                receipt =>
                    receipt &&
                    receipt.id === receiptId
            ) || null
        );
    }

    function getReceiptByNumber(
        receiptNumber
    ) {

        return (
            ensureReceiptStore().find(
                receipt =>
                    receipt &&
                    receipt.receiptNumber ===
                        receiptNumber
            ) || null
        );
    }

    function getReceipts(options) {

        options =
            options || {};

        let receipts =
            ensureReceiptStore().slice();

        if (options.clientId) {

            receipts =
                receipts.filter(
                    receipt =>
                        receipt.clientId ===
                        options.clientId
                );
        }

        if (options.transactionId) {

            receipts =
                receipts.filter(
                    receipt =>
                        receipt.transactionId ===
                        options.transactionId
                );
        }

        if (options.status) {

            receipts =
                receipts.filter(
                    receipt =>
                        receipt.status ===
                        options.status
                );
        }

        return receipts;
    }

    function voidReceipt(
        receiptId,
        reason
    ) {

        const receipt =
            getReceipt(
                receiptId
            );

        if (!receipt) {

            return {
                success: false,
                message:
                    "Receipt could not be found."
            };
        }

        if (
            receipt.status ===
            RECEIPT_STATUS.VOID
        ) {

            return {
                success: false,
                message:
                    "This receipt is already void."
            };
        }

        if (
            !reason ||
            !String(reason).trim()
        ) {

            return {
                success: false,
                message:
                    "A reason is required to void a receipt."
            };
        }

        const admin =
            getCurrentAdminIdentity();

        receipt.status =
            RECEIPT_STATUS.VOID;

        receipt.voidedAt =
            nowISO();

        receipt.voidedBy = {
            id: admin.id,
            name: admin.name
        };

        receipt.voidReason =
            String(reason).trim();

        receipt.updatedAt =
            nowISO();

        if (
            window.LORDBLESS_PAYMENT_BRIDGE &&
            typeof window.LORDBLESS_PAYMENT_BRIDGE
                .saveReceipt === "function"
        ) {

            window.LORDBLESS_PAYMENT_BRIDGE
                .saveReceipt(
                    receipt
                );
        }

        window.dispatchEvent(
            new CustomEvent(
                "lordbless:receipt-voided",
                {
                    detail: {
                        receipt
                    }
                }
            )
        );

        return {
            success: true,
            receipt
        };
    }

    function ensureReceiptStyles() {

        if (
            document.getElementById(
                "lbc-premium-receipt-styles"
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            "lbc-premium-receipt-styles";

        style.textContent = `

.lbc-receipt-preview.lbc-receipt-premium {
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    background: #ffffff;
    color: #182338;
    border: 1px solid #e5e8ee;
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 14px 38px rgba(15,23,42,.10);
    font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
}

.lbc-receipt-premium
.lbc-receipt-document-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 32px;
    padding: 34px 38px 30px;
    border-bottom: 1px solid #e8ebf0;
    background:
        linear-gradient(
            180deg,
            #ffffff 0%,
            #fbfcfe 100%
        );
}

.lbc-receipt-premium
.lbc-receipt-brand-block {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
}

.lbc-receipt-premium
.lbc-receipt-logo {
    display: block;
    width: 76px;
    max-width: 76px;
    height: auto;
    object-fit: contain;
}

.lbc-receipt-premium
.lbc-receipt-brand-name {
    font-size: 21px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: .02em;
    color: #16243d;
}

.lbc-receipt-premium
.lbc-receipt-document-meta {
    min-width: 190px;
    text-align: right;
}

.lbc-receipt-premium
.lbc-receipt-official-label {
    margin-bottom: 10px;
    font-size: 11px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: .16em;
    color: #9a7421;
}

.lbc-receipt-premium
.lbc-receipt-number-label,
.lbc-receipt-premium
.lbc-receipt-issued-date {
    font-size: 12px;
    line-height: 1.5;
    color: #6b7280;
}

.lbc-receipt-premium
.lbc-receipt-number {
    display: block;
    margin: 2px 0 4px;
    font-size: 16px;
    line-height: 1.35;
    font-weight: 800;
    color: #16243d;
    word-break: break-word;
}

.lbc-receipt-premium
.lbc-receipt-section {
    padding: 27px 38px;
    border-bottom: 1px solid #e8ebf0;
}

.lbc-receipt-premium
.lbc-receipt-section-heading {
    margin-bottom: 18px;
    font-size: 11px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: .13em;
    color: #667085;
}

.lbc-receipt-premium
.lbc-receipt-grid {
    display: grid;
    grid-template-columns:
        repeat(2, minmax(0, 1fr));
    column-gap: 42px;
    row-gap: 0;
}

.lbc-receipt-premium
.lbc-receipt-field {
    min-width: 0;
    padding: 13px 0;
    border-top: 1px solid #edf0f4;
}

.lbc-receipt-premium
.lbc-receipt-field:nth-child(-n+2) {
    border-top: 0;
    padding-top: 0;
}

.lbc-receipt-premium
.lbc-receipt-field span {
    display: block;
    margin-bottom: 5px;
    font-size: 10px;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #8a93a3;
}

.lbc-receipt-premium
.lbc-receipt-field strong {
    display: block;
    font-size: 14px;
    line-height: 1.45;
    font-weight: 700;
    color: #26344d;
    overflow-wrap: anywhere;
}

.lbc-receipt-premium
.lbc-receipt-amount-panel {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    margin: 26px 38px;
    padding: 24px 26px;
    border: 1px solid #e6dfcf;
    border-radius: 14px;
    background: #fbf8f1;
}

.lbc-receipt-premium
.lbc-receipt-amount-panel span {
    display: block;
    margin-bottom: 5px;
    font-size: 10px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: .13em;
    color: #7d6a43;
}

.lbc-receipt-premium
.lbc-receipt-amount-panel strong {
    display: block;
    font-size: 28px;
    line-height: 1.15;
    font-weight: 850;
    letter-spacing: -.02em;
    color: #16243d;
    white-space: nowrap;
}

.lbc-receipt-premium
.lbc-receipt-amount-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid #d8e5d9;
    border-radius: 999px;
    background: #f4f9f4;
    color: #285c35;
    font-size: 11px;
    line-height: 1;
    font-weight: 800;
    letter-spacing: .08em;
}

.lbc-receipt-premium
.lbc-receipt-amount-status:before {
    content: "✓";
    font-size: 12px;
}

.lbc-receipt-premium.is-receipt-void
.lbc-receipt-amount-panel {
    border-color: #ead4d4;
    background: #fdf7f7;
}

.lbc-receipt-premium.is-receipt-void
.lbc-receipt-amount-status {
    border-color: #ead4d4;
    background: #fff5f5;
    color: #8a3030;
}

.lbc-receipt-premium.is-receipt-void
.lbc-receipt-amount-status:before {
    content: "!";
}

.lbc-receipt-premium
.lbc-receipt-description-box {
    padding: 16px 18px;
    border: 1px solid #e8ebf0;
    border-radius: 10px;
    background: #fafbfc;
}

.lbc-receipt-premium
.lbc-receipt-description-box p {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: #344054;
}

.lbc-receipt-premium
.lbc-receipt-authentication {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 0 38px;
    padding: 22px 0;
    border-bottom: 1px solid #e8ebf0;
}

.lbc-receipt-premium
.lbc-receipt-paid-stamp {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 76px;
    height: 38px;
    padding: 0 12px;
    border: 2px solid #285c35;
    border-radius: 7px;
    color: #285c35;
    font-size: 13px;
    line-height: 1;
    font-weight: 900;
    letter-spacing: .10em;
    transform: rotate(-3deg);
}

.lbc-receipt-premium.is-receipt-void
.lbc-receipt-paid-stamp {
    border-color: #8a3030;
    color: #8a3030;
}

.lbc-receipt-premium
.lbc-receipt-auth-copy strong {
    display: block;
    margin-bottom: 4px;
    font-size: 13px;
    line-height: 1.35;
    color: #26344d;
}

.lbc-receipt-premium
.lbc-receipt-auth-copy span {
    display: block;
    font-size: 12px;
    line-height: 1.55;
    color: #667085;
}

.lbc-receipt-premium
.lbc-receipt-electronic-notice {
    padding: 18px 38px 24px;
    font-size: 11px;
    line-height: 1.55;
    text-align: center;
    color: #8a93a3;
}

@media (max-width:680px) {

    .lbc-receipt-premium
    .lbc-receipt-document-header {
        flex-direction: column;
        padding: 26px 22px;
    }

    .lbc-receipt-premium
    .lbc-receipt-document-meta {
        width: 100%;
        text-align: left;
    }

    .lbc-receipt-premium
    .lbc-receipt-section {
        padding: 23px 22px;
    }

    .lbc-receipt-premium
    .lbc-receipt-grid {
        grid-template-columns: 1fr;
    }

    .lbc-receipt-premium
    .lbc-receipt-field:nth-child(2) {
        border-top: 1px solid #edf0f4;
        padding-top: 13px;
    }

    .lbc-receipt-premium
    .lbc-receipt-amount-panel {
        margin: 22px;
        padding: 20px;
        flex-direction: column;
        align-items: flex-start;
    }

    .lbc-receipt-premium
    .lbc-receipt-amount-panel strong {
        font-size: 25px;
    }

    .lbc-receipt-premium
    .lbc-receipt-authentication {
        margin: 0 22px;
    }

    .lbc-receipt-premium
    .lbc-receipt-electronic-notice {
        padding-left: 22px;
        padding-right: 22px;
    }
}
`;

        document.head.appendChild(
            style
        );
    }

    function renderReceiptPreview(
        container,
        receipt
    ) {

        if (!container) return;

        if (!receipt) {

            container.innerHTML = `
                <div class="lbc-payment-empty-state">
                    Receipt not found.
                </div>
            `;

            return;
        }

        ensureReceiptStyles();

        const isVoid =
            receipt.status ===
            RECEIPT_STATUS.VOID;

        const logoPath =
            "../images/service-images/lordbless-header-logo.png";

        const companyName =
            "LORDBLESS CONSULTANCY";

        const amount =
            formatAmount(
                receipt.amount,
                receipt.currency
            );

        const statusLabel =
            isVoid
                ? "VOID"
                : "PAID";

        const paymentMethod =
            receipt.paymentMethod ||
            "—";

        const paymentReference =
            receipt.paymentReference ||
            "—";

        const description =
            receipt.description ||
            receipt.service ||
            "Payment received";

        container.innerHTML = `

            <div class="
                lbc-receipt-preview
                lbc-receipt-premium
                ${isVoid ? "is-receipt-void" : ""}
            ">

                <div class="
                    lbc-receipt-document-header
                ">

                    <div class="
                        lbc-receipt-brand-block
                    ">

                        <img
                            src="${logoPath}"
                            alt="${companyName}"
                            class="lbc-receipt-logo"
                        >

                        <div class="
                            lbc-receipt-brand-copy
                        ">

                            <div class="
                                lbc-receipt-brand-name
                            ">
                                ${companyName}
                            </div>

                        </div>

                    </div>

                    <div class="
                        lbc-receipt-document-meta
                    ">

                        <div class="
                            lbc-receipt-official-label
                        ">
                            OFFICIAL PAYMENT RECEIPT
                        </div>

                        <div class="
                            lbc-receipt-number-label
                        ">
                            Receipt No.
                        </div>

                        <strong class="
                            lbc-receipt-number
                        ">
                            ${escapeHTML(
                                receipt.receiptNumber
                            )}
                        </strong>

                        <div class="
                            lbc-receipt-issued-date
                        ">
                            Issued
                            ${escapeHTML(
                                formatDateTime(
                                    receipt.issuedAt
                                )
                            )}
                        </div>

                    </div>

                </div>

                <div class="
                    lbc-receipt-section
                ">

                    <div class="
                        lbc-receipt-section-heading
                    ">
                        PAYMENT DETAILS
                    </div>

                    <div class="
                        lbc-receipt-grid
                    ">

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Client</span>
                            <strong>
                                ${escapeHTML(
                                    receipt.clientName ||
                                    "—"
                                )}
                            </strong>
                        </div>

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Client ID</span>
                            <strong>
                                ${escapeHTML(
                                    receipt.clientId ||
                                    "—"
                                )}
                            </strong>
                        </div>

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Journey</span>
                            <strong>
                                ${escapeHTML(
                                    receipt.transactionTitle ||
                                    "—"
                                )}
                            </strong>
                        </div>

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Destination</span>
                            <strong>
                                ${escapeHTML(
                                    receipt.destination ||
                                    "—"
                                )}
                            </strong>
                        </div>

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Payment Date</span>
                            <strong>
                                ${escapeHTML(
                                    formatDate(
                                        receipt.paymentDate
                                    )
                                )}
                            </strong>
                        </div>

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Payment Method</span>
                            <strong>
                                ${escapeHTML(
                                    paymentMethod
                                )}
                            </strong>
                        </div>

                        <div class="
                            lbc-receipt-field
                        ">
                            <span>Payment Reference</span>
                            <strong>
                                ${escapeHTML(
                                    paymentReference
                                )}
                            </strong>
                        </div>

                        <div class="lbc-receipt-field">
                            <span>Payment Request Reference</span>
                            <strong>${escapeHTML(receipt.paymentRequestReference || "—")}</strong>
                        </div>

                        <div class="lbc-receipt-field">
                            <span>Verified By</span>
                            <strong>${escapeHTML(receipt.verifiedByName?.name || receipt.verifiedByName || "—")}</strong>
                        </div>

                        <div class="lbc-receipt-field">
                            <span>Verification Date</span>
                            <strong>${escapeHTML(formatDateTime(receipt.verifiedAt))}</strong>
                        </div>

                    </div>

                </div>

                <div class="lbc-receipt-section">
                    <div class="lbc-receipt-section-heading">FEE BREAKDOWN</div>
                    <div class="lbc-receipt-grid">
                        <div class="lbc-receipt-field"><span>Standard fee</span><strong>${escapeHTML(formatAmount(receipt.standardAmount ?? receipt.amount, receipt.currency))}</strong></div>
                        <div class="lbc-receipt-field"><span>Discount</span><strong>${escapeHTML(formatAmount(receipt.discountAmount ?? 0, receipt.currency))}</strong></div>
                    </div>
                </div>

                <div class="
                    lbc-receipt-amount-panel
                ">

                    <div>

                        <span>
                            AMOUNT PAID
                        </span>

                        <strong>
                            ${escapeHTML(
                                amount
                            )}
                        </strong>

                    </div>

                    <div class="
                        lbc-receipt-amount-status
                    ">
                        ${statusLabel}
                    </div>

                </div>

                <div class="
                    lbc-receipt-section
                ">

                    <div class="
                        lbc-receipt-section-heading
                    ">
                        DESCRIPTION
                    </div>

                    <div class="
                        lbc-receipt-description-box
                    ">

                        <p>
                            ${escapeHTML(
                                description
                            )}
                        </p>

                    </div>

                </div>

                <div class="
                    lbc-receipt-authentication
                ">

                    <div class="
                        lbc-receipt-paid-stamp
                    ">
                        ${statusLabel}
                    </div>

                    <div class="
                        lbc-receipt-auth-copy
                    ">

                        <strong>
                            ${
                                isVoid
                                    ? "Receipt voided"
                                    : "Payment received"
                            }
                        </strong>

                        <span>
                            ${
                                isVoid
                                    ? "This receipt is no longer valid as a record of payment."
                                    : "Payment received and recorded by LORDBLESS CONSULTANCY."
                            }
                        </span>

                    </div>

                </div>

                <div class="
                    lbc-receipt-electronic-notice
                ">
                    This receipt was electronically generated.
                    No physical signature is required.
                </div>

            </div>
        `;
    }

    function renderReceiptGenerator(
        container,
        requestId,
        options
    ) {

        options =
            options || {};

        if (!container) return;

        const request =
            getPaymentRequest(
                requestId
            );

        const validation =
            validateVerifiedPayment(
                request
            );

        if (!validation.valid) {

            container.innerHTML = `
                <div class="
                    lbc-receipt-generator
                    lbc-payment-empty-state
                ">
                    <h3>
                        Receipt cannot be issued
                    </h3>

                    <p>
                        ${escapeHTML(
                            validation.message
                        )}
                    </p>
                </div>
            `;

            return;
        }

        const existing =
            getExistingReceiptForPayment(
                requestId
            );

        if (existing) {

            container.innerHTML = `

                <div class="
                    lbc-receipt-generator
                ">

                    <div class="
                        lbc-receipt-generator-header
                    ">

                        <div>

                            <span class="
                                lbc-payment-eyebrow
                            ">
                                FINANCE / RECEIPTS
                            </span>

                            <h2>
                                Official Receipt
                            </h2>

                            <p>
                                This verified payment already
                                has an official receipt.
                            </p>

                        </div>

                        <button
                            type="button"
                            class="lbc-payment-close"
                            data-action="
                                close-receipt-generator
                            "
                            aria-label="Close"
                        >
                            ×
                        </button>

                    </div>

                    <div id="
                        lbc-receipt-preview
                    "></div>

                    <div class="
                        lbc-receipt-actions
                    ">

                        <button
                            type="button"
                            class="lbc-payment-secondary"
                            data-action="
                                close-receipt-generator
                            "
                        >
                            Close
                        </button>

                    </div>

                </div>
            `;

            renderReceiptPreview(
                container.querySelector(
                    "#lbc-receipt-preview"
                ),
                existing
            );

            bindReceiptEvents(
                container,
                options
            );

            return;
        }

        const previewReceiptNumber =
            createReceiptNumber();

        const verification =
            request.verification ||
            {};

        const method =
            verification.method ||
            verification.paymentMethod ||
            "—";

        const reference =
            verification.paymentReference ||
            verification.transactionReference ||
            "—";

        const receivedAmount =
            verification.receivedAmount ??
            verification.amountReceived ??
            request.amount;

        container.innerHTML = `

            <div class="
                lbc-receipt-generator
            ">

                <div class="
                    lbc-receipt-generator-header
                ">

                    <div>

                        <span class="
                            lbc-payment-eyebrow
                        ">
                            FINANCE / RECEIPTS
                        </span>

                        <h2>
                            Generate Official Receipt
                        </h2>

                        <p>
                            Issue the permanent LORDBLESS
                            receipt record for this successfully
                            verified payment.
                        </p>

                    </div>

                    <button
                        type="button"
                        class="lbc-payment-close"
                        data-action="
                            close-receipt-generator
                        "
                        aria-label="Close"
                    >
                        ×
                    </button>

                </div>

                <div class="
                    lbc-receipt-verification-notice
                ">

                    <strong>
                        Verified payment
                    </strong>

                    <span>
                        ${escapeHTML(
                            request.reference ||
                            request.id
                        )}

                        ·

                        ${escapeHTML(
                            formatAmount(
                                receivedAmount,
                                verification.currency ||
                                request.currency
                            )
                        )}
                    </span>

                </div>

                <div class="
                    lbc-receipt-generator-grid
                ">

                    <div class="
                        lbc-receipt-generator-panel
                    ">

                        <h3>
                            Payment Record
                        </h3>

                        <div class="
                            lbc-receipt-summary-list
                        ">

                            <div>
                                <span>Client</span>
                                <strong>
                                    ${escapeHTML(
                                        request.clientName ||
                                        "—"
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Journey</span>
                                <strong>
                                    ${escapeHTML(
                                        request.transactionTitle ||
                                        "—"
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Payment Type</span>
                                <strong>
                                    ${escapeHTML(
                                        request.requestType ||
                                        "—"
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Payment Date</span>
                                <strong>
                                    ${escapeHTML(
                                        formatDate(
                                            verification.paymentDate
                                        )
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Method</span>
                                <strong>
                                    ${escapeHTML(
                                        method
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Reference</span>
                                <strong>
                                    ${escapeHTML(
                                        reference
                                    )}
                                </strong>
                            </div>

                        </div>

                    </div>

                    <div class="
                        lbc-receipt-generator-panel
                    ">

                        <h3>
                            Receipt Details
                        </h3>

                        <label class="
                            lbc-payment-field
                        ">

                            <span>
                                Receipt Number
                            </span>

                            <input
                                type="text"
                                value="${escapeHTML(
                                    previewReceiptNumber
                                )}"
                                readonly
                            >

                        </label>

                        <label class="
                            lbc-payment-field
                        ">

                            <span>
                                Receipt Note
                                <small>
                                    (optional)
                                </small>
                            </span>

                            <textarea
                                id="lbc-receipt-note"
                                rows="4"
                                placeholder="
                                    Optional internal or
                                    client-facing note
                                "
                            ></textarea>

                        </label>

                    </div>

                </div>

                <div class="
                    lbc-receipt-actions
                ">

                    <button
                        type="button"
                        class="lbc-payment-secondary"
                        data-action="
                            close-receipt-generator
                        "
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        class="lbc-payment-primary"
                        data-action="issue-receipt"
                    >
                        Issue Official Receipt
                    </button>

                </div>

            </div>
        `;

        bindReceiptEvents(
            container,
            options,
            requestId
        );
    }

    function bindReceiptEvents(
        container,
        options,
        requestId
    ) {

        container
            .querySelectorAll(
                '[data-action="close-receipt-generator"]'
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        () =>
                            closeReceiptGenerator(
                                options
                            )
                    );
                }
            );

        const issueButton =
            container.querySelector(
                '[data-action="issue-receipt"]'
            );

        if (!issueButton) {
            return;
        }

        issueButton.addEventListener(
            "click",
            () => {

                const noteField =
                    container.querySelector(
                        "#lbc-receipt-note"
                    );

                const result =
                    issueReceipt(
                        requestId,
                        {
                            notes:
                                noteField
                                    ? noteField.value.trim()
                                    : ""
                        }
                    );

                if (!result.success) {
                    window.alert(
                        result.message
                    );
                    return;
                }

                if (
                    typeof options.onIssued ===
                    "function"
                ) {

                    options.onIssued(
                        result.receipt,
                        result
                    );
                }

                renderIssuedReceiptState(
                    container,
                    result.receipt,
                    options
                );

                window.alert(
                    result.message
                );
            }
        );
    }

    function renderIssuedReceiptState(
        container,
        receipt,
        options
    ) {

        container.innerHTML = `

            <div class="
                lbc-receipt-generator
            ">

                <div class="
                    lbc-receipt-generator-header
                ">

                    <div>

                        <span class="
                            lbc-payment-eyebrow
                        ">
                            FINANCE / RECEIPTS
                        </span>

                        <h2>
                            Receipt Issued
                        </h2>

                        <p>
                            The official LORDBLESS
                            receipt record has been created.
                        </p>

                    </div>

                    <button
                        type="button"
                        class="lbc-payment-close"
                        data-action="
                            close-receipt-generator
                        "
                        aria-label="Close"
                    >
                        ×
                    </button>

                </div>

                <div id="
                    lbc-receipt-preview
                "></div>

                <div class="
                    lbc-receipt-actions
                ">

                    <button
                        type="button"
                        class="lbc-payment-secondary"
                        data-action="
                            close-receipt-generator
                        "
                    >
                        Close
                    </button>

                </div>

            </div>
        `;

        renderReceiptPreview(
            container.querySelector(
                "#lbc-receipt-preview"
            ),
            receipt
        );

        bindReceiptEvents(
            container,
            options
        );
    }

    function closeReceiptGenerator(
        options
    ) {

        if (
            options &&
            typeof options.onClose ===
                "function"
        ) {

            options.onClose();
            return;
        }

        const modal =
            document.getElementById(
                "enquiry-modal"
            );

        if (modal) {
            modal.classList.add(
                "hidden"
            );
        }
    }

    window.LORDBLESS_RECEIPT_GENERATOR = {

        render:
            renderReceiptGenerator,

        renderReceiptGenerator:
            renderReceiptGenerator,

        build:
            buildReceiptRecord,

        issue:
            issueReceipt,

        get:
            getReceipt,

        getByNumber:
            getReceiptByNumber,

        getAll:
            getReceipts,

        getExistingForPayment:
            getExistingReceiptForPayment,

        void:
            voidReceipt,

        preview:
            renderReceiptPreview,

        statuses:
            RECEIPT_STATUS,

        types:
            RECEIPT_TYPES,

        typeLabels:
            RECEIPT_TYPE_LABELS,

        formatAmount:
            formatAmount,

        formatDate:
            formatDate,

        formatDateTime:
            formatDateTime,

        close:
            closeReceiptGenerator
    };

})();
