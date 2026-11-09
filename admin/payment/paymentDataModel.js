/* ============================================================
   LORDBLESS PAYMENT DATA MODEL
   ============================================================

   Purpose:
   --------
   Shared data structure for the LORDBLESS payment system.

   Covers:
   - Payment Requests
   - Payment Statuses
   - Payment Methods
   - Currencies
   - Invoices
   - Receipts
   - Payment History
   - Client Payment Accounts

   ARCHITECTURE
   ------------
   ADMIN PORTAL
        |
        | creates / verifies
        v
   PAYMENT REQUEST
        |
        v
   CLIENT PORTAL
        |
        | payment / upload proof
        v
   PAYMENT RECORD
        |
        v
   ADMIN VERIFICATION
        |
        v
   RECEIPT

   This is temporary local/mock infrastructure.

   Later:
   Local Mock Data
        ↓
   Supabase Database

   IMPORTANT:
   This file defines the STRUCTURE of payment data.
   It does not process payments or connect to a
   payment gateway.

   ============================================================ */

(function () {

    "use strict";


    /* ========================================================
       CURRENCIES
       ======================================================== */

    const LORDBLESS_PAYMENT_CURRENCIES = {

        EUR: "EUR",

        USD: "USD",

        GHS: "GHS"

    };


    /* ========================================================
       PAYMENT REQUEST STATUS
       ========================================================

       Created by Admin.

       Flow:

       REQUESTED
           ↓
       CLIENT_VIEWED
           ↓
       PAYMENT_PENDING
           ↓
       PAYMENT_SUBMITTED
           ↓
       UNDER_REVIEW
           ↓
       VERIFIED

       Alternative:

       UNDER_REVIEW
           ↓
       REJECTED

       A cancelled request can be used when Admin
       withdraws the payment request.
       ======================================================== */

    const LORDBLESS_PAYMENT_REQUEST_STATUS = {

        REQUESTED:
            "Requested",

        CLIENT_VIEWED:
            "Client Viewed",

        PAYMENT_PENDING:
            "Payment Pending",

        PAYMENT_SUBMITTED:
            "Payment Submitted",

        UNDER_REVIEW:
            "Under Review",

        VERIFIED:
            "Verified",

        REJECTED:
            "Rejected",

        CANCELLED:
            "Cancelled"

    };


    /* ========================================================
       PAYMENT STATUS
       ======================================================== */

    const LORDBLESS_PAYMENT_STATUS = {

        PENDING:
            "Pending",

        SUBMITTED:
            "Submitted",

        UNDER_REVIEW:
            "Under Review",

        PAID:
            "Paid",

        VERIFIED:
            "Verified",

        REJECTED:
            "Rejected",

        REFUNDED:
            "Refunded",

        CANCELLED:
            "Cancelled"

    };


    /* ========================================================
       INVOICE STATUS
       ======================================================== */

    const LORDBLESS_INVOICE_STATUS = {

        DRAFT:
            "Draft",

        ISSUED:
            "Issued",

        SENT:
            "Sent",

        PARTIALLY_PAID:
            "Partially Paid",

        PAID:
            "Paid",

        OVERDUE:
            "Overdue",

        CANCELLED:
            "Cancelled"

    };


    /* ========================================================
       RECEIPT STATUS
       ======================================================== */

    const LORDBLESS_RECEIPT_STATUS = {

        ISSUED:
            "Issued",

        VOID:
            "Void",

        REFUNDED:
            "Refunded"

    };


    /* ========================================================
       PAYMENT METHODS
       ======================================================== */

    const LORDBLESS_PAYMENT_METHODS = {

        BANK_TRANSFER:
            "Bank Transfer",

        MOBILE_MONEY:
            "Mobile Money",

        CARD:
            "Card",

        CASH:
            "Cash",

        OTHER:
            "Other"

    };


    /* ========================================================
       PAYMENT PROOF TYPES
       ======================================================== */

    const LORDBLESS_PAYMENT_PROOF_TYPES = {

        BANK_RECEIPT:
            "Bank Receipt",

        TRANSFER_CONFIRMATION:
            "Transfer Confirmation",

        MOBILE_MONEY_RECEIPT:
            "Mobile Money Receipt",

        CARD_CONFIRMATION:
            "Card Payment Confirmation",

        OTHER:
            "Other"

    };


    /* ========================================================
       PAYMENT REQUEST TYPE
       ======================================================== */

    const LORDBLESS_PAYMENT_REQUEST_TYPES = {

        SERVICE_FEE:
            "Service Fee",

        APPLICATION_FEE:
            "Application Fee",

        PROCESSING_FEE:
            "Processing Fee",

        DOCUMENT_FEE:
            "Document Fee",

        VISA_FEE:
            "Visa Fee",

        UNIVERSITY_FEE:
            "University Fee",

        TRAVEL_FEE:
            "Travel Fee",

        OTHER:
            "Other"

    };


    /* ========================================================
       PAYMENT REQUEST
       ========================================================

       Created primarily by Admin.

       This is the record that tells the client:

       "LORDBLESS is requesting this amount
       for this particular service/journey."

       REQUEST ≠ PAYMENT

       A request exists before the client pays.
       ======================================================== */

    function createPaymentRequest(
        data = {}
    ) {

        const now =
            new Date().toISOString();


        return {

            id:
                data.id ||
                `PAYREQ-${Date.now()}`,

            clientId:
                data.clientId ||
                null,

            clientName:
                data.clientName ||
                data.client?.fullName ||
                data.client?.full_name ||
                data.client?.name ||
                "",

            clientEmail:
                data.clientEmail ||
                data.client?.email ||
                "",

            clientCode:
                data.clientCode ||
                data.client_code ||
                data.client?.clientCode ||
                data.client?.client_code ||
                "",

            transactionId:
                data.transactionId ||
                null,

            journeyId:
                data.journeyId ||
                null,


            /* ------------------------------------------------
               SERVICE INFORMATION
               ------------------------------------------------ */

            requestType:
                data.requestType ||
                LORDBLESS_PAYMENT_REQUEST_TYPES.SERVICE_FEE,

            purpose:
                data.purpose ||
                null,

            title:
                data.title ||
                "Payment Request",

            description:
                data.description ||
                "",


            /* ------------------------------------------------
               AMOUNT
               ------------------------------------------------ */

            amount:
                Number(
                    data.amount || 0
                ),

            currency:
                data.currency ||
                LORDBLESS_PAYMENT_CURRENCIES.EUR,


            /* ------------------------------------------------
               OPTIONAL BREAKDOWN
               ------------------------------------------------ */

            subtotal:
                Number(
                    data.subtotal ||
                    data.amount ||
                    0
                ),

            discount:
                Number(
                    data.discount ||
                    0
                ),

            tax:
                Number(
                    data.tax ||
                    0
                ),

            total:
                Number(
                    data.total ||
                    data.amount ||
                    0
                ),


            /* ------------------------------------------------
               STATUS
               ------------------------------------------------ */

            status:
                data.status ||
                LORDBLESS_PAYMENT_REQUEST_STATUS.REQUESTED,


            /* ------------------------------------------------
               DATES
               ------------------------------------------------ */

            dueDate:
                data.dueDate ||
                null,

            createdAt:
                data.createdAt ||
                now,

            updatedAt:
                data.updatedAt ||
                now,


            /* ------------------------------------------------
               ADMIN INFORMATION
               ------------------------------------------------ */

            createdBy:
                data.createdBy ||
                null,

            createdByName:
                data.createdByName ||
                null,


            /* ------------------------------------------------
               CLIENT INFORMATION
               ------------------------------------------------ */

            clientViewedAt:
                data.clientViewedAt ||
                null,

            clientNote:
                data.clientNote ||
                "",


            /* ------------------------------------------------
               INVOICE CONNECTION
               ------------------------------------------------ */

            invoiceId:
                data.invoiceId ||
                null,


            /* ------------------------------------------------
               PAYMENT CONNECTION
               ------------------------------------------------ */

            paymentId:
                data.paymentId ||
                null,


            /* ------------------------------------------------
               RECEIPT CONNECTION
               ------------------------------------------------ */

            receiptId:
                data.receiptId ||
                null,


            /* ------------------------------------------------
               INTERNAL ADMIN NOTE
               ------------------------------------------------ */

            adminNote:
                data.adminNote ||
                ""

        };

    }


    /* ========================================================
       PAYMENT RECORD
       ========================================================

       Created when the client submits payment information.

       It is separate from the Payment Request.

       Payment Request:
           "Please pay €1,500."

       Payment Record:
           "Client submitted €1,500 by bank transfer."

       Admin later verifies the payment.
       ======================================================== */

    function createPaymentRecord(
        data = {}
    ) {

        const now =
            new Date().toISOString();


        return {

            id:
                data.id ||
                `PAY-${Date.now()}`,

            paymentRequestId:
                data.paymentRequestId ||
                null,

            clientId:
                data.clientId ||
                null,

            transactionId:
                data.transactionId ||
                null,

            journeyId:
                data.journeyId ||
                null,


            /* ------------------------------------------------
               PAYMENT AMOUNT
               ------------------------------------------------ */

            amount:
                Number(
                    data.amount || 0
                ),

            currency:
                data.currency ||
                LORDBLESS_PAYMENT_CURRENCIES.EUR,


            /* ------------------------------------------------
               PAYMENT METHOD
               ------------------------------------------------ */

            method:
                data.method ||
                null,


            /* ------------------------------------------------
               PAYMENT DETAILS
               ------------------------------------------------ */

            reference:
                data.reference ||
                "",

            paymentDate:
                data.paymentDate ||
                null,


            /* ------------------------------------------------
               STATUS
               ------------------------------------------------ */

            status:
                data.status ||
                LORDBLESS_PAYMENT_STATUS.SUBMITTED,


            /* ------------------------------------------------
               PROOF OF PAYMENT
               ------------------------------------------------ */

            proofType:
                data.proofType ||
                null,

            proofFileName:
                data.proofFileName ||
                null,

            proofFileUrl:
                data.proofFileUrl ||
                null,


            /* ------------------------------------------------
               ADMIN VERIFICATION
               ------------------------------------------------ */

            verifiedBy:
                data.verifiedBy ||
                null,

            verifiedByName:
                data.verifiedByName ||
                null,

            verifiedAt:
                data.verifiedAt ||
                null,

            rejectionReason:
                data.rejectionReason ||
                "",


            /* ------------------------------------------------
               NOTES
               ------------------------------------------------ */

            clientNote:
                data.clientNote ||
                "",

            adminNote:
                data.adminNote ||
                "",


            /* ------------------------------------------------
               TIMESTAMPS
               ------------------------------------------------ */

            createdAt:
                data.createdAt ||
                now,

            updatedAt:
                data.updatedAt ||
                now

        };

    }


    /* ========================================================
       INVOICE
       ========================================================

       An invoice can be generated before or after
       a payment request.

       Typical relationship:

       Payment Request
              ↓
          Invoice
              ↓
          Payment
              ↓
          Receipt
       ======================================================== */

    function createInvoice(
        data = {}
    ) {

        const now =
            new Date().toISOString();


        return {

            id:
                data.id ||
                `INV-${Date.now()}`,

            invoiceNumber:
                data.invoiceNumber ||
                "",


            /* ------------------------------------------------
               CLIENT / JOURNEY
               ------------------------------------------------ */

            clientId:
                data.clientId ||
                null,

            transactionId:
                data.transactionId ||
                null,

            journeyId:
                data.journeyId ||
                null,


            /* ------------------------------------------------
               PAYMENT REQUEST
               ------------------------------------------------ */

            paymentRequestId:
                data.paymentRequestId ||
                null,


            /* ------------------------------------------------
               DESCRIPTION
               ------------------------------------------------ */

            title:
                data.title ||
                "LORDBLESS Invoice",

            description:
                data.description ||
                "",


            /* ------------------------------------------------
               AMOUNTS
               ------------------------------------------------ */

            currency:
                data.currency ||
                LORDBLESS_PAYMENT_CURRENCIES.EUR,

            subtotal:
                Number(
                    data.subtotal || 0
                ),

            discount:
                Number(
                    data.discount || 0
                ),

            tax:
                Number(
                    data.tax || 0
                ),

            total:
                Number(
                    data.total || 0
                ),

            amountPaid:
                Number(
                    data.amountPaid || 0
                ),

            balanceDue:
                Number(
                    data.balanceDue ||
                    data.total ||
                    0
                ),


            /* ------------------------------------------------
               STATUS
               ------------------------------------------------ */

            status:
                data.status ||
                LORDBLESS_INVOICE_STATUS.DRAFT,


            /* ------------------------------------------------
               DATES
               ------------------------------------------------ */

            issueDate:
                data.issueDate ||
                null,

            dueDate:
                data.dueDate ||
                null,

            paidDate:
                data.paidDate ||
                null,


            /* ------------------------------------------------
               DOCUMENT
               ------------------------------------------------ */

            fileName:
                data.fileName ||
                null,

            fileUrl:
                data.fileUrl ||
                null,


            /* ------------------------------------------------
               NOTES
               ------------------------------------------------ */

            notes:
                data.notes ||
                "",


            /* ------------------------------------------------
               TIMESTAMPS
               ------------------------------------------------ */

            createdAt:
                data.createdAt ||
                now,

            updatedAt:
                data.updatedAt ||
                now

        };

    }


    /* ========================================================
       RECEIPT
       ========================================================

       Generated by Admin after payment verification.

       Receipt is NOT the same thing as payment proof.

       Payment proof:
           Uploaded by client.

       Receipt:
           Official LORDBLESS confirmation generated
           after Admin verifies the payment.
       ======================================================== */

    function createReceipt(
        data = {}
    ) {

        const now =
            new Date().toISOString();


        return {

            id:
                data.id ||
                `REC-${Date.now()}`,

            receiptNumber:
                data.receiptNumber ||
                "",


            /* ------------------------------------------------
               CLIENT / JOURNEY
               ------------------------------------------------ */

            clientId:
                data.clientId ||
                null,

            transactionId:
                data.transactionId ||
                null,

            journeyId:
                data.journeyId ||
                null,


            /* ------------------------------------------------
               PAYMENT CONNECTION
               ------------------------------------------------ */

            paymentId:
                data.paymentId ||
                null,

            paymentRequestId:
                data.paymentRequestId ||
                null,

            invoiceId:
                data.invoiceId ||
                null,


            /* ------------------------------------------------
               PAYMENT DETAILS
               ------------------------------------------------ */

            amount:
                Number(
                    data.amount || 0
                ),

            currency:
                data.currency ||
                LORDBLESS_PAYMENT_CURRENCIES.EUR,

            paymentMethod:
                data.paymentMethod ||
                null,

            paymentReference:
                data.paymentReference ||
                "",


            /* ------------------------------------------------
               RECEIPT STATUS
               ------------------------------------------------ */

            status:
                data.status ||
                LORDBLESS_RECEIPT_STATUS.ISSUED,


            /* ------------------------------------------------
               ISSUANCE
               ------------------------------------------------ */

            issuedBy:
                data.issuedBy ||
                null,

            issuedByName:
                data.issuedByName ||
                null,

            issuedAt:
                data.issuedAt ||
                now,


            /* ------------------------------------------------
               RECEIPT DOCUMENT
               ------------------------------------------------ */

            fileName:
                data.fileName ||
                null,

            fileUrl:
                data.fileUrl ||
                null,


            /* ------------------------------------------------
               NOTES
               ------------------------------------------------ */

            notes:
                data.notes ||
                "",


            /* ------------------------------------------------
               TIMESTAMPS
               ------------------------------------------------ */

            createdAt:
                data.createdAt ||
                now,

            updatedAt:
                data.updatedAt ||
                now

        };

    }


    /* ========================================================
       PAYMENT HISTORY ENTRY
       ========================================================

       Lightweight record used for displaying the client's
       payment history.

       This allows the Client Portal to show:

       - Payment requested
       - Payment submitted
       - Payment verified
       - Receipt issued
       - Refund
       - Other events
       ======================================================== */

    function createPaymentHistoryEntry(
        data = {}
    ) {

        const now =
            new Date().toISOString();


        return {

            id:
                data.id ||
                `PAYH-${Date.now()}`,

            clientId:
                data.clientId ||
                null,

            transactionId:
                data.transactionId ||
                null,

            journeyId:
                data.journeyId ||
                null,

            paymentRequestId:
                data.paymentRequestId ||
                null,

            paymentId:
                data.paymentId ||
                null,

            invoiceId:
                data.invoiceId ||
                null,

            receiptId:
                data.receiptId ||
                null,


            /* ------------------------------------------------
               EVENT
               ------------------------------------------------ */

            eventType:
                data.eventType ||
                "",

            title:
                data.title ||
                "",

            description:
                data.description ||
                "",


            /* ------------------------------------------------
               AMOUNT
               ------------------------------------------------ */

            amount:
                Number(
                    data.amount || 0
                ),

            currency:
                data.currency ||
                LORDBLESS_PAYMENT_CURRENCIES.EUR,


            /* ------------------------------------------------
               DATE
               ------------------------------------------------ */

            eventDate:
                data.eventDate ||
                now,


            /* ------------------------------------------------
               TIMESTAMP
               ------------------------------------------------ */

            createdAt:
                data.createdAt ||
                now

        };

    }


    /* ========================================================
       CLIENT PAYMENT ACCOUNT
       ========================================================

       Summary information for the Client Portal.

       This does NOT replace the individual payment records.

       It provides dashboard-level information such as:

       Total requested
       Total paid
       Total verified
       Outstanding balance
       ======================================================== */

    function createClientPaymentAccount(
        data = {}
    ) {

        return {

            clientId:
                data.clientId ||
                null,

            currency:
                data.currency ||
                LORDBLESS_PAYMENT_CURRENCIES.EUR,

            totalRequested:
                Number(
                    data.totalRequested || 0
                ),

            totalPaid:
                Number(
                    data.totalPaid || 0
                ),

            totalVerified:
                Number(
                    data.totalVerified || 0
                ),

            totalOutstanding:
                Number(
                    data.totalOutstanding || 0
                ),

            pendingRequests:
                Number(
                    data.pendingRequests || 0
                ),

            pendingVerification:
                Number(
                    data.pendingVerification || 0
                ),

            lastPaymentDate:
                data.lastPaymentDate ||
                null,

            lastPaymentId:
                data.lastPaymentId ||
                null

        };

    }


    /* ========================================================
       PAYMENT EVENT TYPES
       ======================================================== */

    const LORDBLESS_PAYMENT_EVENT_TYPES = {

        REQUEST_CREATED:
            "Payment Request Created",

        REQUEST_VIEWED:
            "Payment Request Viewed",

        INVOICE_ISSUED:
            "Invoice Issued",

        PAYMENT_SUBMITTED:
            "Payment Submitted",

        PAYMENT_UNDER_REVIEW:
            "Payment Under Review",

        PAYMENT_VERIFIED:
            "Payment Verified",

        PAYMENT_REJECTED:
            "Payment Rejected",

        RECEIPT_ISSUED:
            "Receipt Issued",

        PAYMENT_REFUNDED:
            "Payment Refunded",

        PAYMENT_CANCELLED:
            "Payment Cancelled"

    };


    /* ========================================================
       VALIDATION HELPERS
       ======================================================== */

    function isValidPaymentCurrency(
        currency
    ) {

        return Object.values(
            LORDBLESS_PAYMENT_CURRENCIES
        ).includes(
            currency
        );

    }


    function isValidPaymentRequestStatus(
        status
    ) {

        return Object.values(
            LORDBLESS_PAYMENT_REQUEST_STATUS
        ).includes(
            status
        );

    }


    function isValidPaymentStatus(
        status
    ) {

        return Object.values(
            LORDBLESS_PAYMENT_STATUS
        ).includes(
            status
        );

    }


    /* ========================================================
       PUBLIC PAYMENT DATA MODEL
       ======================================================== */

    window.LORDBLESS_PAYMENT_MODEL = {

        /* Currencies */

        currencies:
            LORDBLESS_PAYMENT_CURRENCIES,


        /* Statuses */

        paymentRequestStatus:
            LORDBLESS_PAYMENT_REQUEST_STATUS,

        paymentStatus:
            LORDBLESS_PAYMENT_STATUS,

        invoiceStatus:
            LORDBLESS_INVOICE_STATUS,

        receiptStatus:
            LORDBLESS_RECEIPT_STATUS,


        /* Types */

        paymentMethods:
            LORDBLESS_PAYMENT_METHODS,

        paymentProofTypes:
            LORDBLESS_PAYMENT_PROOF_TYPES,

        paymentRequestTypes:
            LORDBLESS_PAYMENT_REQUEST_TYPES,

        paymentEventTypes:
            LORDBLESS_PAYMENT_EVENT_TYPES,


        /* Factory functions */

        createPaymentRequest:
            createPaymentRequest,

        createPayment:
            createPaymentRecord,

        createInvoice:
            createInvoice,

        createReceipt:
            createReceipt,

        createHistoryEntry:
            createPaymentHistoryEntry,

        createClientPaymentAccount:
            createClientPaymentAccount,


        /* Validation */

        isValidCurrency:
            isValidPaymentCurrency,

        isValidPaymentRequestStatus:
            isValidPaymentRequestStatus,

        isValidPaymentStatus:
            isValidPaymentStatus

    };


    /* ========================================================
       READY MESSAGE
       ======================================================== */

    console.log(
        "LORDBLESS PAYMENT DATA MODEL: Ready."
    );

})();
