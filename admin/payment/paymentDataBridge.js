/* ============================================================
   LORDBLESS PAYMENT DATA BRIDGE
   ============================================================

   Temporary local/mock communication layer between:

        ADMIN PORTAL
             ↕
        CLIENT PORTAL

   CURRENTLY CONNECTED:
   - Payment Requests

   FUTURE:
   - Payment Records
   - Invoices
   - Receipts
   - Payment History

   This bridge uses the same local portal data store as the
   existing document bridge.

   Production replacement:
   Supabase
   ============================================================ */

(function () {

    "use strict";


    /* ========================================================
       CONFIGURATION
    ======================================================== */

    const STORAGE_KEY =
        "LORDBLESS_PORTAL_DATA_BRIDGE_V1";

    const CHANNEL_NAME =
        "LORDBLESS_PORTAL_CHANNEL_V1";


    /* ========================================================
       LOAD SHARED DATA
    ======================================================== */

    function load() {

        try {

            const raw =
                window.localStorage.getItem(
                    STORAGE_KEY
                );

            if (!raw) {

                return {

                    documentRequests: [],
                    paymentRequests: [],
                    paymentRecords: [],
                    invoices: [],
                    receipts: [],
                    messages: []

                };

            }


            const parsed =
                JSON.parse(raw);

            const storedData =
                parsed && typeof parsed === "object"
                    ? parsed
                    : {};


            return {

                ...storedData,

                documentRequests:
                    Array.isArray(
                        storedData.documentRequests
                    )
                        ? storedData.documentRequests
                        : [],

                paymentRequests:
                    Array.isArray(
                        storedData.paymentRequests
                    )
                        ? storedData.paymentRequests
                        : [],

                paymentRecords:
                    Array.isArray(
                        storedData.paymentRecords
                    )
                        ? storedData.paymentRecords
                        : [],

                invoices:
                    Array.isArray(
                        storedData.invoices
                    )
                        ? storedData.invoices
                        : [],

                receipts:
                    Array.isArray(
                        storedData.receipts
                    )
                        ? storedData.receipts
                        : [],

                messages:
                    Array.isArray(
                        storedData.messages
                    )
                        ? storedData.messages
                        : []

            };

        } catch (error) {

            console.error(
                "LORDBLESS PAYMENT BRIDGE: Unable to load data.",
                error
            );

            return {

                documentRequests: [],
                paymentRequests: [],
                paymentRecords: [],
                invoices: [],
                receipts: [],
                messages: []

            };

        }

    }


    /* ========================================================
       SAVE SHARED DATA
    ======================================================== */

    function save(data) {

        try {

            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(data)
            );

            return true;

        } catch (error) {

            console.error(
                "LORDBLESS PAYMENT BRIDGE: Unable to save data.",
                error
            );

            return false;

        }

    }


    /* ========================================================
       BROADCAST UPDATE
    ======================================================== */

    function broadcast(
        type,
        payload
    ) {

        try {

            if (
                "BroadcastChannel" in window
            ) {

                const channel =
                    new BroadcastChannel(
                        CHANNEL_NAME
                    );

                channel.postMessage({

                    type,
                    payload

                });

                channel.close();

            }

        } catch (error) {

            console.warn(
                "LORDBLESS PAYMENT BRIDGE: Broadcast failed.",
                error
            );

        }


        try {

            window.dispatchEvent(

                new CustomEvent(
                    "lordbless:payment-data-updated",
                    {
                        detail: {

                            type,
                            payload

                        }
                    }
                )

            );

        } catch (error) {

            console.warn(
                "LORDBLESS PAYMENT BRIDGE: Local event failed.",
                error
            );

        }

    }


    /* ========================================================
       SAVE PAYMENT REQUEST
    ======================================================== */

    function savePaymentRequest(
        request
    ) {

        if (
            !request ||
            !request.id
        ) {

            console.warn(
                "LORDBLESS PAYMENT BRIDGE: Invalid payment request."
            );

            return null;

        }


        const isInitialAssessment =
            request.purpose === "initial_assessment_consultation";

        let initialAssessmentAmount =
            null;
        let initialAssessmentDiscount =
            null;

        if (isInitialAssessment) {

            initialAssessmentAmount =
                Number(request.amount);
            initialAssessmentDiscount =
                request.discount === undefined || request.discount === null || request.discount === ""
                    ? 1000 - initialAssessmentAmount
                    : Number(request.discount);

            const initialAssessmentSubtotal =
                request.subtotal === undefined || request.subtotal === null || request.subtotal === ""
                    ? 1000
                    : Number(request.subtotal);

            const initialAssessmentTotal =
                request.total === undefined || request.total === null || request.total === ""
                    ? initialAssessmentAmount
                    : Number(request.total);

            if (
                typeof request.clientId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.clientId) ||
                !Number.isFinite(initialAssessmentAmount) ||
                initialAssessmentAmount <= 0 ||
                initialAssessmentAmount > 1000 ||
                !Number.isFinite(initialAssessmentDiscount) ||
                initialAssessmentDiscount < 0 ||
                initialAssessmentDiscount >= 1000 ||
                !Number.isFinite(initialAssessmentSubtotal) ||
                initialAssessmentSubtotal !== 1000 ||
                !Number.isFinite(initialAssessmentTotal) ||
                Math.abs(initialAssessmentTotal - initialAssessmentAmount) > 0.001 ||
                Math.abs(initialAssessmentAmount - (1000 - initialAssessmentDiscount)) > 0.001 ||
                String(request.currency || "").toUpperCase() !== "GHS"
            ) {

                console.warn(
                    "LORDBLESS PAYMENT BRIDGE: Invalid Initial Assessment & Consultation payment request."
                );

                return null;

            }

        }


        const data =
            load();


        const existingIndex =
            data.paymentRequests.findIndex(

                item =>
                    item &&
                    item.id === request.id

            );


        if (
            isInitialAssessment &&
            existingIndex < 0
        ) {

            const activeStatuses = new Set([
                "requested",
                "awaiting_verification",
                "pending",
                "client_viewed",
                "payment_pending",
                "payment_submitted",
                "submitted",
                "under_review"
            ]);

            const existingActiveRequest =
                data.paymentRequests.find(item => {

                    if (
                        !item ||
                        item.clientId !== request.clientId ||
                        item.purpose !== "initial_assessment_consultation"
                    ) {
                        return false;
                    }

                    const status =
                        String(item.status || "")
                            .trim()
                            .toLowerCase()
                            .replace(/[\s-]+/g, "_");

                    const verificationStatus =
                        String(item.verificationStatus || "")
                            .trim()
                            .toLowerCase();

                    return activeStatuses.has(status) &&
                        verificationStatus !== "verified" &&
                        verificationStatus !== "rejected";

                });

            if (existingActiveRequest) {
                return existingActiveRequest;
            }

        }


        const storedRequest = {

            ...request,

            ...(isInitialAssessment ? {
                amount: initialAssessmentAmount,
                subtotal: 1000,
                discount: initialAssessmentDiscount,
                total: initialAssessmentAmount,
                currency: "GHS",
                journeyId: request.journeyId || null,
                transactionId: request.transactionId || null
            } : {}),

            updatedAt:
                new Date().toISOString()

        };


        if (
            existingIndex >= 0
        ) {

            data.paymentRequests[
                existingIndex
            ] = storedRequest;

        } else {

            data.paymentRequests.unshift(
                storedRequest
            );

        }


        save(data);


        /* Keep existing Admin payment store synchronised. */

        if (
            Array.isArray(
                window.LORDBLESS_PAYMENT_REQUESTS
            )
        ) {

            const adminIndex =
                window.LORDBLESS_PAYMENT_REQUESTS.findIndex(

                    item =>
                        item &&
                        item.id === request.id

                );


            if (
                adminIndex >= 0
            ) {

                window.LORDBLESS_PAYMENT_REQUESTS[
                    adminIndex
                ] = {

                    ...storedRequest

                };

            } else {

                window.LORDBLESS_PAYMENT_REQUESTS.unshift({

                    ...storedRequest

                });

            }

        }


        broadcast(
            "payment-request-updated",
            storedRequest
        );


        return storedRequest;

    }


    /* ========================================================
       GET PAYMENT REQUESTS
    ======================================================== */

    function getPaymentRequests(
        clientId,
        transactionId
    ) {

        const data =
            load();


        return data.paymentRequests.filter(

            request => {

                if (
                    clientId &&
                    request.clientId !== clientId
                ) {

                    return false;

                }


                if (
                    transactionId &&
                    request.transactionId !==
                    transactionId
                ) {

                    return false;

                }


                return true;

            }

        );

    }


    /* ========================================================
       GET SINGLE PAYMENT REQUEST
    ======================================================== */

    function getPaymentRequest(
        requestId
    ) {

        if (!requestId) {

            return null;

        }


        const data =
            load();


        const paymentRequest =
            data.paymentRequests.find(

                request =>
                    request &&
                    request.id === requestId

            ) || null;


        /*
         * Compatibility fallback.
         *
         * The existing Admin Finance engine may already
         * have the payment request in the temporary
         * Admin payment store. If the shared bridge store
         * does not contain the record yet, resolve it from
         * that existing store rather than breaking the
         * verification handoff.
         */

        if (
            !paymentRequest &&
            Array.isArray(
                window.LORDBLESS_PAYMENT_REQUESTS
            )
        ) {

            return (
                window.LORDBLESS_PAYMENT_REQUESTS.find(

                    request =>
                        request &&
                        request.id === requestId

                ) || null
            );

        }


        return paymentRequest;

    }


    /* ========================================================
       GET PAYMENT REQUEST BY ID
       Compatibility API
    ======================================================== */

    function getPaymentRequestById(
        requestId
    ) {

        return getPaymentRequest(
            requestId
        );

    }


    /* ========================================================
       UPDATE PAYMENT REQUEST
    ======================================================== */

    function updatePaymentRequest(
        requestId,
        updates
    ) {

        const existing =
            getPaymentRequest(
                requestId
            );


        if (!existing) {

            return null;

        }


        return savePaymentRequest({

            ...existing,

            ...updates,

            id:
                existing.id,

            updatedAt:
                new Date().toISOString()

        });

    }


    /* ========================================================
       SAVE PAYMENT RECORD
       Future connection
    ======================================================== */

    function savePaymentRecord(
        payment
    ) {

        if (
            !payment ||
            !payment.id
        ) {

            return null;

        }


        const data =
            load();


        const index =
            data.paymentRecords.findIndex(

                item =>
                    item &&
                    item.id === payment.id

            );


        const storedPayment = {

            ...payment,

            updatedAt:
                new Date().toISOString()

        };


        if (index >= 0) {

            data.paymentRecords[index] =
                storedPayment;

        } else {

            data.paymentRecords.unshift(
                storedPayment
            );

        }


        save(data);


        broadcast(
            "payment-record-updated",
            storedPayment
        );


        return storedPayment;

    }


    /* ========================================================
       GET PAYMENT RECORDS
    ======================================================== */

    function getPaymentRecords(
        clientId,
        transactionId
    ) {

        const data =
            load();


        return data.paymentRecords.filter(

            payment => {

                if (
                    clientId &&
                    payment.clientId !== clientId
                ) {

                    return false;

                }


                if (
                    transactionId &&
                    payment.transactionId !==
                    transactionId
                ) {

                    return false;

                }


                return true;

            }

        );

    }


    /* ========================================================
       SAVE INVOICE
       Future connection
    ======================================================== */

    function saveInvoice(
        invoice
    ) {

        if (
            !invoice ||
            !invoice.id
        ) {

            return null;

        }


        const data =
            load();


        const index =
            data.invoices.findIndex(

                item =>
                    item &&
                    item.id === invoice.id

            );


        if (index >= 0) {

            data.invoices[index] = {

                ...invoice,

                updatedAt:
                    new Date().toISOString()

            };

        } else {

            data.invoices.unshift({

                ...invoice,

                updatedAt:
                    new Date().toISOString()

            });

        }


        const storedInvoice =
            data.invoices[
                index >= 0
                    ? index
                    : 0
            ];


        save(data);


        broadcast(
            "invoice-updated",
            storedInvoice
        );


        return storedInvoice;

    }


    /* ========================================================
       GET INVOICES
    ======================================================== */

    function getInvoices(
        clientId,
        transactionId
    ) {

        const data =
            load();


        return data.invoices.filter(

            invoice => {

                if (
                    clientId &&
                    invoice.clientId !== clientId
                ) {

                    return false;

                }


                if (
                    transactionId &&
                    invoice.transactionId !==
                    transactionId
                ) {

                    return false;

                }


                return true;

            }

        );

    }


    /* ========================================================
       SAVE RECEIPT
       Future connection
    ======================================================== */

    function saveReceipt(
        receipt
    ) {

        if (
            !receipt ||
            !receipt.id
        ) {

            return null;

        }


        const data =
            load();


        const index =
            data.receipts.findIndex(

                item =>
                    item &&
                    item.id === receipt.id

            );


        const storedReceipt = {

            ...receipt,

            updatedAt:
                new Date().toISOString()

        };


        if (index >= 0) {

            data.receipts[index] =
                storedReceipt;

        } else {

            data.receipts.unshift(
                storedReceipt
            );

        }


        save(data);


        broadcast(
            "receipt-updated",
            storedReceipt
        );


        return storedReceipt;

    }


    /* ========================================================
       GET RECEIPTS
    ======================================================== */

    function getReceipts(
        clientId,
        transactionId
    ) {

        const data =
            load();


        return data.receipts.filter(

            receipt => {

                if (
                    clientId &&
                    receipt.clientId !== clientId
                ) {

                    return false;

                }


                if (
                    transactionId &&
                    receipt.transactionId !==
                    transactionId
                ) {

                    return false;

                }


                return true;

            }

        );

    }


    /* ========================================================
       CLIENT ALERTS
    ======================================================== */

    function saveMessage(message) {

        if (
            !message ||
            !message.id ||
            !message.clientId
        ) {

            return null;

        }


        const data = load();
        const duplicate = data.messages.find(item =>
            item &&
            item.clientId === message.clientId &&
            (
                item.id === message.id ||
                (
                    message.type === "payment_request" &&
                    item.type === "payment_request" &&
                    item.actionId === message.actionId
                )
            )
        );


        if (duplicate) {
            return duplicate;
        }


        const storedMessage = {
            ...message,
            read: Boolean(message.read),
            readAt: message.readAt || null,
            createdAt: message.createdAt || new Date().toISOString()
        };

        data.messages.unshift(storedMessage);

        if (!save(data)) {
            return null;
        }

        broadcast("message-created", storedMessage);

        return storedMessage;

    }


    function getMessages(clientId) {

        if (!clientId) {
            return [];
        }

        return load().messages
            .filter(message => message && message.clientId === clientId)
            .sort((a, b) =>
                String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
            );

    }


    function getUnreadMessages(clientId) {

        return getMessages(clientId)
            .filter(message => message.read !== true);

    }


    function markMessageAsRead(messageId, clientId) {

        if (!messageId || !clientId) {
            return null;
        }

        const data = load();
        const message = data.messages.find(item =>
            item &&
            item.id === messageId &&
            item.clientId === clientId
        );

        if (!message) {
            return null;
        }

        if (message.read === true) {
            return message;
        }

        message.read = true;
        message.readAt = new Date().toISOString();

        if (!save(data)) {
            return null;
        }

        broadcast("message-read", message);

        return message;

    }


    /* ========================================================
       GLOBAL API
    ======================================================== */

    window.LORDBLESS_PAYMENT_BRIDGE = {

        load,

        save,

        savePaymentRequest,

        getPaymentRequests,

        getPaymentRequest,

        getPaymentRequestById,

        updatePaymentRequest,

        savePaymentRecord,

        getPaymentRecords,

        saveInvoice,

        getInvoices,

        saveReceipt,

        getReceipts,

        saveMessage,

        getMessages,

        getUnreadMessages,

        markMessageAsRead

    };


    /* ========================================================
       READY
    ======================================================== */

    console.log(
        "LORDBLESS PAYMENT DATA BRIDGE: Ready."
    );


    /* =========================================================
       PAYMENT REQUEST EVENT BRIDGE
       Admin Payment Request → Client Portal
       ========================================================= */

    document.addEventListener(

        "lordbless:payment-request-created",

        function (event) {

            const request =
                event.detail;


            if (
                !request ||
                !request.id ||
                !request.clientId
            ) {

                console.warn(

                    "LORDBLESS PAYMENT BRIDGE: Invalid payment request for client alert.",

                    request

                );

                return;

            }


            if (
                window.LORDBLESS_PAYMENT_BRIDGE &&
                typeof
                    window.LORDBLESS_PAYMENT_BRIDGE
                        .savePaymentRequest ===
                    "function"
            ) {

                const savedRequest = window.LORDBLESS_PAYMENT_BRIDGE
                    .savePaymentRequest(
                        request
                    );

                if (!savedRequest) return;

                // Admin normalizes and saves the selected request synchronously
                // during this same event. Read that final saved record before
                // creating its notification so both records share one payload.
                window.setTimeout(() => {
                    const persistedRequest = window.LORDBLESS_PAYMENT_BRIDGE
                        .load()
                        .paymentRequests
                        .find(item => item && item.id === request.id);

                    if (!persistedRequest?.clientId) return;

                    const amount = Number(
                        persistedRequest.total ??
                        persistedRequest.amount ??
                        persistedRequest.amountDue ??
                        persistedRequest.amount_due
                    );
                    const requestCurrency = [
                        persistedRequest.currency,
                        persistedRequest.currencyCode,
                        persistedRequest.currency_code,
                        persistedRequest.primaryCurrency,
                        persistedRequest.primary_currency,
                        persistedRequest.paymentCurrency,
                        persistedRequest.payment_currency,
                        persistedRequest.requestCurrency,
                        persistedRequest.request_currency
                    ]
                        .map(value => String(value || "").trim().toUpperCase())
                        .find(value => ["GHS", "EUR", "USD"].includes(value)) || "EUR";

                    if (!Number.isFinite(amount)) return;

                    let formattedAmount = `${requestCurrency} ${amount.toFixed(2)}`;
                    try {
                        formattedAmount = new Intl.NumberFormat("en-GB", {
                            style: "currency",
                            currency: requestCurrency,
                            currencyDisplay: "code",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        }).format(amount);
                    } catch (error) {
                        // Keep the explicit amount and currency fallback.
                    }

                    const reference = persistedRequest.reference ||
                        persistedRequest.invoiceNumber ||
                        persistedRequest.invoice_number || "";
                    const createdAt = persistedRequest.createdAt ||
                        persistedRequest.created_at ||
                        persistedRequest.requestedDate ||
                        new Date().toISOString();

                    window.LORDBLESS_PAYMENT_BRIDGE.saveMessage({
                        id: `NOTIF-${persistedRequest.id}`,
                        clientId: persistedRequest.clientId,
                        clientName: persistedRequest.clientName || "",
                        clientCode: persistedRequest.clientCode || persistedRequest.client_code || "",
                        type: "payment_request",
                        title: "New Payment Request",
                        message: `A new payment request of ${formattedAmount} has been created for your account.${reference ? ` Payment reference: ${reference}.` : ""}`,
                        paymentRequestId: persistedRequest.id,
                        paymentRequestReference: reference,
                        amount,
                        currency: requestCurrency,
                        createdAt,
                        read: false,
                        readAt: null,
                        actionView: "payments",
                        actionId: persistedRequest.id
                    });

                    console.log(
                        "LORDBLESS PAYMENT BRIDGE: Payment request notification synchronized from the saved record.",
                        persistedRequest
                    );
                }, 0);


                console.log(

                    "LORDBLESS PAYMENT BRIDGE: Payment request synchronized.",

                    request

                );

            }

        }

    );


    window.addEventListener(

        "lordbless:document-request-created",

        function (event) {

            const request =
                event.detail;

            const debugPrefix =
                "[LORDBLESS DOCUMENT ALERT DEBUG]";

            console.log(
                debugPrefix,
                "lordbless:document-request-created received.",
                {
                    id: request?.id,
                    clientId: request?.clientId,
                    transactionId: request?.transactionId,
                    documentName: request?.documentName,
                    documentType: request?.documentType
                }
            );


            if (
                !request ||
                !request.id ||
                !request.clientId
            ) {

                console.warn(

                    "LORDBLESS PAYMENT BRIDGE: Invalid document request for client alert.",

                    request

                );

                return;

            }


            const bridge =
                window.LORDBLESS_PAYMENT_BRIDGE;

            if (
                !bridge ||
                typeof bridge.load !== "function" ||
                typeof bridge.saveMessage !== "function"
            ) {

                console.warn(
                    debugPrefix,
                    "Persistence guard failed: payment bridge load/saveMessage is unavailable."
                );

                return;

            }


            const persistedRequest =
                bridge.load()
                    .documentRequests
                    .find(item =>
                        item &&
                        item.id === request.id &&
                        item.clientId === request.clientId
                    );

            console.log(
                debugPrefix,
                "Request lookup in LORDBLESS_PAYMENT_BRIDGE.load().documentRequests:",
                Boolean(persistedRequest),
                persistedRequest || null
            );

            console.log(
                debugPrefix,
                `Persistence guard ${persistedRequest ? "PASSED" : "FAILED"}.`
            );

            if (!persistedRequest) {
                return;
            }


            const notificationId =
                `NOTIF-DOCUMENT-REQUEST-${request.id}`;

            console.log(
                debugPrefix,
                "Calling saveMessage().",
                { notificationId, clientId: request.clientId }
            );

            const savedMessage = bridge.saveMessage({
                id: notificationId,
                clientId: request.clientId,
                type: "document_request",
                title: "New Document Request",
                message: "A new document request has been created for your account.",
                createdAt: new Date().toISOString(),
                read: false,
                readAt: null,
                actionView: "documents",
                actionId: request.id
            });

            console.log(
                debugPrefix,
                savedMessage === null
                    ? "saveMessage() returned null."
                    : "saveMessage() succeeded.",
                savedMessage
            );

            const storedAlertExists =
                bridge.load()
                    .messages
                    .some(message =>
                        message &&
                        message.id === notificationId &&
                        message.clientId === request.clientId
                    );

            console.log(
                debugPrefix,
                "New alert exists in stored messages collection:",
                storedAlertExists
            );

        }

    );


    window.addEventListener(

        "lordbless:receipt-issued",

        function (event) {

            const detail =
                event && event.detail;

            const receipt =
                detail && detail.receipt;

            if (
                !receipt ||
                !receipt.id ||
                !receipt.clientId ||
                receipt.status !== "issued" ||
                !receipt.paymentRequestId
            ) {
                return;
            }

            const bridge =
                window.LORDBLESS_PAYMENT_BRIDGE;

            if (
                !bridge ||
                typeof bridge.load !== "function" ||
                typeof bridge.saveMessage !== "function"
            ) {
                return;
            }

            const data =
                bridge.load();

            const persistedReceipt =
                data.receipts.find(item =>
                    item &&
                    item.id === receipt.id &&
                    item.clientId === receipt.clientId &&
                    item.paymentRequestId === receipt.paymentRequestId &&
                    item.status === "issued"
                );

            const verifiedPayment =
                data.paymentRequests.find(item =>
                    item &&
                    item.id === receipt.paymentRequestId &&
                    item.clientId === receipt.clientId &&
                    item.status === "paid" &&
                    item.verificationStatus === "verified" &&
                    item.receiptId === receipt.id
                );

            if (!persistedReceipt || !verifiedPayment) {
                return;
            }

            const amount =
                Number(persistedReceipt.amount);

            const currency =
                persistedReceipt.currency ||
                verifiedPayment.currency;

            if (!Number.isFinite(amount) || !currency) {
                return;
            }

            let formattedAmount =
                `${currency} ${amount}`;

            try {
                formattedAmount = new Intl.NumberFormat("en-GB", {
                    style: "currency",
                    currency,
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                }).format(amount);
            } catch (error) {
                // Keep the actual currency and amount if formatting is unavailable.
            }

            bridge.saveMessage({
                id: `NOTIF-RECEIPT-${persistedReceipt.id}`,
                clientId: verifiedPayment.clientId,
                type: "payment_verified",
                title: "Payment Verified",
                message: `Your payment of ${formattedAmount} has been verified. Your official receipt is now available.`,
                createdAt: new Date().toISOString(),
                read: false,
                readAt: null,
                actionView: "payments",
                actionId: persistedReceipt.id
            });

        }

    );

})();
