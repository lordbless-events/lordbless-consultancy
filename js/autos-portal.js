(function () {
    "use strict";

    const root = document.getElementById("autos-portal");
    const stages = [
        ["enquiry_received", "Vehicle enquiry received"], ["enquiry_reviewed", "Enquiry reviewed"],
        ["availability_confirmation", "Vehicle availability confirmed"], ["quotation_preparation", "Quotation prepared"],
        ["quotation_sent", "Quotation sent"], ["awaiting_customer_decision", "Awaiting your decision"],
        ["order_confirmed", "Purchase confirmed"], ["payment_processing", "Payment processing"],
        ["vehicle_sourcing", "Vehicle preparation"], ["inspection_documentation", "Inspection and documentation"],
        ["shipping_preparation", "Shipping arrangements"], ["in_transit", "Shipment departed · in transit"],
        ["arrived_in_ghana", "Arrived at destination port"], ["customs_clearing", "Customs and clearance"],
        ["delivery_arrangements", "Ready for collection or delivery"], ["delivered", "Final handover"], ["autos_completed", "Completed"]
    ];
    const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char]));
    const human = value => String(value || "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
    const date = value => value ? new Date(value).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }) : "—";
    let state = { snapshot:null, sessionEmail:"", quotes:[], agreements:[], logistics:[], payments:[], receipts:[], updates:[], documents:[], requests:[], active:"dashboard" };
    const supabase = lordblessSupabase;

    async function start() {
        const { data:{ session } } = await supabase.auth.getSession();
        if (!session?.user) { window.location.replace("portal-login.html"); return; }
        state.sessionEmail = session.user.email || "";
        const { data:allowed, error:accessError } = await supabase.rpc("has_autos_customer_portal");
        if (accessError || !allowed) {
            root.innerHTML = `<section class="autos-portal-error"><p class="eyebrow">SECURE PORTAL</p><h1>Access unavailable</h1><p>${esc(accessError?.message || "This account does not have active LORDBLESS AUTOS portal access.")}</p><a class="autos-button secondary" href="client/index.html?portal=standard">Open Client Portal</a></section>`;
            return;
        }
        await load();
        render();
        document.addEventListener("click", onClick);
        document.addEventListener("submit", onSubmit);
    }

    async function load() {
        root.innerHTML = '<section class="autos-portal-loading"><p class="eyebrow">LORDBLESS AUTOS</p><h1>Customer Portal</h1><p>Loading your transactions securely…</p></section>';
        const { data:snapshot, error:snapshotError } = await supabase.rpc("autos_customer_portal_snapshot");
        if (snapshotError) throw snapshotError;
        state.snapshot = snapshot || {};
        const clientId = state.snapshot.client?.id;
        if (!clientId) throw new Error("The authenticated client record could not be resolved.");
        const tables = ["autos_customer_quotes","autos_customer_agreements","autos_logistics_statements","autos_payment_requests","autos_customer_updates"];
        const selectColumns = {
            autos_customer_quotes:"id,client_id,enquiry_id,quote_reference,version,currency,vehicle_purchase_price,lordbless_service_fee,status,created_at,sent_at,accepted_at",
            autos_customer_agreements:"id,client_id,enquiry_id,document_id,agreement_reference,version,status,created_at,sent_at,accepted_at",
            autos_logistics_statements:"id,client_id,enquiry_id,statement_reference,currency,line_items,total_amount,status,created_at,issued_at",
            autos_payment_requests:"id,client_id,enquiry_id,quote_id,logistics_statement_id,reference,payment_type,currency,amount,description,payment_instructions,status,client_payment_reference,client_payment_date,submitted_at,verified_at,created_at",
            autos_customer_updates:"id,client_id,enquiry_id,title,message,published,created_at,published_at"
        };
        const results = await Promise.all(tables.map(table => supabase.from(table).select(selectColumns[table]).eq("client_id", clientId).order("created_at", { ascending:false })));
        const failed = results.find(result => result.error);
        if (failed) throw failed.error;
        [state.quotes,state.agreements,state.logistics,state.payments,state.updates] = results.map(result => result.data || []);
        const paymentIds = state.payments.map(payment => payment.id);
        if (paymentIds.length) {
            const receipts = await supabase.from("autos_customer_receipts").select("id,payment_request_id,receipt_number,amount_paid,currency,issued_at").in("payment_request_id", paymentIds).order("issued_at", { ascending:false });
            if (receipts.error) throw receipts.error;
            state.receipts = receipts.data || [];
        } else state.receipts = [];
        const documents = await supabase.rpc("list_autos_customer_documents");
        if (documents.error) throw documents.error;
        state.documents = documents.data?.documents || [];
        state.requests = documents.data?.requests || [];
    }

    function render() {
        const client = state.snapshot.client || {};
        const transactionList = state.snapshot.transactions || [];
        const pending = state.quotes.filter(row => row.status === "sent").length + state.agreements.filter(row => row.status === "sent").length + state.payments.filter(row => row.status === "requested").length + state.requests.filter(row => ["requested","viewed","rejected"].includes(row.status)).length;
        const nav = [["dashboard","Dashboard"],["tracking","My Tracking"],["documents","My Documents"],["payments","My Payments"],["updates","Messages & Updates"],["profile","My Profile"]];
        root.innerHTML = `
            <header class="autos-portal-header"><div><p class="eyebrow">LORDBLESS AUTOS</p><h1>Customer Portal</h1></div><div class="autos-portal-user"><strong>${esc(client.name || "Customer")}</strong><small>${esc(client.email || state.sessionEmail)}</small></div></header>
            <nav class="autos-portal-nav" aria-label="AUTOS portal sections">${nav.map(([key,label]) => `<button type="button" data-tab="${key}" aria-current="${state.active === key ? "page" : "false"}">${label}</button>`).join("")}</nav>
            <section class="autos-portal-content">${renderTab(state.active, transactionList, client, pending)}</section>
            <footer class="autos-muted" style="padding:24px 2px">© 2026 LORDBLESS AUTOS · <a href="client/index.html?portal=standard">Other LORDBLESS services</a> · <button class="autos-button secondary" type="button" data-signout>Sign out</button></footer>`;
    }

    function renderTab(tab, transactions, client, pending) {
        const latestUpdate = collectUpdates(transactions)[0];
        if (tab === "dashboard") return `<div class="autos-grid"><article class="autos-card autos-stat"><h3>Transactions</h3><strong>${transactions.length}</strong><span class="autos-muted">Active AUTOS enquiries</span></article><article class="autos-card autos-stat"><h3>Pending actions</h3><strong>${pending}</strong><span class="autos-muted">Items awaiting your attention</span></article><article class="autos-card autos-stat"><h3>Outstanding payments</h3><strong>${state.payments.filter(row => row.status === "requested").length}</strong><span class="autos-muted">Payment requests not yet verified</span></article><article class="autos-card autos-stat"><h3>Documents</h3><strong>${state.documents.length}</strong><span class="autos-muted">Submitted and available documents</span></article></div>
            ${transactions.length ? transactions.map(tx => `<article class="autos-card"><p class="eyebrow">TRANSACTION ${esc(tx.reference || "")}</p><h2>${esc(tx.title)}</h2><p>${esc(tx.service || "LORDBLESS AUTOS")} · Started ${date(tx.created_at)}</p>${(tx.journeys || []).map(journey => `<p>Current stage: <strong>${esc(human(journey.stage) || "Not assigned")}</strong> ${journey.operational_status ? `<span class="autos-tag">${esc(human(journey.operational_status))}</span>` : ""}</p>`).join("") || '<p class="autos-muted">Journey tracking will appear when the Admin team assigns the journey.</p>'}</article>`).join("") : '<article class="autos-card"><h2>Transactions</h2><p>Your AUTOS enquiry is being prepared. Transaction details will appear here as they are assigned.</p></article>'}
            <article class="autos-card"><h2>Recently added documents</h2>${state.documents.slice(0,3).map(doc => `<div class="autos-record">${esc(doc.document_name || doc.file_name || "Document")} · ${date(doc.uploaded_at)}</div>`).join("") || '<p class="autos-muted">No documents have been added yet.</p>'}</article>
            <article class="autos-card"><h2>Latest update</h2>${latestUpdate ? `<strong>${esc(latestUpdate.title)}</strong><p>${esc(latestUpdate.message)}</p><small>${date(latestUpdate.published_at || latestUpdate.created_at)}</small>` : '<p class="autos-muted">No updates yet.</p>'}</article>`;
        if (tab === "tracking") return transactions.map(tx => `<article class="autos-card"><p class="eyebrow">${esc(tx.reference || "AUTOS TRANSACTION")}</p><h2>${esc(tx.title)}</h2>${(tx.journeys || []).length ? tx.journeys.map(journey => {
            const currentIndex = stages.findIndex(([key]) => key === journey.stage);
            const timeline = journey.history || [];
            if (currentIndex < 0) return `<p class="autos-track-guide" role="status">Current stage: ${esc(human(journey.stage) || "Not assigned")}. A matching timeline is not available.</p>`;
            return `<p>Current stage: <strong>${esc(human(journey.stage) || "Not assigned")}</strong> · ${journey.operational_status ? ` · ${esc(human(journey.operational_status))}` : ""}</p><p class="autos-track-guide">Journey stage order · scroll horizontally to view all stages. The gold marker shows the current stage.</p><div class="autos-track">${stages.map(([key,label],index) => `<div class="autos-track-step ${index < currentIndex ? "is-complete" : index === currentIndex ? "is-current" : "is-upcoming"}">${esc(label)}<small>${index < currentIndex ? "Completed" : index === currentIndex ? "Current stage" : "Upcoming"}</small>${timeline.some(item => item.stage === key) ? `<br><small>${date(timeline.find(item => item.stage === key).created_at)}</small>` : ""}</div>`).join("")}</div>`;
        }).join("") : '<p>Tracking milestones will be published here by the AUTOS team.</p>'}</article>`).join("") || '<article class="autos-card"><h2>My Tracking</h2><p>No transaction tracking is available yet.</p></article>';
        if (tab === "documents") return renderDocuments();
        if (tab === "payments") return renderPayments();
        if (tab === "updates") {
            const items = collectUpdates(transactions);
            return `<article class="autos-card"><h2>Messages &amp; Updates</h2>${items.map(item => `<div class="autos-record"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${date(item.published_at || item.created_at)}</small></div>`).join("") || '<p>No updates have been published.</p>'}</article>`;
        }
        return `<article class="autos-card"><h2>My Profile</h2><div class="autos-grid"><p><span class="autos-muted">Name</span><br><strong>${esc(client.name || "—")}</strong></p><p><span class="autos-muted">Client reference</span><br><strong>${esc(client.client_code || "Available in your account settings")}</strong></p><p><span class="autos-muted">Email</span><br><strong>${esc(client.email || state.sessionEmail || "—")}</strong></p><p><span class="autos-muted">Phone</span><br><strong>${esc(client.phone || "—")}</strong></p></div><p class="autos-muted">Profile information associated with your AUTOS customer account.</p></article>`;
    }

    function collectUpdates(transactions) {
        const journeyUpdates = transactions.flatMap(tx => (tx.journeys || []).flatMap(journey => (journey.history || []).map(item => ({ title:"Journey progress update", message:`${item.previous_stage ? `${human(item.previous_stage)} → ` : ""}${human(item.stage)}`, created_at:item.created_at }))));
        const quoteUpdates = state.quotes.filter(item => item.sent_at).map(item => ({ title:"Vehicle quotation available", message:`${item.quote_reference} · ${item.currency} ${(Number(item.vehicle_purchase_price)+Number(item.lordbless_service_fee)).toFixed(2)} total (vehicle price and service fee).`, created_at:item.sent_at }));
        const agreementUpdates = state.agreements.filter(item => item.sent_at).map(item => ({ title:"Customer agreement available", message:`${item.agreement_reference} · version ${item.version}`, created_at:item.sent_at }));
        const paymentUpdates = state.payments.flatMap(item => [
            { title:"Payment request created", message:`${item.reference} · ${item.currency} ${Number(item.amount).toFixed(2)}`, created_at:item.created_at },
            ...(item.submitted_at ? [{ title:"Payment submitted for verification", message:`${item.reference} · reference received`, created_at:item.submitted_at }] : []),
            ...(item.verified_at ? [{ title:"Payment verified", message:`${item.reference} · ${item.currency} ${Number(item.amount).toFixed(2)}`, created_at:item.verified_at }] : [])
        ]);
        const documentUpdates = [
            ...state.requests.map(item => ({ title:"Document requested", message:item.document_name || item.document_type, created_at:item.created_at })),
            ...state.documents.filter(item => item.uploaded_at).map(item => ({ title:"Document submission", message:`${item.document_name || item.file_name || item.document_type} · ${human(item.status)}`, created_at:item.uploaded_at }))
        ];
        return [...state.updates, ...journeyUpdates, ...quoteUpdates, ...agreementUpdates, ...paymentUpdates, ...documentUpdates]
            .sort((a,b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
    }

    function renderDocuments() {
        const available = state.documents.map(doc => `<div class="autos-record"><strong>${esc(doc.document_name || doc.file_name || doc.document_type)}</strong> <span class="autos-tag">${esc(human(doc.status))}</span><p class="autos-muted">${esc(doc.file_name || "")} · ${date(doc.uploaded_at)}</p><button class="autos-button secondary" type="button" data-document="${esc(doc.id)}">Secure preview / download</button></div>`).join("");
        const requests = state.requests.map(request => {
            const latestDocument = state.documents.filter(doc => doc.document_request_id === request.id).sort((a,b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0))[0];
            const accepting = ["requested","viewed","rejected"].includes(request.status) && (!latestDocument || latestDocument.status === "rejected");
            return `<div class="autos-doc-form"><strong>${esc(request.document_name || request.document_type)}</strong><p>${esc(request.message || "Document requested")}</p><span class="autos-tag">${esc(human(request.status))}</span>${latestDocument ? `<p>Latest submission: <span class="autos-tag">${esc(human(latestDocument.status))}</span> · ${date(latestDocument.uploaded_at)}</p>${latestDocument.status === "rejected" && latestDocument.rejection_reason ? `<p>Review feedback: ${esc(latestDocument.rejection_reason)}</p>` : ""}` : ""}${accepting ? `<form class="autos-form" data-upload-request="${esc(request.id)}"><label>${latestDocument?.status === "rejected" ? "Choose replacement document" : "Select document"}<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" required></label><button class="autos-button">${latestDocument?.status === "rejected" ? "Upload replacement" : "Upload document"}</button></form>` : ""}</div>`;
        }).join("");
        return `<article class="autos-card"><h2>My Documents</h2><p>Private transaction documents and requests assigned to your client account.</p><div class="autos-document-grid">${requests || '<p class="autos-muted">No document requests.</p>'}</div><h3 style="margin-top:22px">Uploaded and shared documents</h3>${available || '<p class="autos-muted">No documents available yet.</p>'}<p class="autos-muted" data-document-message role="status"></p></article>`;
    }

    function renderPayments() {
        const quotes = state.quotes.map(item => `<div class="autos-record"><strong>Quotation ${esc(item.quote_reference)} · v${item.version}</strong><p>${esc(item.currency)} ${Number(item.vehicle_purchase_price).toFixed(2)} vehicle + ${esc(item.currency)} ${Number(item.lordbless_service_fee).toFixed(2)} LORDBLESS fee</p><span class="autos-tag">${esc(human(item.status))}</span>${item.accepted_at ? `<p>Accepted ${date(item.accepted_at)}</p>` : ""}${item.status === "sent" ? `<button class="autos-button" type="button" data-accept-quote="${esc(item.id)}">Accept quotation</button>` : ""}</div>`).join("");
        const agreements = state.agreements.map(item => `<div class="autos-record"><strong>Agreement ${esc(item.agreement_reference)} · v${item.version}</strong><p>Reference: ${esc(item.agreement_reference)} · Version ${item.version}</p><span class="autos-tag">${esc(human(item.status))}</span>${item.accepted_at ? `<p>Accepted ${date(item.accepted_at)}</p>` : ""}<button class="autos-button secondary" type="button" data-document="${esc(item.document_id)}">View agreement</button>${item.status === "sent" ? `<button class="autos-button" type="button" data-accept-agreement="${esc(item.id)}">Accept agreement</button>` : ""}</div>`).join("");
        const payments = state.payments.map(item => {
            const receipt = state.receipts.find(row => row.payment_request_id === item.id);
            return `<div class="autos-record"><strong>${esc(item.reference)} · ${esc(human(item.payment_type))}</strong><p>${esc(item.currency)} ${Number(item.amount).toFixed(2)} · ${esc(item.description)}</p>${item.payment_instructions ? `<p>${esc(item.payment_instructions)}</p>` : ""}<span class="autos-tag">${esc(human(item.status))}</span>${item.status === "requested" ? `<form class="autos-form" data-payment-submit="${esc(item.id)}"><label>Payment reference<input name="reference" required maxlength="160"></label><label>Payment date<input name="date" type="date"></label><button class="autos-button">Submit for verification</button></form>` : ""}${receipt ? `<p><strong>Official receipt ${esc(receipt.receipt_number)}</strong> · Issued ${date(receipt.issued_at)} · ${esc(receipt.currency)} ${Number(receipt.amount_paid).toFixed(2)} <button type="button" class="autos-button secondary" data-print-receipt="${esc(receipt.id)}">Print / Save receipt</button></p>` : ""}</div>`;
        }).join("");
        const logistics = state.logistics.map(item => `<div class="autos-record"><strong>Logistics statement ${esc(item.statement_reference)}</strong><p>${(item.line_items || []).map(line => `${esc(line.label)}: ${esc(item.currency)} ${Number(line.amount).toFixed(2)}`).join(" · ")}</p><span class="autos-tag">${esc(item.status)}</span><strong> Total ${esc(item.currency)} ${Number(item.total_amount).toFixed(2)}</strong></div>`).join("");
        return `<article class="autos-card"><h2>My Payments</h2><h3>Quotations</h3>${quotes || '<p>No quotations have been issued.</p>'}<h3>Customer agreements</h3>${agreements || '<p>No agreements are awaiting review.</p>'}<h3>Invoices &amp; payment requests, verification and receipts</h3>${payments || '<p>No AUTOS payment requests.</p>'}<h3>Separate logistics statements</h3>${logistics || '<p>No logistics statements have been issued.</p>'}</article>`;
    }

    async function onClick(event) {
        const tab = event.target.closest("[data-tab]");
        if (tab) { state.active = tab.dataset.tab; render(); return; }
        if (event.target.closest("[data-signout]")) { await supabase.auth.signOut(); window.location.replace("portal-login.html"); return; }
        const quote = event.target.closest("[data-accept-quote]");
        const agreement = event.target.closest("[data-accept-agreement]");
        if (quote || agreement) {
            const isQuote = Boolean(quote); const button = quote || agreement;
            if (!window.confirm(isQuote ? "Accept this quotation?" : "Confirm that you accept this agreement version?")) return;
            button.disabled = true;
            const { error } = await supabase.rpc(isQuote ? "accept_autos_quote" : "accept_autos_agreement", isQuote ? { p_quote_id:button.dataset.acceptQuote } : { p_agreement_id:button.dataset.acceptAgreement });
            if (error) { window.alert(error.message || "The acceptance could not be recorded."); button.disabled = false; return; }
            await load(); render(); return;
        }
        const receiptButton = event.target.closest("[data-print-receipt]");
        if (receiptButton) { printReceipt(receiptButton.dataset.printReceipt); return; }
        const documentButton = event.target.closest("[data-document]");
        if (documentButton) {
            const item = state.documents.find(row => row.id === documentButton.dataset.document);
            const path = item?.storage_path;
            if (!path) { window.alert("The secure document path is not available."); return; }
            const previewWindow = window.open("about:blank", "_blank");
            documentButton.disabled = true;
            const { data,error } = await supabase.storage.from("lordbless-client-documents").createSignedUrl(path, 60);
            documentButton.disabled = false;
            if (error) { previewWindow?.close(); window.alert(error.message); return; }
            if (previewWindow) previewWindow.location = data.signedUrl;
            else window.location.assign(data.signedUrl);
        }
    }

    function printReceipt(receiptId) {
        const receipt = state.receipts.find(row => row.id === receiptId);
        const payment = state.payments.find(row => row.id === receipt?.payment_request_id);
        if (!receipt || !payment) return;
        const printWindow = window.open("about:blank", "_blank");
        if (!printWindow) { window.alert("Allow the receipt window to open, then print or save it as PDF."); return; }
        printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(receipt.receipt_number)}</title><style>body{font:16px Arial,sans-serif;color:#18263d;margin:50px auto;max-width:760px;padding:30px}header{border-bottom:3px solid #b58b52;padding-bottom:20px}h1{font-size:28px}small{color:#687487}.paid{display:inline-block;padding:8px 14px;background:#e7f1e8;color:#245c32;font-weight:bold;border-radius:20px}.row{padding:13px 0;border-bottom:1px solid #ddd}strong{float:right}@media print{body{margin:15mm auto}}</style></head><body><header><p>LORDBLESS AUTOS</p><h1>Official Payment Receipt</h1><p>Receipt number: ${esc(receipt.receipt_number)}</p><span class="paid">PAID</span></header><div class="row">Customer <strong>${esc(state.snapshot.client?.name)}</strong></div><div class="row">Payment reference <strong>${esc(payment.reference)}</strong></div><div class="row">Description <strong>${esc(payment.description)}</strong></div><div class="row">Amount paid <strong>${esc(receipt.currency)} ${Number(receipt.amount_paid).toFixed(2)}</strong></div><div class="row">Issued <strong>${date(receipt.issued_at)}</strong></div><p><small>Electronic receipt issued by LORDBLESS AUTOS.</small></p><script>window.onload=()=>window.print()</script></body></html>`);
        printWindow.document.close();
    }

    async function onSubmit(event) {
        const uploadForm = event.target.closest("form[data-upload-request]");
        const paymentForm = event.target.closest("form[data-payment-submit]");
        if (!uploadForm && !paymentForm) return;
        event.preventDefault();
        const form = uploadForm || paymentForm;
        const button = form.querySelector("button"); button.disabled = true;
        const message = root.querySelector("[data-document-message]");
        try {
            if (uploadForm) await uploadDocument(uploadForm);
            else {
                const values = new FormData(paymentForm);
                const { error } = await supabase.rpc("submit_autos_payment_reference", { p_payment_id:paymentForm.dataset.paymentSubmit, p_reference:String(values.get("reference")).trim(), p_payment_date:values.get("date") || null });
                if (error) throw error;
                await load(); render(); state.active="payments"; render();
            }
        } catch (error) {
            if (message) message.textContent = error?.message || "Submission failed.";
            button.disabled = false;
        }
    }

    async function uploadDocument(form) {
        const request = state.requests.find(item => item.id === form.dataset.uploadRequest);
        const file = form.elements.file.files?.[0];
        if (!request || !file) throw new Error("Choose the requested document before uploading.");
        if (file.size <= 0 || file.size > 15 * 1024 * 1024) throw new Error("The document must be smaller than 15 MB.");
        const allowed = ["application/pdf","image/jpeg","image/png","image/webp","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
        if (!allowed.includes(file.type)) throw new Error("This file type is not supported.");
        const clientId = state.snapshot.client.id;
        const docId = crypto.randomUUID(); const path = `${clientId}/${docId}/${crypto.randomUUID()}`;
        const fileName = file.name.replace(/[\\/\u0000-\u001f\u007f]/g,"_").trim();
        if (!fileName || fileName.length > 255) throw new Error("The file name is not valid.");
        const message = root.querySelector("[data-document-message]"); if (message) message.textContent="Uploading securely…";
        let uploadedPath = "";
        try {
            const uploaded = await supabase.storage.from("lordbless-client-documents").upload(path,file,{contentType:file.type,upsert:false});
            if (uploaded.error) throw uploaded.error;
            uploadedPath = uploaded.data?.path || path;
            const { data,error } = await supabase.rpc("finalize_client_document_upload", {
                p_client_id:clientId,p_document_id:docId,p_document_request_id:request.id,
                p_document_type:request.document_type,p_document_name:request.document_name,
                p_file_name:fileName,p_storage_path:uploadedPath
            });
            if (error) throw error;
            if (data !== docId) throw new Error("Document upload was not confirmed by the server.");
        } catch (error) {
            if (uploadedPath) await supabase.storage.from("lordbless-client-documents").remove([uploadedPath]);
            throw error;
        }
        await load(); render(); state.active="documents"; render();
    }

    start().catch(error => {
        root.innerHTML = `<section class="autos-portal-error"><p class="eyebrow">LORDBLESS AUTOS</p><h1>Portal could not load</h1><p>${esc(error?.message || error)}</p><button type="button" class="autos-button" onclick="location.reload()">Try again</button><p><a href="client/index.html?portal=standard">Open the standard Client Portal</a></p></section>`;
    });
})();
