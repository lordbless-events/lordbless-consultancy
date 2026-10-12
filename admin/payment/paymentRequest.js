/* ============================================================
   LORDBLESS PAYMENT REQUEST COMPONENT
   ============================================================

   PURPOSE:

   Premium Admin Payment Request Composer.

   FLOW:

   ADMIN
      ↓
   Select Client
      ↓
   Select Service / Support
      ↓
   Enter Amount
      ↓
   Set Due Date
      ↓
   Add Payment Instructions
      ↓
   Review
      ↓
   SEND PAYMENT REQUEST
      ↓
   LORDBLESS PAYMENT DATA BRIDGE
      ↓
   CLIENT PORTAL


   IMPORTANT:

   - Manual pricing is supported now.
   - Standardised pricing can be added later.
   - Existing payment bridge is preserved.
   - Existing payment request API is preserved.
   - Verification, invoices, receipts and history remain separate.
   ============================================================ */

(function () {

    "use strict";


    /* ============================================================
       CONFIGURATION
       ============================================================ */

    const COMPONENT_NAME =
        "LORDBLESS_PAYMENT_REQUEST";


    const DEFAULT_CURRENCY =
        "EUR";


    /* ============================================================
       SERVICE / SUPPORT CATALOGUE
       ============================================================ */

    /*
     * These are currently service labels only.
     *
     * Prices are intentionally NOT hard-coded yet.
     *
     * Later we can add:
     *
     * price
     * currency
     * serviceId
     * category
     * destination
     * journeyType
     *
     * without rebuilding the payment system.
     */

    const PAYMENT_SERVICES = [

        {
            id: "consultation",
            label: "Consultation",
            category: "Professional Support"
        },

        {
            id: "application-admission",
            label: "Application / Admission Support",
            category: "Application Support"
        },

        {
            id: "visa-documentation",
            label: "Visa Documentation Support",
            category: "Visa Support"
        },

        {
            id: "visa-application",
            label: "Visa Application Support",
            category: "Visa Support"
        },

        {
            id: "accommodation",
            label: "Accommodation Assistance",
            category: "Travel Support"
        },

        {
            id: "airport-pickup",
            label: "Airport Pickup",
            category: "Travel Support"
        },

        {
            id: "translation-documentation",
            label: "Translation / Documentation",
            category: "Documentation"
        },

        {
            id: "travel-relocation",
            label: "Travel & Relocation Support",
            category: "Relocation"
        },

        {
            id: "business-travel",
            label: "Business Travel Support",
            category: "Business Travel"
        },

        {
            id: "additional-support",
            label: "Additional Service / Support",
            category: "Other"
        }

    ];


    /* ============================================================
       INTERNAL HELPERS
       ============================================================ */

    function bridgeAvailable() {

        return (
            typeof window.LORDBLESS_PAYMENT_BRIDGE !==
            "undefined"
        );

    }


    function paymentModelAvailable() {

        return (
            typeof window.LORDBLESS_PAYMENT_MODEL !==
            "undefined"
        );

    }


    function now() {

        return new Date().toISOString();

    }


    function createId() {

        return (
            "LBC-PAYREQ-" +
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase()
        );

    }


    function escapeHtml(value) {

        return String(
            value === null ||
            typeof value === "undefined"
                ? ""
                : value
        )
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    }


    function getClientId(client) {

        if (!client) {
            return "";
        }

        return (
            client.id ||
            client.clientId ||
            client.reference ||
            ""
        );

    }


    function getClientName(client) {

        if (!client) {
            return "";
        }

        return (
            client.fullName ||
            client.name ||
            client.full_name ||
            [
                client.firstName,
                client.lastName
            ]
                .filter(Boolean)
                .join(" ") ||
            ""
        );

    }


    function getClientEmail(client) {

        if (!client) {
            return "";
        }

        return (
            client.email ||
            client.emailAddress ||
            ""
        );

    }


    function getJourneyId(journey) {

        if (!journey) {
            return "";
        }

        return (
            journey.id ||
            journey.journeyId ||
            journey.reference ||
            journey.enquiry_reference ||
            ""
        );

    }


    function getTransactionId(journey) {

        if (!journey) {
            return "";
        }

        return (
            journey.transactionId ||
            journey.transaction_id ||
            journey.id ||
            journey.reference ||
            journey.enquiry_reference ||
            ""
        );

    }


    function getJourneyTitle(journey) {

        if (!journey) {
            return "";
        }

        return (
            journey.title ||
            journey.name ||
            journey.service ||
            "Client Journey"
        );

    }


    function getJourneyDestination(journey) {

        if (!journey) {
            return "";
        }

        return (
            journey.destination ||
            journey.country ||
            ""
        );

    }


    function getCurrencySymbol(currency) {

        const symbols = {

            EUR: "€",
            USD: "$",
            GHS: "₵",
            GBP: "£",
            CAD: "$"

        };

        return (
            symbols[currency] ||
            currency ||
            ""
        );

    }


    function formatAmount(
        amount,
        currency = DEFAULT_CURRENCY
    ) {

        const numeric =
            Number(amount) || 0;

        return (
            getCurrencySymbol(currency) +
            numeric.toLocaleString(
                undefined,
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            )
        );

    }


    /* ============================================================
       CREATE PAYMENT REQUEST
       ============================================================ */

    function createPaymentRequest(data) {

        data = data || {};
        const isInitialAssessment =
            data.purpose === "initial_assessment_consultation";


        if (!bridgeAvailable()) {

            console.error(
                COMPONENT_NAME +
                ": Payment Data Bridge is not available."
            );

            return null;

        }


        if (!data.clientId) {

            console.error(
                COMPONENT_NAME +
                ": Client ID is required."
            );

            return null;

        }


        if (!data.transactionId && !isInitialAssessment) {

            console.error(
                COMPONENT_NAME +
                ": Transaction ID is required."
            );

            return null;

        }


        if (
            Number(data.amount) <= 0
        ) {

            console.error(
                COMPONENT_NAME +
                ": Payment amount must be greater than zero."
            );

            return null;

        }


        let request;


        /*
         * Prefer the central payment data model.
         */

        if (
            paymentModelAvailable() &&
            typeof window
                .LORDBLESS_PAYMENT_MODEL
                .createPaymentRequest ===
            "function"
        ) {

            request =
                window
                    .LORDBLESS_PAYMENT_MODEL
                    .createPaymentRequest({

                        ...data,

                        id:
                            data.id ||
                            createId(),

                        createdAt:
                            data.createdAt ||
                            now(),

                        updatedAt:
                            now()

                    });

        } else {

            /*
             * Temporary fallback.
             */

            request = {

                id:
                    data.id ||
                    createId(),

                reference:
                    data.reference ||
                    createId(),

                clientId:
                    data.clientId,

                clientName:
                    data.clientName ||
                    "",

                clientEmail:
                    data.clientEmail ||
                    "",

                journeyId:
                    data.journeyId ||
                    "",

                transactionId:
                    data.transactionId,

                transactionTitle:
                    data.transactionTitle ||
                    "",

                destination:
                    data.destination ||
                    "",

                service:
                    data.service ||
                    "",

                requestType:
                    data.requestType ||
                    "Service Fee",

                purpose:
                    data.purpose ||
                    null,

                title:
                    data.title ||
                    "",

                description:
                    data.description ||
                    "",

                serviceItems:
                    Array.isArray(data.serviceItems)
                        ? data.serviceItems
                        : [],

                items:
                    Array.isArray(data.items)
                        ? data.items
                        : [],

                amount:
                    Number(data.amount) || 0,

                subtotal:
                    Number(data.subtotal ?? data.amount) || 0,

                discount:
                    Number(data.discount) || 0,

                total:
                    Number(data.total ?? data.amount) || 0,

                currency:
                    data.currency ||
                    DEFAULT_CURRENCY,

                dueDate:
                    data.dueDate ||
                    "",

                paymentInstructions:
                    data.paymentInstructions ||
                    "",

                adminNote:
                    data.adminNote ||
                    "",

                status:
                    data.status ||
                    "Requested",

                invoiceId:
                    data.invoiceId ||
                    null,

                paymentId:
                    data.paymentId ||
                    null,

                receiptId:
                    data.receiptId ||
                    null,

                createdAt:
                    data.createdAt ||
                    now(),

                updatedAt:
                    now()

            };

        }


        /*
         * Save through shared bridge.
         */

        const savedRequest =
            window
                .LORDBLESS_PAYMENT_BRIDGE
                .savePaymentRequest(
                    request
                );


        return savedRequest;

    }


    /* ============================================================
       UPDATE PAYMENT REQUEST
       ============================================================ */

    function updatePaymentRequest(
        requestId,
        updates
    ) {

        if (!bridgeAvailable()) {

            console.error(
                COMPONENT_NAME +
                ": Payment Data Bridge is not available."
            );

            return null;

        }


        return window
            .LORDBLESS_PAYMENT_BRIDGE
            .updatePaymentRequest(
                requestId,
                updates || {}
            );

    }


    /* ============================================================
       GET PAYMENT REQUEST
       ============================================================ */

    function getPaymentRequest(
        requestId
    ) {

        if (!bridgeAvailable()) {
            return null;
        }


        return window
            .LORDBLESS_PAYMENT_BRIDGE
            .getPaymentRequestById(
                requestId
            );

    }


    /* ============================================================
       GET CLIENT PAYMENT REQUESTS
       ============================================================ */

    function getClientPaymentRequests(
        clientId
    ) {

        if (!bridgeAvailable()) {
            return [];
        }


        return window
            .LORDBLESS_PAYMENT_BRIDGE
            .getPaymentRequests(
                clientId
            );

    }


    /* ============================================================
       GET JOURNEY PAYMENT REQUESTS
       ============================================================ */

    function getJourneyPaymentRequests(
        clientId,
        journeyId
    ) {

        if (!bridgeAvailable()) {
            return [];
        }


        return window
            .LORDBLESS_PAYMENT_BRIDGE
            .getPaymentRequests(
                clientId,
                journeyId
            );

    }


    /* ============================================================
       GET TRANSACTION PAYMENT REQUESTS
       ============================================================ */

    function getTransactionPaymentRequests(
        clientId,
        journeyId,
        transactionId
    ) {

        if (!bridgeAvailable()) {
            return [];
        }


        return window
            .LORDBLESS_PAYMENT_BRIDGE
            .getPaymentRequests(
                clientId,
                journeyId,
                transactionId
            );

    }


    /* ============================================================
       CANCEL PAYMENT REQUEST
       ============================================================ */

    function cancelPaymentRequest(
        requestId
    ) {

        return updatePaymentRequest(

            requestId,

            {
                status: "Cancelled",
                cancelledAt: now()
            }

        );

    }


    /* ============================================================
       MARK PAYMENT REQUEST AS VIEWED
       ============================================================ */

    function markAsViewed(
        requestId
    ) {

        return updatePaymentRequest(

            requestId,

            {
                status: "Client Viewed",
                viewedAt: now()
            }

        );

    }


    /* ============================================================
       MARK PAYMENT REQUEST AS PAYMENT PENDING
       ============================================================ */

    function markPaymentPending(
        requestId
    ) {

        return updatePaymentRequest(

            requestId,

            {
                status: "Payment Pending",
                paymentPendingAt: now()
            }

        );

    }


    /* ============================================================
       CREATE REQUEST FROM FORM DATA
       ============================================================ */

    function createFromForm(
        formData
    ) {

        if (!formData) {
            return null;
        }

        const isInitialAssessment =
            formData.purpose === "initial_assessment_consultation";


        let selectedServices = [];


        if (
            Array.isArray(
                formData.serviceItems
            )
        ) {

            selectedServices =
                formData.serviceItems;

        } else if (
            formData.serviceItems
        ) {

            selectedServices = [
                formData.serviceItems
            ];

        }


        /*
         * Backward compatibility with a single service field.
         */

        if (
            !selectedServices.length &&
            formData.service
        ) {

            selectedServices = [
                formData.service
            ];

        }


        const serviceLabels =
            selectedServices
                .map(
                    function (serviceId) {

                        const service =
                            PAYMENT_SERVICES.find(
                                item =>
                                    item.id ===
                                    serviceId
                            );

                        return service
                            ? service.label
                            : serviceId;

                    }
                );


        const title =
            formData.title ||
            (
                serviceLabels.length
                    ? serviceLabels.join(
                        " + "
                    )
                    : "Payment Request"
            );


        const description =
            formData.description ||
            (
                serviceLabels.length
                    ? serviceLabels.join(
                        ", "
                    )
                    : ""
            );


        return createPaymentRequest({

            id:
                formData.id,

            clientId:
                formData.clientId,

            clientName:
                formData.clientName ||
                "",

            clientEmail:
                formData.clientEmail ||
                "",

            journeyId:
                formData.journeyId ||
                "",

            transactionId:
                formData.transactionId,

            transactionTitle:
                formData.transactionTitle ||
                "",

            destination:
                formData.destination ||
                "",

            service:
                serviceLabels.join(
                    " + "
                ),

            requestType:
                formData.requestType ||
                "Service Fee",

            purpose:
                formData.purpose ||
                null,

            title,

            description,

            serviceItems:
                selectedServices,

            items:
                selectedServices.map(
                    function (serviceId) {

                        const service =
                            PAYMENT_SERVICES.find(
                                item =>
                                    item.id ===
                                    serviceId
                            );

                        return {

                            id:
                                serviceId,

                            serviceId:
                                serviceId,

                            label:
                                service
                                    ? service.label
                                    : serviceId,

                            category:
                                service
                                    ? service.category
                                    : "",

                            amount:
                                null

                        };

                    }
                ),

            amount:
                Number(
                    formData.amount
                ) || 0,

            subtotal:
                Number(
                    formData.subtotal ||
                    formData.amount
                ) || 0,

            discount:
                Number(formData.discount) || 0,

            total:
                Number(
                    formData.total ||
                    formData.amount
                ) || 0,

            currency:
                formData.currency ||
                DEFAULT_CURRENCY,

            dueDate:
                formData.dueDate ||
                "",

            paymentInstructions:
                formData.paymentInstructions ||
                "",

            adminNote:
                formData.adminNote ||
                ""

        });

    }


    /* ============================================================
       FORM SERIALIZATION
       ============================================================ */

    function serializeForm(
        form
    ) {

        if (!form) {
            return {};
        }


        const formData =
            new FormData(form);

        const data = {};


        formData.forEach(
            function (value, key) {

                /*
                 * Support multiple checkbox values.
                 */

                if (
                    Object.prototype.hasOwnProperty
                        .call(data, key)
                ) {

                    if (
                        !Array.isArray(
                            data[key]
                        )
                    ) {

                        data[key] = [
                            data[key]
                        ];

                    }


                    data[key].push(value);

                } else {

                    data[key] = value;

                }

            }
        );


        return data;

    }


    /* ============================================================
       FORM SUBMISSION HANDLER
       ============================================================ */

    async function handleFormSubmit(
        event
    ) {

        if (event) {
            event.preventDefault();
        }


        const form =
            event &&
            event.currentTarget
                ? event.currentTarget
                : null;


        if (!form) {
            return null;
        }


        const formData =
            serializeForm(form);


        /*
         * Validate service selection.
         */

        const selectedServices =
            Array.isArray(
                formData.serviceItems
            )
                ? formData.serviceItems
                : formData.serviceItems
                    ? [
                        formData.serviceItems
                    ]
                    : [];

        const isInitialAssessment =
            formData.purpose === "initial_assessment_consultation";


        if (!selectedServices.length && !isInitialAssessment) {

            showFormMessage(
                form,
                "Please select at least one service or support item.",
                "error"
            );

            return null;

        }

        if (isInitialAssessment) {
            const discount = Number(formData.discount) || 0;

            if (discount < 0 || discount >= 1000) {
                showFormMessage(
                    form,
                    "The discount must be less than GHS 1,000. A zero-value payment request was not created.",
                    "error"
                );
                return null;
            }

            const finalAmount = 1000 - discount;
            formData.subtotal = "1000";
            formData.total = String(finalAmount);
            formData.amount = String(finalAmount);
            formData.currency = "GHS";
            formData.title = "Initial Assessment & 30-Minute Consultation";
            formData.description = "Initial Assessment & 30-Minute Consultation";
            formData.requestType = "Initial Assessment & 30-Minute Consultation";
        }


        if (
            !Number(formData.amount) ||
            Number(formData.amount) <= 0
        ) {

            showFormMessage(
                form,
                "Please enter a valid payment amount.",
                "error"
            );

            return null;

        }

        if (isInitialAssessment && formData.databaseAssessment === "true") {
            const submitButton = form.querySelector('[type="submit"]');
            if (typeof lordblessSupabase === "undefined") {
                showFormMessage(form, "The secure assessment payment service is unavailable.", "error");
                return null;
            }

            if (submitButton) submitButton.disabled = true;
            try {
                const { data, error } = await lordblessSupabase.rpc(
                    "request_initial_assessment_payment",
                    {
                        p_client_id: formData.clientId,
                        p_discount_amount: Number(formData.discount) || 0
                    }
                );
                if (error) throw error;

                const payment = data?.payment || data;
                if (!payment?.id) {
                    throw new Error("The saved assessment request response was incomplete.");
                }

                window.dispatchEvent(new CustomEvent("lordbless:assessment-payment-request-created", {
                    detail: { payment, created: Boolean(data?.created) }
                }));

                showFormMessage(
                    form,
                    data?.created
                        ? "Assessment payment request created. The client can now see the saved amount and payment instructions in Finance."
                        : "The existing assessment request was reused. Its saved amount and discount were not changed.",
                    "success"
                );
                setTimeout(() => closeComposer(form.closest(".lordbless-payment-modal")), 1500);
                return payment;
            } catch (error) {
                showFormMessage(form, error?.message || "The assessment payment request could not be saved.", "error");
                if (submitButton) submitButton.disabled = false;
                return null;
            }
        }


        const request =
            createFromForm(
                formData
            );


        if (!request) {

            showFormMessage(
                form,
                "Payment request could not be created.",
                "error"
            );

            return null;

        }


        /*
         * Correct event structure:
         *
         * detail = request
         *
         * This matches the payment bridge listener.
         */

        try {

            form.dispatchEvent(

                new CustomEvent(
                    "lordbless:payment-request-created",
                    {
                        bubbles: true,
                        detail: request
                    }
                )

            );

        } catch (error) {

            console.warn(
                COMPONENT_NAME +
                ": Could not dispatch creation event.",
                error
            );

        }


        showFormMessage(
            form,
            "Payment request created successfully.",
            "success"
        );


        /*
         * Give the Admin UI time to display
         * the confirmation before closing.
         */

        setTimeout(
            function () {

                closeComposer(
                    form.closest(
                        ".lordbless-payment-modal"
                    )
                );

                document.dispatchEvent(

                    new CustomEvent(
                        "lordbless:payment-request-ready",
                        {
                            detail: request
                        }
                    )

                );

            },
            700
        );


        return request;

    }


    /* ============================================================
       FORM MESSAGE
       ============================================================ */

    function showFormMessage(
        form,
        message,
        type
    ) {

        if (!form) {
            return;
        }


        let messageBox =
            form.querySelector(
                ".lordbless-payment-form-message"
            );


        if (!messageBox) {

            messageBox =
                document.createElement(
                    "div"
                );

            messageBox.className =
                "lordbless-payment-form-message";


            form.prepend(
                messageBox
            );

        }


        messageBox.textContent =
            message;


        messageBox.dataset.type =
            type || "info";

    }


    /* ============================================================
       ATTACH FORM
       ============================================================ */

    function attachForm(
        form
    ) {

        if (!form) {
            return false;
        }


        if (
            form.dataset
                .lordblessPaymentRequestAttached ===
            "true"
        ) {

            return true;

        }


        form.addEventListener(
            "submit",
            handleFormSubmit
        );


        form.dataset
            .lordblessPaymentRequestAttached =
            "true";


        return true;

    }


    /* ============================================================
       AUTO-DETECT PAYMENT REQUEST FORMS
       ============================================================ */

    function attachForms(
        root
    ) {

        root =
            root ||
            document;


        const forms =
            root.querySelectorAll(
                "[data-payment-request-form]"
            );


        forms.forEach(
            function (form) {
                attachForm(form);
            }
        );


        return forms.length;

    }


    /* ============================================================
       PREMIUM COMPOSER CSS
       ============================================================ */

    function injectStyles() {

        if (
            document.getElementById(
                "lordbless-payment-request-styles"
            )
        ) {

            return;

        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            "lordbless-payment-request-styles";


        style.textContent = `

        .lordbless-payment-modal {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(7, 20, 38, 0.58);
            backdrop-filter: blur(5px);
        }

        .lordbless-payment-modal.hidden {
            display: none;
        }

        .lordbless-payment-dialog {
            width: min(720px, 100%);
            max-height: 92vh;
            overflow-y: auto;
            background: #ffffff;
            border-radius: 18px;
            box-shadow: 0 24px 80px rgba(0,0,0,0.24);
            border: 1px solid rgba(190, 150, 60, 0.22);
        }

        .lordbless-payment-header {
            padding: 26px 30px 22px;
            background: linear-gradient(
                135deg,
                #07182f,
                #102d50
            );
            color: #ffffff;
        }

        .lordbless-payment-eyebrow {
            margin-bottom: 7px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: #d4af5a;
        }

        .lordbless-payment-title {
            margin: 0;
            font-size: 25px;
            font-weight: 700;
        }

        .lordbless-payment-subtitle {
            margin: 8px 0 0;
            font-size: 13px;
            opacity: .78;
        }

        .lordbless-payment-body {
            padding: 28px 30px;
        }

        .lordbless-payment-client {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 25px;
        }

        .lordbless-payment-context {
            padding: 14px 16px;
            border: 1px solid #e5e9ef;
            border-radius: 11px;
            background: #f8fafc;
        }

        .lordbless-payment-context-label {
            display: block;
            margin-bottom: 5px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: #7a8492;
        }

        .lordbless-payment-context-value {
            font-size: 14px;
            font-weight: 600;
            color: #152238;
        }

        .lordbless-payment-section {
            margin-top: 24px;
        }

        .lordbless-payment-section-title {
            margin: 0 0 12px;
            font-size: 13px;
            font-weight: 700;
            color: #152238;
            text-transform: uppercase;
            letter-spacing: .8px;
        }

        .lordbless-payment-service-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .lordbless-payment-service {
            position: relative;
        }

        .lordbless-payment-service input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }

        .lordbless-payment-service label {
            display: block;
            min-height: 68px;
            padding: 13px 14px;
            border: 1px solid #dfe4eb;
            border-radius: 11px;
            cursor: pointer;
            background: #ffffff;
            transition:
                border-color .18s ease,
                background .18s ease,
                transform .18s ease,
                box-shadow .18s ease;
        }

        .lordbless-payment-service label:hover {
            border-color: #c6a04d;
            transform: translateY(-1px);
        }

        .lordbless-payment-service input:checked + label {
            border-color: #c6a04d;
            background: #fffaf0;
            box-shadow: 0 4px 14px rgba(160,120,40,.10);
        }

        .lordbless-payment-service-name {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: #17253a;
        }

        .lordbless-payment-service-category {
            display: block;
            margin-top: 5px;
            font-size: 10px;
            color: #7c8795;
        }

        .lordbless-payment-field {
            margin-top: 18px;
        }

        .lordbless-payment-field label {
            display: block;
            margin-bottom: 7px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .6px;
            text-transform: uppercase;
            color: #536071;
        }

        .lordbless-payment-field input,
        .lordbless-payment-field select,
        .lordbless-payment-field textarea {
            width: 100%;
            box-sizing: border-box;
            padding: 12px 13px;
            border: 1px solid #d9dfe7;
            border-radius: 9px;
            outline: none;
            background: #ffffff;
            color: #17253a;
            font: inherit;
        }

        .lordbless-payment-field input:focus,
        .lordbless-payment-field select:focus,
        .lordbless-payment-field textarea:focus {
            border-color: #c6a04d;
            box-shadow: 0 0 0 3px rgba(198,160,77,.12);
        }

        .lordbless-payment-amount-row {
            display: grid;
            grid-template-columns: 1fr 150px;
            gap: 12px;
        }

        .lordbless-payment-summary {
            margin-top: 20px;
            padding: 17px 18px;
            border-radius: 11px;
            background: #f7f8fa;
            border: 1px solid #e5e8ed;
        }

        .lordbless-payment-summary-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #7b8490;
        }

        .lordbless-payment-summary-value {
            margin-top: 5px;
            font-size: 23px;
            font-weight: 700;
            color: #102c4d;
        }

        .lordbless-payment-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 20px 30px;
            border-top: 1px solid #edf0f3;
            background: #fbfcfd;
        }

        .lordbless-payment-btn {
            border: 0;
            border-radius: 9px;
            padding: 11px 18px;
            font: inherit;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
        }

        .lordbless-payment-btn-secondary {
            background: #eef1f5;
            color: #394658;
        }

        .lordbless-payment-btn-primary {
            background: #c6a04d;
            color: #07182f;
        }

        .lordbless-payment-btn-primary:hover {
            background: #d4b261;
        }

        .lordbless-payment-form-message {
            display: none;
            margin-bottom: 18px;
            padding: 11px 13px;
            border-radius: 8px;
            font-size: 12px;
        }

        .lordbless-payment-form-message[data-type="error"] {
            display: block;
            background: #fff1f1;
            color: #a12929;
            border: 1px solid #f0c8c8;
        }

        .lordbless-payment-form-message[data-type="success"] {
            display: block;
            background: #eefaf3;
            color: #237044;
            border: 1px solid #c8e8d5;
        }

        @media (max-width: 650px) {

            .lordbless-payment-client,
            .lordbless-payment-service-grid,
            .lordbless-payment-amount-row {
                grid-template-columns: 1fr;
            }

            .lordbless-payment-body {
                padding: 22px;
            }

            .lordbless-payment-footer {
                padding: 16px 22px;
            }

        }

        `;


        document.head.appendChild(
            style
        );

    }


    /* ============================================================
       CLOSE COMPOSER
       ============================================================ */

    function closeComposer(
        modal
    ) {

        if (!modal) {
            return;
        }


        modal.remove();

    }


    /* ============================================================
       RENDER PREMIUM PAYMENT REQUEST COMPOSER
       ============================================================ */

    function render(
        container,
        client,
        journey,
        settings
    ) {

        if (!container) {
            return null;
        }


        settings =
            settings || {};

        const isInitialAssessment =
            settings.purpose === "initial_assessment_consultation";


        injectStyles();


        const clientId =
            getClientId(client);


        const clientName =
            getClientName(client);


        const clientEmail =
            getClientEmail(client);


        const journeyId =
            getJourneyId(journey);


        const transactionId =
            getTransactionId(journey);


        const journeyTitle =
            getJourneyTitle(journey);


        const destination =
            getJourneyDestination(journey);


        if (!clientId) {

            console.error(
                COMPONENT_NAME +
                ": Client ID is required."
            );

            return null;

        }


        if (!transactionId && !isInitialAssessment) {

            console.error(
                COMPONENT_NAME +
                ": Transaction ID is required."
            );

            return null;

        }


        const currency =
            isInitialAssessment
                ? "GHS"
                : settings.currency || DEFAULT_CURRENCY;

        const initialAssessmentDescription =
            "Initial Assessment & 30-Minute Consultation";


        /*
         * Remove any previous composer.
         */

        const existing =
            document.querySelector(
                ".lordbless-payment-modal"
            );


        if (existing) {
            existing.remove();
        }


        const modal =
            document.createElement(
                "div"
            );


        modal.className =
            "lordbless-payment-modal";


        modal.innerHTML = `

            <div
                class="lordbless-payment-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="lordbless-payment-title"
            >

                <div class="lordbless-payment-header">

                    <div class="lordbless-payment-eyebrow">
                        LORDBLESS CONSULTANCY
                    </div>

                    <h2
                        id="lordbless-payment-title"
                        class="lordbless-payment-title"
                    >
                        ${isInitialAssessment ? "Initial Assessment & 30-Minute Consultation" : "Request Payment"}
                    </h2>

                    <p class="lordbless-payment-subtitle">
                        ${isInitialAssessment
                            ? "Create the initial assessment and consultation payment request. No journey is required."
                            : "Create a professional payment request for this client's journey or service."}
                    </p>

                </div>


                <form
                    class="lordbless-payment-form"
                    data-payment-request-form
                >

                    <div class="lordbless-payment-body">

                        <input
                            type="hidden"
                            name="clientId"
                            value="${escapeHtml(clientId)}"
                        >

                        <input
                            type="hidden"
                            name="clientName"
                            value="${escapeHtml(clientName)}"
                        >

                        <input
                            type="hidden"
                            name="clientEmail"
                            value="${escapeHtml(clientEmail)}"
                        >

                        <input
                            type="hidden"
                            name="journeyId"
                            value="${escapeHtml(journeyId)}"
                        >

                        <input
                            type="hidden"
                            name="transactionId"
                            value="${escapeHtml(transactionId)}"
                        >

                        <input
                            type="hidden"
                            name="purpose"
                            value="${isInitialAssessment ? "initial_assessment_consultation" : ""}"
                        >

                        <input
                            type="hidden"
                            name="databaseAssessment"
                            value="${isInitialAssessment && settings.databaseAssessment ? "true" : "false"}"
                        >

                        <input
                            type="hidden"
                            name="title"
                            value="${isInitialAssessment ? escapeHtml(initialAssessmentDescription) : ""}"
                        >

                        <input
                            type="hidden"
                            name="transactionTitle"
                            value="${escapeHtml(journeyTitle)}"
                        >

                        <input
                            type="hidden"
                            name="destination"
                            value="${escapeHtml(destination)}"
                        >

                        <input
                            type="hidden"
                            name="requestType"
                            value="${isInitialAssessment ? escapeHtml(initialAssessmentDescription) : "Service Fee"}"
                        >


                        <div class="lordbless-payment-client">

                            <div class="lordbless-payment-context">

                                <span class="lordbless-payment-context-label">
                                    Client
                                </span>

                                <span class="lordbless-payment-context-value">
                                    ${escapeHtml(
                                        clientName ||
                                        "Client"
                                    )}
                                </span>

                            </div>


                            <div class="lordbless-payment-context">

                                <span class="lordbless-payment-context-label">
                                    ${isInitialAssessment ? "Payment Purpose" : "Journey"}
                                </span>

                                <span class="lordbless-payment-context-value">
                                    ${escapeHtml(
                                        isInitialAssessment
                                            ? initialAssessmentDescription
                                            : journeyTitle || "Client Journey"
                                    )}
                                </span>

                            </div>

                        </div>


                        ${isInitialAssessment ? "" : `<div class="lordbless-payment-section">

                            <h3 class="lordbless-payment-section-title">
                                Service / Support
                            </h3>

                            <p
                                style="
                                    margin:0 0 13px;
                                    font-size:12px;
                                    color:#7b8490;
                                "
                            >
                                Select the service or support
                                covered by this payment request.
                            </p>


                            <div
                                class="lordbless-payment-service-grid"
                            >

                                ${
                                    PAYMENT_SERVICES
                                        .map(
                                            function (
                                                service
                                            ) {

                                                return `

                                                    <div
                                                        class="lordbless-payment-service"
                                                    >

                                                        <input
                                                            type="checkbox"
                                                            id="payment-service-${escapeHtml(
                                                                service.id
                                                            )}"
                                                            name="serviceItems"
                                                            value="${escapeHtml(
                                                                service.id
                                                            )}"
                                                        >

                                                        <label
                                                            for="payment-service-${escapeHtml(
                                                                service.id
                                                            )}"
                                                        >

                                                            <span
                                                                class="lordbless-payment-service-name"
                                                            >
                                                                ${escapeHtml(
                                                                    service.label
                                                                )}
                                                            </span>

                                                            <span
                                                                class="lordbless-payment-service-category"
                                                            >
                                                                ${escapeHtml(
                                                                    service.category
                                                                )}
                                                            </span>

                                                        </label>

                                                    </div>

                                                `;

                                            }
                                        )
                                        .join("")
                                }

                            </div>

                        </div>`}


                        <div class="lordbless-payment-field">

                            <label>
                                Payment Description
                            </label>

                            <textarea
                                name="description"
                                rows="3"
                                placeholder="Describe exactly what this payment covers..."
                                ${isInitialAssessment ? "readonly" : ""}
                            >${isInitialAssessment ? escapeHtml(initialAssessmentDescription) : ""}</textarea>

                        </div>


                        <div class="lordbless-payment-field">

                            ${isInitialAssessment ? `
                                <p class="lordbless-payment-standard-fee">
                                    Standard fee: GHS 1,000.00
                                </p>
                            ` : ""}

                            <label>
                                ${isInitialAssessment ? "Final Amount Due" : "Amount"}
                            </label>


                            <div
                                class="lordbless-payment-amount-row"
                            >

                                ${isInitialAssessment ? `
                                    <input type="hidden" name="subtotal" value="1000">
                                    <input
                                        type="number"
                                        name="discount"
                                        min="0"
                                        max="999.99"
                                        step="0.01"
                                        value="0"
                                        aria-label="Discount amount in Ghana cedis"
                                        placeholder="Discount (GHS)"
                                    >
                                    <input
                                        type="number"
                                        name="amount"
                                        min="0.01"
                                        step="0.01"
                                        value="1000"
                                        readonly
                                        required
                                    >
                                    <input type="hidden" name="currency" value="GHS">
                                ` : `
                                    <input
                                        type="number"
                                        name="amount"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="0.00"
                                        required
                                    >
                                `}


                                ${isInitialAssessment ? "" : `<select
                                    name="currency"
                                >

                                    <option
                                        value="EUR"
                                        ${
                                            currency ===
                                            "EUR"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        EUR
                                    </option>

                                    <option
                                        value="USD"
                                        ${
                                            currency ===
                                            "USD"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        USD
                                    </option>

                                    <option
                                        value="GHS"
                                        ${
                                            currency ===
                                            "GHS"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        GHS
                                    </option>

                                    <option
                                        value="GBP"
                                        ${
                                            currency ===
                                            "GBP"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        GBP
                                    </option>

                                    <option
                                        value="CAD"
                                        ${
                                            currency ===
                                            "CAD"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        CAD
                                    </option>

                                </select>`}

                            </div>

                        </div>


                        <div class="lordbless-payment-field">

                            <label>
                                Due Date
                            </label>

                            <input
                                type="date"
                                name="dueDate"
                            >

                        </div>


                        <div class="lordbless-payment-field">

                            <label>
                                Payment Instructions
                            </label>

                            <textarea
                                name="paymentInstructions"
                                rows="3"
                                placeholder="Add payment instructions for the client..."
                            ></textarea>

                        </div>


                        <div class="lordbless-payment-field">

                            <label>
                                Internal Note
                            </label>

                            <textarea
                                name="adminNote"
                                rows="2"
                                placeholder="Optional internal finance note..."
                            ></textarea>

                        </div>


                        <div
                            class="lordbless-payment-summary"
                        >

                            <div
                                class="lordbless-payment-summary-label"
                            >
                                Request Amount
                            </div>

                            <div
                                class="lordbless-payment-summary-value"
                                data-payment-summary
                            >
                                ${formatAmount(
                                    0,
                                    currency
                                )}
                            </div>

                        </div>

                    </div>


                    <div class="lordbless-payment-footer">

                        <button
                            type="button"
                            class="lordbless-payment-btn lordbless-payment-btn-secondary"
                            data-payment-cancel
                        >
                            Cancel
                        </button>


                        <button
                            type="submit"
                            class="lordbless-payment-btn lordbless-payment-btn-primary"
                        >
                            Send Payment Request
                        </button>

                    </div>

                </form>

            </div>

        `;


        document.body.appendChild(
            modal
        );


        const form =
            modal.querySelector(
                "[data-payment-request-form]"
            );


        attachForm(
            form
        );


        /*
         * Amount preview.
         */

        const amountInput =
            form.querySelector(
                '[name="amount"]'
            );

        const discountInput =
            form.querySelector(
                '[name="discount"]'
            );


        const currencySelect =
            form.querySelector(
                '[name="currency"]'
            );


        const summary =
            form.querySelector(
                "[data-payment-summary]"
            );


        function updateSummary() {

            if (!summary) {
                return;
            }


            if (isInitialAssessment && discountInput) {
                const discount = Number(discountInput.value) || 0;
                amountInput.value = String(Math.max(0, 1000 - discount));
            }

            summary.textContent =
                formatAmount(
                    amountInput.value,
                    currencySelect?.value || currency
                );

        }


        amountInput.addEventListener(
            "input",
            updateSummary
        );

        discountInput?.addEventListener(
            "input",
            updateSummary
        );


        currencySelect?.addEventListener(
            "change",
            updateSummary
        );

        updateSummary();


        /*
         * Cancel.
         */

        const cancelButton =
            modal.querySelector(
                "[data-payment-cancel]"
            );


        cancelButton.addEventListener(
            "click",
            function () {

                closeComposer(
                    modal
                );

            }
        );


        /*
         * Close when clicking outside
         * the dialog.
         */

        modal.addEventListener(
            "click",
            function (event) {

                if (
                    event.target ===
                    modal
                ) {

                    closeComposer(
                        modal
                    );

                }

            }
        );


        /*
         * Escape key.
         */

        function handleEscape(
            event
        ) {

            if (
                event.key ===
                "Escape"
            ) {

                closeComposer(
                    modal
                );

                document.removeEventListener(
                    "keydown",
                    handleEscape
                );

            }

        }


        document.addEventListener(
            "keydown",
            handleEscape
        );


        /*
         * Focus amount field.
         */

        setTimeout(
            function () {

                if (amountInput) {
                    amountInput.focus();
                }

            },
            50
        );


        return modal;

    }


    /* ============================================================
       OPEN COMPOSER HELPER
       ============================================================ */

    function open(
        container,
        client,
        journey,
        settings
    ) {

        return render(
            container,
            client,
            journey,
            settings
        );

    }


    /* ============================================================
       LISTEN FOR BRIDGE EVENTS
       ============================================================ */

    let paymentChannel = null;


    function initialiseChannel() {

        if (
            !("BroadcastChannel" in window)
        ) {

            return;

        }


        try {

            paymentChannel =
                new BroadcastChannel(
                    "LORDBLESS_PAYMENT_CHANNEL_V1"
                );


            paymentChannel.addEventListener(
                "message",
                function (event) {

                    if (!event.data) {
                        return;
                    }


                    if (
                        event.data.source ===
                        "LORDBLESS_PAYMENT_REQUEST"
                    ) {

                        return;

                    }


                    const eventType =
                        event.data.type;


                    if (
                        eventType ===
                            "payment-request-updated" ||
                        eventType ===
                            "payment-request-deleted" ||
                        eventType ===
                            "payment-requests-cleared"
                    ) {

                        try {

                            window.dispatchEvent(

                                new CustomEvent(
                                    "lordbless:" +
                                    eventType,
                                    {
                                        detail:
                                            event.data.payload ||
                                            null
                                    }
                                )

                            );

                        } catch (error) {

                            console.warn(
                                COMPONENT_NAME +
                                ": Event dispatch failed.",
                                error
                            );

                        }

                    }

                }
            );


        } catch (error) {

            console.warn(
                COMPONENT_NAME +
                ": Payment channel unavailable.",
                error
            );

        }

    }


    /* ============================================================
       INITIALISE
       ============================================================ */

    function init() {

        attachForms();

        injectStyles();

        initialiseChannel();

    }


    /* ============================================================
       PUBLIC API
       ============================================================ */

    window.LORDBLESS_PAYMENT_REQUEST = {

        createPaymentRequest,

        createFromForm,

        updatePaymentRequest,

        getPaymentRequest,

        getClientPaymentRequests,

        getJourneyPaymentRequests,

        getTransactionPaymentRequests,

        cancelPaymentRequest,

        markAsViewed,

        markPaymentPending,

        serializeForm,

        handleFormSubmit,

        attachForm,

        attachForms,

        render,

        open,

        close: closeComposer,

        services:
            PAYMENT_SERVICES,

        init

    };


    /* ============================================================
       AUTO INITIALISE
       ============================================================ */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();

    }


    console.log(
        "LORDBLESS PAYMENT REQUEST COMPONENT: Ready."
    );


})();
