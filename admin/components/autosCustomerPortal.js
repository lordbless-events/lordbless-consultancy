(function () {
    "use strict";

    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
    const now = () => new Date().toISOString();
    const currencyOptions = '<option value="EUR">EUR</option><option value="USD">USD</option><option value="GHS">GHS</option>';

    async function mount(container, context) {
        if (!container || !context?.clientId || !context?.enquiryId || typeof lordblessSupabase === "undefined") return;
        const user = (await lordblessSupabase.auth.getUser()).data?.user;
        const canManage = typeof hasPermission === "function" && hasPermission(getCurrentUser(), "autos.manage");
        if (!canManage || !user) {
            container.innerHTML = '<p role="alert">AUTOS management permission is required for customer transaction tools.</p>';
            return;
        }

        const load = async () => {
            const [quotes, agreements, logistics, payments, updates, documents, requests] = await Promise.all([
                lordblessSupabase.from("autos_customer_quotes").select("id,client_id,enquiry_id,quote_reference,version,currency,vehicle_purchase_price,lordbless_service_fee,status,created_at,sent_at,accepted_at").eq("client_id", context.clientId).eq("enquiry_id", context.enquiryId).order("version", { ascending: false }),
                lordblessSupabase.from("autos_customer_agreements").select("id,client_id,enquiry_id,document_id,agreement_reference,version,status,created_at,sent_at,accepted_at").eq("client_id", context.clientId).eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("autos_logistics_statements").select("id,client_id,enquiry_id,statement_reference,currency,line_items,total_amount,status,created_at,issued_at").eq("client_id", context.clientId).eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("autos_payment_requests").select("id,client_id,enquiry_id,quote_id,logistics_statement_id,reference,payment_type,currency,amount,description,payment_instructions,status,client_payment_reference,client_payment_date,submitted_at,verified_at,created_at").eq("client_id", context.clientId).eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("autos_customer_updates").select("id,client_id,enquiry_id,title,message,published,created_at,published_at").eq("client_id", context.clientId).eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("client_documents").select("id,document_request_id,document_name,file_name,document_type,status,uploaded_at").eq("client_id", context.clientId).eq("status", "approved").order("uploaded_at", { ascending: false }),
                lordblessSupabase.from("document_requests").select("id,client_id,enquiry_id,document_type").eq("client_id", context.clientId).eq("enquiry_id", context.enquiryId)
            ]);
            const error = [quotes, agreements, logistics, payments, updates, documents, requests].find(result => result.error)?.error;
            if (error) throw error;
            const paymentIds = (payments.data || []).map(item => item.id);
            const receipts = paymentIds.length
                ? await lordblessSupabase.from("autos_customer_receipts").select("id,payment_request_id,receipt_number,amount_paid,currency,issued_at").in("payment_request_id", paymentIds)
                : { data:[], error:null };
            if (receipts.error) throw receipts.error;
            const transactionAgreementRequestIds = new Set((requests.data || [])
                .filter(request => String(request.document_type || "").toLowerCase().includes("agreement"))
                .map(request => request.id));
            const transactionAgreementDocumentIds = new Set((agreements.data || []).map(agreement => agreement.document_id));
            const eligibleAgreementDocuments = (documents.data || []).filter(document =>
                document.status === "approved" &&
                (transactionAgreementRequestIds.has(document.document_request_id) || transactionAgreementDocumentIds.has(document.id)) &&
                String(document.document_type || "").toLowerCase().includes("agreement")
            );
            return { quotes: quotes.data || [], agreements: agreements.data || [], logistics: logistics.data || [], payments: payments.data || [], updates: updates.data || [], documents: eligibleAgreementDocuments, receipts: receipts.data || [] };
        };

        const render = data => {
            const latestVersion = data.quotes.reduce((max, quote) => Math.max(max, Number(quote.version) || 0), 0);
            const agreementOptions = data.documents.map(item => `<option value="${escape(item.id)}">${escape(item.document_name || item.file_name || "Approved agreement")}</option>`).join("");
            container.innerHTML = `
                <header class="autos-customer-admin-header"><div><span class="autos-customer-admin-eyebrow">AUTOS TRANSACTION MANAGEMENT</span><h3>Customer Transaction Portal</h3><p>${escape(context.clientName)} · ${escape(context.enquiryReference)}</p></div><button type="button" class="button button-secondary autos-customer-refresh" data-autos-refresh>Refresh records</button></header>
                <div class="autos-customer-admin-sections">
                    <section class="autos-customer-admin-section"><div class="autos-customer-admin-section-heading"><span>COMMERCIAL DOCUMENTS</span><p>Prepare the vehicle offer and customer agreement for this enquiry.</p></div><div class="autos-customer-admin-grid autos-customer-admin-grid-two">
                    <form class="autos-customer-admin-card" data-autos-form="quote"><h4>Vehicle quotation</h4><p>Includes vehicle purchase price and LORDBLESS service fee only.</p>
                        <label>Currency<select name="currency">${currencyOptions}</select></label><label>Vehicle purchase price<input name="purchase" type="number" min="0.01" step="0.01" required></label><label>LORDBLESS service fee<input name="fee" type="number" min="0" step="0.01" required></label>
                        <button type="submit" class="button button-primary">Publish quotation v${latestVersion + 1}</button></form>
                    <form class="autos-customer-admin-card" data-autos-form="agreement"><h4>Customer agreement</h4><p>Attach an approved customer-facing agreement already stored in the client document library.</p>
                        <label>Approved agreement document<select name="document" required><option value="">${agreementOptions ? "Select an approved agreement for this enquiry" : "No approved agreement documents linked to this enquiry"}</option>${agreementOptions}</select></label><label>Agreement reference<input name="reference" required maxlength="120"></label><p>Each published agreement receives the next version number automatically.</p>
                        <button type="submit" class="button button-primary">Send for acceptance</button></form></div></section>
                    <section class="autos-customer-admin-section"><div class="autos-customer-admin-section-heading"><span>LOGISTICS</span><p>Issue transport and related costs separately from the vehicle quotation.</p></div>
                    <form class="autos-customer-admin-card" data-autos-form="logistics"><h4>Separate logistics statement</h4><label>Statement reference<input name="reference" required maxlength="100"></label><label>Currency<select name="currency">${currencyOptions}</select></label><label>Costs (one per line: name | amount)<textarea name="items" required placeholder="Shipping | 0.00&#10;Insurance | 0.00"></textarea></label>
                        <button type="submit" class="button button-primary">Issue logistics statement</button></form></section>
                    <section class="autos-customer-admin-section"><div class="autos-customer-admin-section-heading"><span>PAYMENT</span><p>Requests must match an accepted quotation or issued logistics statement exactly.</p></div>
                    <form class="autos-customer-admin-card" data-autos-form="payment"><h4>Payment request</h4><label>Type<select name="type"><option value="vehicle_purchase">Vehicle purchase</option><option value="service_fee">Service fee</option><option value="logistics">Logistics</option></select></label>
                        <label>Accepted quotation / logistics statement<select name="related" required data-autos-related><option value="">Select request type first</option></select></label><label>Reference<input name="reference" required maxlength="100"></label>
                        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required readonly aria-describedby="autos-payment-source-help"></label><label>Currency<select name="currency" aria-describedby="autos-payment-source-help">${currencyOptions}</select></label><small id="autos-payment-source-help" class="autos-customer-field-help">Amount and currency follow the accepted source record.</small>
                        <label>Instructions<textarea name="instructions" maxlength="3000"></textarea></label><button type="submit" class="button button-primary">Create payment request</button></form></section>
                    <section class="autos-customer-admin-section"><div class="autos-customer-admin-section-heading"><span>CUSTOMER COMMUNICATION</span><p>Publish a clear update to this customer’s AUTOS portal.</p></div>
                    <form class="autos-customer-admin-card" data-autos-form="update"><h4>Customer update</h4><label>Title<input name="title" required maxlength="160"></label><label>Message<textarea name="message" required maxlength="3000"></textarea></label><button type="submit" class="button button-primary">Publish update</button></form></section>
                </div>
                <p class="autos-customer-admin-message" role="status" data-autos-message></p><div class="autos-customer-admin-grid">${renderRecords(data)}</div>`;
            container.querySelectorAll("form[data-autos-form]").forEach(form => form.addEventListener("submit", event => save(event, form, data)));
            container.querySelector('[name="type"]')?.addEventListener("change", () => refreshPaymentSources(data));
            container.querySelector('[name="related"]')?.addEventListener("change", syncPaymentSource);
            container.querySelector('[data-autos-form="payment"] [name="currency"]')?.addEventListener("change", syncPaymentSource);
            container.querySelector('[name="type"]')?.dispatchEvent(new Event("change", { bubbles:true }));
            container.querySelectorAll("[data-autos-verify]").forEach(button => button.addEventListener("click", () => verify(button)));
            container.querySelector("[data-autos-refresh]")?.addEventListener("click", async event => {
                const button = event.currentTarget; button.disabled = true;
                const hasDraftInput = Array.from(container.querySelectorAll('form[data-autos-form] input, form[data-autos-form] textarea'))
                    .some(input => String(input.value || "").trim());
                if (hasDraftInput && !window.confirm("Refreshing records will clear unsaved form entries. Continue?")) {
                    button.disabled = false;
                    return;
                }
                const message = container.querySelector("[data-autos-message]"); message.textContent = "Refreshing saved transaction records…";
                try { render(await load()); container.querySelector("[data-autos-message]").textContent = "Transaction records refreshed."; }
                catch (error) { message.textContent = error?.message || "Transaction records could not be refreshed."; button.disabled = false; }
            });
        };

        function refreshPaymentSources(data) {
            const type = container.querySelector('[name="type"]')?.value;
            const related = container.querySelector('[name="related"]');
            if (!related) return;
            const sources = type === "logistics"
                ? data.logistics.filter(row => row.status === "issued" && Number(row.total_amount) > 0).map(row => ({ id:row.id, label:row.statement_reference, amount:row.total_amount, currency:row.currency }))
                : data.quotes.filter(row => row.status === "accepted").map(row => ({ id:row.id, label:`${row.quote_reference} · v${row.version}`, amount:type === "service_fee" ? row.lordbless_service_fee : row.vehicle_purchase_price, currency:row.currency })).filter(row => Number(row.amount) > 0);
            related.innerHTML = `<option value="">${sources.length ? "Select a matching accepted record" : "No matching accepted or issued records available"}</option>${sources.map(row => `<option value="${escape(row.id)}" data-amount="${escape(row.amount)}" data-currency="${escape(row.currency)}">${escape(row.label)}</option>`).join("")}`;
            related.value = ""; syncPaymentSource();
        }

        function syncPaymentSource() {
            const related = container.querySelector('[name="related"]');
            const amount = container.querySelector('[data-autos-form="payment"] [name="amount"]');
            const currency = container.querySelector('[data-autos-form="payment"] [name="currency"]');
            const selected = related?.selectedOptions?.[0];
            const sourceCurrency = selected?.dataset?.currency || "";
            if (amount) amount.value = selected?.dataset?.amount || "";
            if (currency && sourceCurrency) currency.value = sourceCurrency;
        }

        function renderRecords(data) {
            const card = (title, rows, map) => `<section class="autos-customer-admin-card"><h4>${title}</h4>${rows.length ? rows.map(map).join("") : "<p>None yet.</p>"}</section>`;
            return [
                card("Quotations", data.quotes, item => `<div class="autos-customer-admin-record"><strong>${escape(item.quote_reference)} · v${item.version}</strong><br>${escape(item.currency)} ${Number(item.vehicle_purchase_price).toFixed(2)} vehicle + ${escape(item.currency)} ${Number(item.lordbless_service_fee).toFixed(2)} fee<br><span class="autos-customer-admin-status">${escape(item.status)}</span>${item.accepted_at ? `<br>Accepted ${escape(new Date(item.accepted_at).toLocaleString("en-GB"))}` : ""}</div>`),
                card("Agreements", data.agreements, item => `<div class="autos-customer-admin-record"><strong>${escape(item.agreement_reference)} · v${item.version}</strong><br><span class="autos-customer-admin-status">${escape(item.status)}</span>${item.accepted_at ? `<br>Accepted ${escape(new Date(item.accepted_at).toLocaleString("en-GB"))}` : ""}</div>`),
                card("Logistics statements", data.logistics, item => `<div class="autos-customer-admin-record"><strong>${escape(item.statement_reference)}</strong><br>${escape(item.currency)} ${Number(item.total_amount).toFixed(2)} · ${escape(item.status)}</div>`),
                card("Payment requests", data.payments, item => `<div class="autos-customer-admin-record"><strong>${escape(item.reference)}</strong><br>${escape(item.payment_type)} · ${escape(item.currency)} ${Number(item.amount).toFixed(2)} · ${escape(item.status)}${item.status === "submitted" ? `<br>Client reference: ${escape(item.client_payment_reference || "—")} · Date: ${escape(item.client_payment_date || "—")}<br><button type="button" class="button button-secondary" data-autos-verify="${escape(item.id)}">Verify and issue receipt</button>` : ""}${data.receipts.filter(receipt => receipt.payment_request_id === item.id).map(receipt => `<br>Official receipt: ${escape(receipt.receipt_number)} · ${escape(receipt.currency)} ${Number(receipt.amount_paid).toFixed(2)}`).join("")}</div>`),
                card("Customer updates", data.updates, item => `<div class="autos-customer-admin-record"><strong>${escape(item.title)}</strong><br>${escape(item.message)}<br>${item.published ? "Published" : "Draft"}</div>`)
            ].join("");
        }

        async function save(event, form, data) {
            event.preventDefault();
            const submit = form.querySelector('[type="submit"]');
            const message = container.querySelector("[data-autos-message]");
            const values = new FormData(form);
            const base = { client_id: context.clientId, enquiry_id: context.enquiryId, created_by: user.id };
            submit.disabled = true;
            message.textContent = "Saving…";
            try {
                let table, record;
                switch (form.dataset.autosForm) {
                    case "quote": {
                        const { error } = await lordblessSupabase.rpc("create_autos_customer_quote", {
                            p_client_id:context.clientId,p_enquiry_id:context.enquiryId,p_currency:values.get("currency"),
                            p_vehicle_price:Number(values.get("purchase")),p_service_fee:Number(values.get("fee"))
                        });
                        if (error) throw error;
                        table = null;
                        break;
                    }
                    case "agreement": {
                        const { error } = await lordblessSupabase.rpc("create_autos_customer_agreement", {
                            p_client_id:context.clientId,p_enquiry_id:context.enquiryId,p_document_id:String(values.get("document")).trim(),
                            p_reference:String(values.get("reference")).trim()
                        });
                        if (error) throw error;
                        table = null;
                        break;
                    }
                    case "logistics": {
                        const lineItems = String(values.get("items")).split(/\r?\n/).map(line => {
                            const [label, amount] = line.split("|").map(part => part.trim());
                            return { label, amount: Number(amount) };
                        });
                        if (!lineItems.length || lineItems.some(item => !item.label || !Number.isFinite(item.amount) || item.amount < 0)) throw new Error("Enter each cost as name | non-negative amount.");
                        const { error } = await lordblessSupabase.rpc("create_autos_logistics_statement", {
                            p_client_id:context.clientId,p_enquiry_id:context.enquiryId,p_reference:String(values.get("reference")).trim(),
                            p_currency:values.get("currency"),p_line_items:lineItems
                        });
                        if (error) throw error;
                        table = null;
                        break;
                    }
                    case "payment": {
                        const type = values.get("type");
                        const relatedId = String(values.get("related") || "");
                        if (!relatedId) throw new Error("Select an eligible accepted quotation or issued logistics statement first.");
                        const source = form.querySelector('[name="related"]')?.selectedOptions?.[0];
                        if (!source?.dataset?.amount || !source?.dataset?.currency) throw new Error("The selected source is unavailable. Refresh the saved records and try again.");
                        if (values.get("currency") !== source.dataset.currency || Number(values.get("amount")) !== Number(source.dataset.amount)) {
                            throw new Error("The payment request must match the selected source amount and currency.");
                        }
                        const logistics = type === "logistics";
                        const { error } = await lordblessSupabase.rpc("create_autos_payment_request", {
                            p_client_id:context.clientId,p_enquiry_id:context.enquiryId,p_reference:String(values.get("reference")).trim(),
                            p_type:type,p_currency:values.get("currency"),p_amount:Number(values.get("amount")),
                            p_description:`${type} payment`,p_instructions:String(values.get("instructions") || "").trim(),
                            p_quote_id:logistics ? null : relatedId,p_logistics_statement_id:logistics ? relatedId : null
                        });
                        if (error) throw error;
                        table = null;
                        break;
                    }
                    case "update":
                        record = { ...base, title: String(values.get("title")).trim(), message: String(values.get("message")).trim(), published: true, published_at: now() };
                        table = "autos_customer_updates";
                        break;
                    default: throw new Error("Unknown AUTOS portal action.");
                }
                if (table) {
                    const { error } = await lordblessSupabase.from(table).insert(record);
                    if (error) throw error;
                }
                render(await load());
                container.querySelector("[data-autos-message]").textContent = "Saved and available in the customer portal.";
            } catch (error) {
                message.textContent = error?.message || "The AUTOS customer record could not be saved.";
                submit.disabled = false;
            }
        }

        async function verify(button) {
            const receiptNumber = window.prompt("Enter the official receipt number to issue after verifying funds:");
            if (!receiptNumber?.trim()) return;
            button.disabled = true;
            const { error } = await lordblessSupabase.rpc("verify_autos_payment", { p_payment_id: button.dataset.autosVerify, p_receipt_number: receiptNumber.trim() });
            if (error) {
                button.disabled = false;
                window.alert(error.message || "Payment verification failed.");
                return;
            }
            render(await load());
        }

        try { render(await load()); }
        catch (error) { container.innerHTML = `<p role="alert">AUTOS transaction tools could not load: ${escape(error?.message || error)}</p>`; }
    }

    window.LORDBLESS_AUTOS_CUSTOMER_ADMIN = { mount };
})();
