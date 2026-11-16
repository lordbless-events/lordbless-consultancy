/* Shared Supabase adapter for ordinary service billing only.
 * Assessment-consultation and AUTOS payments keep their existing workflows.
 */
(function () {
    "use strict";

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function requireClient() {
        if (typeof lordblessSupabase === "undefined") throw new Error("The secure payment service is unavailable.");
        return lordblessSupabase;
    }

    function toRequest(row, clientName, clientCode, submissions) {
        const payments = (submissions || []).filter(item => item.request_id === row.id)
            .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
        const latest = payments[0] || null;
        const pending = payments.find(item => item.status === "submitted");
        const verifiedTotal = payments.filter(item => item.status === "verified")
            .reduce((sum, item) => sum + Number(item.amount_received || 0), 0);
        const receipt = (window.LORDBLESS_CENTRAL_SERVICE_PAYMENT_RAW?.receipts || [])
            .find(item => item.request_id === row.id);
        const statusMap = {
            requested: "Requested", partially_paid: "Partially Paid", payment_submitted: "Awaiting Verification",
            under_review: "Under Review", rejected: "Payment Rejected", paid: "Paid", cancelled: "Cancelled"
        };
        return {
            ...row,
            id: row.id,
            reference: row.reference,
            clientId: row.client_id,
            clientName: clientName || "Client",
            clientCode: clientCode || "",
            journeyId: row.journey_id || "",
            transactionId: row.transaction_id || "",
            transactionTitle: row.transaction_title || "",
            destination: row.destination || "",
            service: row.service || "",
            requestType: row.request_type,
            purpose: row.purpose || null,
            description: row.description || row.title,
            amount: Number(row.amount),
            subtotal: Number(row.subtotal),
            discount: Number(row.discount),
            total: Number(row.amount),
            currency: row.currency,
            dueDate: row.due_date || "",
            paymentInstructions: row.payment_instructions || "",
            adminNote: row.admin_note || "",
            requestedDate: row.created_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            status: statusMap[row.status] || row.status,
            verificationStatus: pending ? "pending" : latest?.status === "rejected" || row.status === "rejected" ? "rejected" : row.status === "paid" ? "verified" : "not_verified",
            clientPaymentSubmittedAt: latest?.submitted_at || null,
            clientPaymentDate: latest?.payment_date || null,
            clientPaymentReference: latest?.transaction_reference || "",
            clientPaymentMethod: latest?.payment_method || "",
            clientPaymentAmount: latest ? Number(latest.amount_submitted) : null,
            amountPaid: verifiedTotal,
            receiptId: receipt?.receipt_number || null,
            receiptNumber: receipt?.receipt_number || null,
            rejectionReason: latest?.rejection_reason || "",
            latestSubmissionId: pending?.id || latest?.id || null,
            databaseServicePayment: true,
            databaseServicePaymentRequest: true
        };
    }

    function toSubmission(payment, requests) {
        const request = requests.find(item => item.id === payment.request_id);
        if (!request) return null;
        return {
            id: payment.id,
            paymentId: payment.id,
            paymentRequestId: request.id,
            reference: request.reference,
            invoiceNumber: request.reference,
            clientId: request.clientId,
            clientName: request.clientName,
            clientCode: request.clientCode,
            transactionId: request.transactionId,
            transactionTitle: request.transactionTitle || request.description,
            description: request.description,
            amount: Number(payment.amount_submitted),
            total: Number(payment.amount_submitted),
            currency: payment.currency,
            paymentMethod: payment.payment_method,
            paymentDate: payment.payment_date,
            transactionReference: payment.transaction_reference,
            verifiedAt: payment.verified_at || null,
            verifiedBy: payment.verified_by || null,
            verifiedByName: payment.verified_by_name || "",
            rejectionReason: payment.rejection_reason || "",
            verificationNote: payment.verification_note || "",
            clientPaymentSubmittedAt: payment.submitted_at,
            status: payment.status === "submitted" ? "Awaiting Verification" : payment.status,
            verificationStatus: payment.status === "verified" ? "verified" : payment.status === "rejected" ? "rejected" : "pending",
            databaseServicePayment: true,
            databaseServicePaymentSubmission: true
        };
    }

    function toReceipt(row, requests) {
        const request = requests.find(item => item.id === row.request_id);
        return {
            id: row.id,
            receiptNumber: row.receipt_number,
            paymentId: row.payment_id,
            paymentRequestId: row.request_id,
            paymentRequestReference: request?.reference || "",
            clientId: row.client_id,
            clientName: request?.clientName || "Client",
            clientCode: request?.clientCode || "",
            description: request?.description || "Service payment",
            transactionTitle: request?.transactionTitle || "",
            amount: Number(row.amount_paid),
            currency: row.currency,
            paymentMethod: row.payment_method,
            paymentReference: row.payment_reference,
            paymentDate: row.payment_date,
            issuedAt: row.issued_at,
            verifiedAt: row.issued_at,
            verifiedByName: row.issued_by_name,
            status: "issued",
            databaseServicePayment: true
        };
    }

    function normalize(data) {
        const raw = data && typeof data === "object" ? data : {};
        window.LORDBLESS_CENTRAL_SERVICE_PAYMENT_RAW = raw;
        const submissionRows = Array.isArray(raw.payments) ? raw.payments : [];
        const requests = (Array.isArray(raw.requests) ? raw.requests : []).map(item => {
            const row = item.record || item;
            return toRequest(row, item.client_name, item.client_code, submissionRows);
        });
        const submissions = submissionRows.map(item => toSubmission(item, requests)).filter(Boolean);
        const payments = submissions.filter(item => item.verificationStatus === "verified").map(item => ({
            ...item,
            amount: Number(submissionRows.find(row => row.id === item.id)?.amount_received || item.amount),
            status: "paid"
        }));
        const receipts = (Array.isArray(raw.receipts) ? raw.receipts : []).map(item => toReceipt(item, requests));
        return { requests, submissions, payments, receipts };
    }

    async function rpc(name, args) {
        const { data, error } = await requireClient().rpc(name, args);
        if (error) throw error;
        return data;
    }

    async function loadAdmin() {
        return normalize(await rpc("list_admin_client_service_payments"));
    }

    async function loadClient() {
        return normalize(await rpc("list_my_client_service_payments"));
    }

    async function createRequest(input) {
        const data = input || {};
        if (!UUID.test(String(data.clientId || ""))) throw new Error("Select a valid saved client record.");
        const amount = Number(data.total ?? data.amount);
        const subtotal = Number(data.subtotal ?? amount);
        const discount = Number(data.discount || 0);
        const tax = Number(data.tax || 0);
        const journeyId = UUID.test(String(data.journeyId || "")) ? data.journeyId : null;
        return rpc("create_client_service_payment_request", {
            p_client_id: data.clientId,
            p_request_key: data.requestKey || crypto.randomUUID(),
            p_request_type: data.requestType || "Service Fee",
            p_purpose: data.purpose || null,
            p_title: data.title || data.description || data.requestType || "Service Payment",
            p_description: data.description || "",
            p_service: data.service || "",
            p_transaction_title: data.transactionTitle || "",
            p_destination: data.destination || "",
            p_transaction_id: data.transactionId || null,
            p_journey_id: journeyId,
            p_subtotal: subtotal,
            p_discount: discount,
            p_tax: tax,
            p_amount: amount,
            p_currency: String(data.currency || "EUR").toUpperCase(),
            p_due_date: data.dueDate || null,
            p_payment_instructions: data.paymentInstructions || "",
            p_admin_note: data.adminNote || ""
        });
    }

    async function verifyRequest(requestId, data) {
        const input = data || {};
        return rpc("verify_client_service_payment_request", {
            p_request_id: requestId,
            p_verification_key: input.verificationKey || crypto.randomUUID(),
            p_amount_received: Number(input.amountReceived),
            p_payment_method: input.paymentMethod,
            p_payment_reference: input.paymentReference || "",
            p_payment_date: input.paymentDate,
            p_finance_note: input.financeNote || ""
        });
    }

    async function verify(paymentId, action, amount, note) {
        return rpc("verify_client_service_payment", {
            p_payment_id: paymentId,
            p_action: action,
            p_amount_received: amount == null ? null : Number(amount),
            p_finance_note: note || ""
        });
    }

    async function cancel(requestId, reason) {
        return rpc("cancel_client_service_payment_request", {
            p_request_id: requestId,
            p_reason: reason || ""
        });
    }

    async function updateRequest(request, updates) {
        const value = updates || {};
        const amount = Number(value.amount ?? request.amount);
        return rpc("update_client_service_payment_request", {
            p_request_id: request.id,
            p_expected_updated_at: request.updatedAt || request.updated_at,
            p_title: value.title || value.description || request.title || request.description,
            p_description: value.description ?? request.description ?? "",
            p_service: value.service ?? request.service ?? "",
            p_transaction_title: value.transactionTitle ?? request.transactionTitle ?? "",
            p_destination: value.destination ?? request.destination ?? "",
            p_subtotal: amount,
            p_discount: 0,
            p_tax: 0,
            p_amount: amount,
            p_currency: String(value.currency || request.currency || "EUR").toUpperCase(),
            p_due_date: value.dueDate || null,
            p_payment_instructions: value.paymentInstructions ?? request.paymentInstructions ?? "",
            p_admin_note: value.adminNote ?? request.adminNote ?? ""
        });
    }

    window.LORDBLESS_CENTRAL_SERVICE_PAYMENTS = Object.freeze({
        normalize, loadAdmin, loadClient, createRequest, verifyRequest, verify, cancel, updateRequest
    });
})();
