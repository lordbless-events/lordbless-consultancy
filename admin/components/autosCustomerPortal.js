(function () {
    "use strict";

    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
    const now = () => new Date().toISOString();
    const currencyOptions = '<option>EUR</option><option>USD</option><option>GHS</option>';

    async function mount(container, context) {
        if (!container || !context?.clientId || !context?.enquiryId || typeof lordblessSupabase === "undefined") return;
        const user = (await lordblessSupabase.auth.getUser()).data?.user;
        const canManage = typeof hasPermission === "function" && hasPermission(getCurrentUser(), "autos.manage");
        if (!canManage || !user) {
            container.innerHTML = '<p role="alert">AUTOS management permission is required for customer transaction tools.</p>';
            return;
        }

        const load = async () => {
            const [quotes, agreements, logistics, payments, updates, documents] = await Promise.all([
                lordblessSupabase.from("autos_customer_quotes").select("id,client_id,enquiry_id,quote_reference,version,currency,vehicle_purchase_price,lordbless_service_fee,status,created_at,sent_at,accepted_at").eq("enquiry_id", context.enquiryId).order("version", { ascending: false }),
                lordblessSupabase.from("autos_customer_agreements").select("id,client_id,enquiry_id,document_id,agreement_reference,version,status,created_at,sent_at,accepted_at").eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("autos_logistics_statements").select("id,client_id,enquiry_id,statement_reference,currency,line_items,total_amount,status,created_at,issued_at").eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("autos_payment_requests").select("id,client_id,enquiry_id,quote_id,logistics_statement_id,reference,payment_type,currency,amount,description,payment_instructions,status,client_payment_reference,client_payment_date,submitted_at,verified_at,created_at").eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("autos_customer_updates").select("id,client_id,enquiry_id,title,message,published,created_at,published_at").eq("enquiry_id", context.enquiryId).order("created_at", { ascending: false }),
                lordblessSupabase.from("client_documents").select("id,document_name,file_name,document_type,status,uploaded_at").eq("client_id", context.clientId).eq("status", "approved").order("uploaded_at", { ascending: false })
            ]);
            const error = [quotes, agreements, logistics, payments, updates, documents].find(result => result.error)?.error;
            if (error) throw error;
            const paymentIds = (payments.data || []).map(item => item.id);
            const receipts = paymentIds.length
                ? await lordblessSupabase.from("autos_customer_receipts").select("id,payment_request_id,receipt_number,amount_paid,currency,issued_at").in("payment_request_id", paymentIds)
                : { data:[], error:null };
            if (receipts.error) throw receipts.error;
            return { quotes: quotes.data || [], agreements: agreements.data || [], logistics: logistics.data || [], payments: payments.data || [], updates: updates.data || [], documents: documents.data || [], receipts: receipts.data || [] };
        };

        const render = data => {
            const latestVersion = data.quotes.reduce((max, quote) => Math.max(max, Number(quote.version) || 0), 0);
            const paymentFormOptions = `<option value="">Select accepted quote or issued statement</option>${data.quotes.filter(row => row.status === "accepted").map(row => `<option data-kind="quote" value="${escape(row.id)}">${escape(row.quote_reference)} · v${row.version}</option>`).join("")}${data.logistics.filter(row => row.status === "issued").map(row => `<option data-kind="logistics" value="${escape(row.id)}">${escape(row.statement_reference)}</option>`).join("")}`;
            container.innerHTML = `
                <h3>AUTOS Customer Transaction Portal</h3>
                <p>${escape(context.clientName)} · ${escape(context.enquiryReference)}</p>
                <div class="autos-customer-admin-grid">
                    <form class="autos-customer-admin-card" data-autos-form="quote"><h4>Vehicle quotation</h4>
                        <p>Includes vehicle purchase price and LORDBLESS service fee only.</p>
                        <label>Currency<select name="currency">${currencyOptions}</select></label>
                        <label>Vehicle purchase price<input name="purchase" type="number" min="0.01" step="0.01" required></label>
                        <label>LORDBLESS service fee<input name="fee" type="number" min="0" step="0.01" required></label>
                        <button type="submit" class="button button-primary">Publish quotation v${latestVersion + 1}</button></form>
                    <form class="autos-customer-admin-card" data-autos-form="agreement"><h4>Customer agreement</h4>
                        <p>Attach an approved customer-facing agreement already stored in the client document library.</p>
                        <label>Approved agreement document<select name="document" required><option value="">Select an approved AUTOS agreement</option>${data.documents.filter(item => String(item.document_type || "").toLowerCase().includes("agreement")).map(item => `<option value="${escape(item.id)}">${escape(item.document_name || item.file_name || item.id)} · ${escape(item.id)}</option>`).join("")}</select></label>
                        <label>Agreement reference<input name="reference" required maxlength="120"></label>
                        <p>Each published agreement receives the next version number automatically.</p>
                        <button type="submit" class="button button-primary">Send for acceptance</button></form>
                    <form class="autos-customer-admin-card" data-autos-form="logistics"><h4>Separate logistics statement</h4>
                        <label>Statement reference<input name="reference" required maxlength="100"></label>
                        <label>Currency<select name="currency">${currencyOptions}</select></label>
                        <label>Costs (one per line: name | amount)<textarea name="items" required placeholder="Shipping | 0.00&#10;Insurance | 0.00"></textarea></label>
                        <button type="submit" class="button button-primary">Issue logistics statement</button></form>
                    <form class="autos-customer-admin-card" data-autos-form="payment"><h4>Payment request</h4>
                        <label>Type<select name="type"><option value="vehicle_purchase">Vehicle purchase</option><option value="service_fee">Service fee</option><option value="logistics">Logistics</option></select></label>
                        <label>Accepted quotation / logistics statement<select name="related" required data-autos-related>${paymentFormOptions}</select></label>
                        <label>Reference<input name="reference" required maxlength="100"></label>
                        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label>
                        <label>Currency<select name="currency">${currencyOptions}</select></label>
                        <label>Instructions<textarea name="instructions" maxlength="3000"></textarea></label>
                        <button type="submit" class="button button-primary">Create payment request</button></form>
                    <form class="autos-customer-admin-card" data-autos-form="update"><h4>Customer update</h4>
                        <label>Title<input name="title" required maxlength="160"></label><label>Message<textarea name="message" required maxlength="3000"></textarea></label>
                        <button type="submit" class="button button-primary">Publish update</button></form>
                </div>
                <p class="autos-customer-admin-message" role="status" data-autos-message></p>
                <div class="autos-customer-admin-grid">${renderRecords(data)}</div>`;
            container.querySelectorAll("form[data-autos-form]").forEach(form => form.addEventListener("submit", event => save(event, form, data)));
            container.querySelector('[name="type"]')?.addEventListener("change", event => {
                const type = event.currentTarget.value;
                container.querySelectorAll("[data-autos-related] option[data-kind]").forEach(option => {
                    option.hidden = type === "logistics" ? option.dataset.kind !== "logistics" : option.dataset.kind !== "quote";
                });
                container.querySelector("[data-autos-related]").value = "";
            });
            container.querySelector('[name="type"]')?.dispatchEvent(new Event("change", { bubbles:true }));
            container.querySelectorAll("[data-autos-verify]").forEach(button => button.addEventListener("click", () => verify(button)));
        };

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
