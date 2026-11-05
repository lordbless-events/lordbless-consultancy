/* ============================================================
   LORDBLESS FINANCIAL MANAGEMENT
   Saved income adjustments, expenses, remuneration and reports.
   ============================================================ */
(function () {
    "use strict";

    const CURRENCIES = ["EUR", "USD", "GHS"];
    const EXPENSE_CATEGORIES = [
        ["internet_wifi", "Internet and Wi-Fi"],
        ["ai_subscriptions", "ChatGPT and AI subscriptions"],
        ["software_subscriptions", "Software and digital subscriptions"],
        ["electricity", "Electricity"],
        ["office_expenses", "Office expenses"],
        ["staff_remuneration", "Staff remuneration"],
        ["staff_allowances", "Staff allowances"],
        ["marketing_advertising", "Marketing and advertising"],
        ["transport_logistics", "Transport and logistics"],
        ["professional_services", "Professional services"],
        ["equipment_maintenance", "Equipment and maintenance"],
        ["other_expenses", "Other expenses"]
    ];
    const INCOME_CATEGORIES = [
        ["other_organisational_income", "Other organisational income"],
        ["investment_income", "Investment income"],
        ["refund_recovery", "Refund or recovery"],
        ["other_income", "Other income"]
    ];
    const state = { container: null, entries: [], payments: [], period: "month", from: "", to: "", currency: "all", error: "", busy: false };

    function escape(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
    }
    function canRead() {
        return typeof hasPermission === "function" && hasPermission(getCurrentUser(), "finance.read");
    }
    function canManage() {
        return typeof hasPermission === "function" && (hasPermission(getCurrentUser(), "finance.requests") || hasPermission(getCurrentUser(), "admin.all"));
    }
    function ensureStyles() {
        if (document.getElementById("lbc-financial-management-styles")) return;
        const style = document.createElement("style");
        style.id = "lbc-financial-management-styles";
        style.textContent = `.lbc-finance-management{display:grid;gap:18px}.lbc-finance-management .fm-toolbar,.lbc-finance-management .fm-filters,.lbc-finance-management .fm-actions{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.lbc-finance-management .fm-toolbar{justify-content:space-between}.fm-filters label,.fm-form label{display:grid;gap:5px;font-size:13px;color:#455266}.fm-filters input,.fm-filters select,.fm-form input,.fm-form select,.fm-form textarea{min-height:38px;padding:8px 10px;border:1px solid #d4dbe5;border-radius:7px;background:white}.fm-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.fm-card,.fm-panel{background:#fff;border:1px solid #e1e6ed;border-radius:10px;padding:16px}.fm-card span,.fm-card small{display:block;color:#59677a}.fm-card strong{display:block;font-size:21px;margin:7px 0}.fm-panel h3{margin:0 0 13px}.fm-scroll{overflow:auto}.fm-table{width:100%;border-collapse:collapse;min-width:760px}.fm-table th,.fm-table td{text-align:left;padding:10px;border-bottom:1px solid #edf0f4;vertical-align:top}.fm-table th{font-size:12px;color:#64748b}.fm-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fm-form .wide{grid-column:1/-1}.fm-status{padding:10px;border-radius:7px;background:#fff8e8;color:#795400}.fm-report-title{display:none}.lbc-finance-management [hidden]{display:none!important}@media print{.fm-toolbar,.fm-filters,.fm-actions,.fm-edit,.fm-status{display:none!important}.fm-report-title{display:block}.fm-panel,.fm-card{break-inside:avoid}.finance-sidebar{display:none!important}}@media(max-width:650px){.fm-form{grid-template-columns:1fr}.fm-form .wide{grid-column:auto}}`;
        document.head.appendChild(style);
    }
    function dateString(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
    function applyPeriod(period) {
        const now = new Date();
        let start = new Date(now.getFullYear(), now.getMonth(), 1);
        let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        if (period === "quarter") {
            const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
            start = new Date(now.getFullYear(), quarterMonth, 1);
            end = new Date(now.getFullYear(), quarterMonth + 3, 0);
        } else if (period === "year") {
            start = new Date(now.getFullYear(), 0, 1);
            end = new Date(now.getFullYear(), 11, 31);
        }
        state.period = period;
        state.from = dateString(start);
        state.to = dateString(end);
    }
    function money(value, currency) {
        return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code" }).format(Number(value) || 0);
    }
    function labelFor(category, categories) {
        return categories.find(item => item[0] === category)?.[1] || String(category || "Other").replaceAll("_", " ");
    }
    function entryTotal(entry) { return Number(entry.amount || 0) + Number(entry.additional_amount || 0); }
    function dateAllowed(value) {
        const day = String(value || "").slice(0, 10);
        return (!state.from || day >= state.from) && (!state.to || day <= state.to);
    }
    function getVisibleEntries() { return state.entries.filter(entry => dateAllowed(entry.entry_date) && (state.currency === "all" || entry.currency === state.currency)); }
    function getVisiblePayments() { return state.payments.filter(payment => dateAllowed(payment.payment_date || payment.verified_at || payment.created_at) && (state.currency === "all" || payment.currency === state.currency)); }
    async function loadRecords() {
        state.error = "";
        const [entryResult, paymentResult] = await Promise.all([
            lordblessSupabase.from("finance_adjustments").select("id, entry_type, entry_date, category, description, amount, additional_amount, currency, payment_method, payment_reference, remarks, staff_name, payment_period, created_at, updated_at").order("entry_date", { ascending: false }),
            lordblessSupabase.from("client_assessment_payments").select("id, client_id, client_name, client_code, reference, purpose, verification_status, amount_received, amount, currency, payment_date, transaction_reference, verified_at").eq("verification_status", "verified").order("payment_date", { ascending: false })
        ]);
        if (entryResult.error) state.error = `Saved financial entries could not be loaded: ${entryResult.error.message}`;
        if (paymentResult.error) state.error = `${state.error ? `${state.error} ` : ""}Verified client income could not be loaded: ${paymentResult.error.message}`;
        state.entries = entryResult.data || [];
        state.payments = paymentResult.data || [];
        draw();
    }
    function totals(currency) {
        const entries = getVisibleEntries().filter(entry => entry.currency === currency);
        const payments = getVisiblePayments().filter(payment => payment.currency === currency);
        const clientIncome = payments.reduce((sum, payment) => sum + Number(payment.amount_received ?? payment.amount ?? 0), 0);
        const manualIncome = entries.filter(entry => entry.entry_type === "income").reduce((sum, entry) => sum + entryTotal(entry), 0);
        const expenses = entries.filter(entry => entry.entry_type === "expense");
        const expenditure = expenses.reduce((sum, entry) => sum + entryTotal(entry), 0);
        const remuneration = expenses.filter(entry => entry.category === "staff_remuneration" || entry.category === "staff_allowances").reduce((sum, entry) => sum + entryTotal(entry), 0);
        const income = clientIncome + manualIncome;
        return { income, expenditure, remuneration, operating: expenditure - remuneration, balance: income - expenditure };
    }
    function draw() {
        if (!state.container) return;
        ensureStyles();
        if (!canRead()) {
            state.container.innerHTML = `<div class="empty-state"><h3>Access restricted</h3><p>Finance permission is required to view internal financial records.</p></div>`;
            return;
        }
        const currencies = state.currency === "all" ? CURRENCIES : [state.currency];
        const summary = currencies.map(currency => {
            const value = totals(currency);
            return `<section class="fm-panel"><h3>${currency}</h3><div class="fm-summary"><div class="fm-card"><span>Total income</span><strong>${money(value.income, currency)}</strong><small>Verified client payments plus manual income</small></div><div class="fm-card"><span>Total expenditure</span><strong>${money(value.expenditure, currency)}</strong></div><div class="fm-card"><span>Staff remuneration</span><strong>${money(value.remuneration, currency)}</strong></div><div class="fm-card"><span>Operating expenses</span><strong>${money(value.operating, currency)}</strong></div><div class="fm-card"><span>Net balance</span><strong>${money(value.balance, currency)}</strong></div></div></section>`;
        }).join("");
        const breakdown = currencies.map(currency => {
            const groups = new Map();
            getVisiblePayments().filter(payment => payment.currency === currency).forEach(payment => {
                const key = `Income · ${payment.purpose || "Verified client payment"}`;
                groups.set(key, (groups.get(key) || 0) + Number(payment.amount_received ?? payment.amount ?? 0));
            });
            getVisibleEntries().filter(entry => entry.currency === currency).forEach(entry => {
                const category = labelFor(entry.category, entry.entry_type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
                const key = `${entry.entry_type === "income" ? "Income" : "Expense"} · ${category}`;
                groups.set(key, (groups.get(key) || 0) + entryTotal(entry));
            });
            const rows = Array.from(groups, ([category, amount]) => `<tr><td>${escape(category)}</td><td>${money(amount, currency)}</td></tr>`).join("") || `<tr><td colspan="2">No activity</td></tr>`;
            return `<section class="fm-panel"><h3>${currency} breakdown by category</h3><div class="fm-scroll"><table class="fm-table"><thead><tr><th>Income / expenditure category</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
        }).join("");
        const incomeRows = getVisiblePayments().map(payment => `<tr><td>${escape(String(payment.payment_date || payment.verified_at || "").slice(0, 10))}</td><td>Client payment</td><td>${escape(payment.client_name || "Client")}<br><small>${escape(payment.client_code || "")}</small></td><td>${escape(payment.reference || "")}</td><td>${escape(payment.purpose || "Client service")}</td><td>${escape(payment.currency)}</td><td>${money(payment.amount_received ?? payment.amount, payment.currency)}</td><td>Verified</td></tr>`).join("");
        const entries = getVisibleEntries().slice().sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
        const rows = entries.map(entry => `<tr><td>${escape(String(entry.entry_date || "").slice(0, 10))}</td><td>${entry.entry_type === "income" ? "Manual income" : "Expense"}</td><td>${escape(labelFor(entry.category, entry.entry_type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES))}${entry.staff_name ? `<br>${escape(entry.staff_name)} · ${escape(entry.payment_period || "")}` : ""}</td><td>${escape(entry.description)}</td><td>${escape(entry.payment_reference || "—")}</td><td>${escape(entry.currency)}</td><td>${money(entryTotal(entry), entry.currency)}</td><td>${canManage() ? `<button type="button" class="button button-secondary fm-edit" data-edit-entry="${escape(entry.id)}">Edit</button>` : "Saved"}</td></tr>`).join("");
        const reportRows = `${incomeRows}${rows}` || `<tr><td colspan="8">No financial activity in this period.</td></tr>`;
        state.container.innerHTML = `<div class="lbc-finance-management"><div class="fm-toolbar"><div><p class="section-eyebrow">FINANCE</p><h2>Financial Management & Reports</h2><p class="section-description">Saved records only. Currency totals are kept separate.</p></div><div class="fm-actions"><button type="button" class="button button-secondary" data-export="csv">Export Excel (CSV)</button><button type="button" class="button button-secondary" data-export="print">Print / Save PDF</button>${canManage() ? `<button type="button" class="button button-primary" data-add-entry="income">+ Record Income</button><button type="button" class="button button-primary" data-add-entry="expense">+ Add Expense</button>` : ""}</div></div>${state.error ? `<p class="fm-status" role="alert">${escape(state.error)}. Run the finance records proposal before using saved entries.</p>` : ""}<div class="fm-panel fm-filters"><label>Report period<select id="fm-period"><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Annual</option><option value="custom">Custom range</option></select></label><label>From<input type="date" id="fm-from" value="${escape(state.from)}"></label><label>To<input type="date" id="fm-to" value="${escape(state.to)}"></label><label>Currency<select id="fm-currency"><option value="all">All currencies separately</option>${CURRENCIES.map(currency => `<option value="${currency}">${currency}</option>`).join("")}</select></label><button type="button" class="button button-secondary" data-refresh>Refresh saved data</button></div><div class="fm-report-title"><h1>LORDBLESS CONSULTANCY Financial Report</h1><p>${escape(state.from)} to ${escape(state.to)} · ${escape(state.currency === "all" ? "EUR / USD / GHS shown separately" : state.currency)}</p></div>${summary}${breakdown}<section class="fm-panel"><h3>Transaction summary</h3><div class="fm-scroll"><table class="fm-table"><thead><tr><th>Date</th><th>Type</th><th>Category / Client</th><th>Description / Service</th><th>Reference</th><th>Currency</th><th>Amount</th><th>Record</th></tr></thead><tbody>${reportRows}</tbody></table></div></section><div id="fm-entry-form"></div></div>`;
        const period = state.container.querySelector("#fm-period"); if (period) period.value = state.period;
        const currency = state.container.querySelector("#fm-currency"); if (currency) currency.value = state.currency;
        bindEvents();
    }
    function formHTML(type, entry = null) {
        const income = type === "income";
        const categories = income ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        const staff = !income && ["staff_remuneration", "staff_allowances"].includes(entry?.category);
        return `<section class="fm-panel"><h3>${entry ? "Edit saved record" : income ? "Record additional income" : "Add expense"}</h3><form class="fm-form" id="fm-entry-form-element"><input type="hidden" name="id" value="${escape(entry?.id || "")}"><input type="hidden" name="entry_type" value="${income ? "income" : "expense"}"><label>Date<input required type="date" name="entry_date" value="${escape(entry?.entry_date || dateString(new Date()))}"></label><label>Category<select required name="category">${categories.map(([value, text]) => `<option value="${value}" ${entry?.category === value ? "selected" : ""}>${escape(text)}</option>`).join("")}</select></label><label class="wide">Description<input required maxlength="240" name="description" value="${escape(entry?.description || "")}" placeholder="${income ? "Source of income" : "What was this expense for?"}"></label><label>Amount<input required min="0.01" step="0.01" type="number" name="amount" value="${escape(entry?.amount ?? "")}"></label><label>Currency<select required name="currency">${CURRENCIES.map(code => `<option ${entry?.currency === code ? "selected" : ""}>${code}</option>`).join("")}</select></label>${!income ? `<label>Payment method<input maxlength="80" name="payment_method" value="${escape(entry?.payment_method || "")}" placeholder="Bank transfer, cash, mobile money"></label><label>Payment reference<input maxlength="120" name="payment_reference" value="${escape(entry?.payment_reference || "")}"></label>` : `<label>Income reference<input maxlength="120" name="payment_reference" value="${escape(entry?.payment_reference || "")}"></label>`}${income ? `<input type="hidden" name="additional_amount" value="0">` : `<div class="wide fm-form" data-staff-fields ${staff ? "" : "hidden"}><label>Staff name<input ${staff ? "required" : ""} maxlength="160" name="staff_name" value="${escape(entry?.staff_name || "")}"></label><label>Payment period<input ${staff ? "required" : ""} maxlength="80" name="payment_period" value="${escape(entry?.payment_period || "")}" placeholder="e.g. October 2026"></label><label>Allowances / additional payment<input min="0" step="0.01" type="number" name="additional_amount" value="${escape(entry?.additional_amount || 0)}"></label></div>`}<label class="wide">Remarks<textarea rows="3" maxlength="2000" name="remarks">${escape(entry?.remarks || "")}</textarea></label><div class="wide fm-actions"><button class="button button-primary" type="submit" ${state.busy ? "disabled" : ""}>Save record</button><button class="button button-secondary" type="button" data-cancel-form>Cancel</button></div></form></section>`;
    }
    function openForm(type, entry) {
        if (!canManage()) return;
        const host = state.container.querySelector("#fm-entry-form");
        host.innerHTML = formHTML(type, entry);
        host.scrollIntoView({ behavior: "smooth", block: "start" });
        const form = host.querySelector("form");
        form.addEventListener("submit", saveEntry);
        form.querySelector("[name=category]")?.addEventListener("change", event => {
            const staff = ["staff_remuneration", "staff_allowances"].includes(event.target.value);
            const fields = form.querySelector("[data-staff-fields]");
            if (!fields) return;
            fields.hidden = !staff;
            fields.querySelectorAll("input[name=staff_name], input[name=payment_period]").forEach(input => { input.required = staff; });
        });
        form.querySelector("[data-cancel-form]")?.addEventListener("click", () => { host.innerHTML = ""; });
    }
    async function saveEntry(event) {
        event.preventDefault();
        if (!canManage() || state.busy) return;
        const form = event.currentTarget;
        const payload = Object.fromEntries(new FormData(form).entries());
        const id = payload.id; delete payload.id;
        payload.amount = Number(payload.amount);
        payload.additional_amount = Number(payload.additional_amount || 0);
        if (!payload.entry_type || !payload.category || !payload.description || !Number.isFinite(payload.amount) || payload.amount <= 0) return;
        state.busy = true;
        const button = form.querySelector("[type=submit]"); if (button) button.disabled = true;
        let query = lordblessSupabase.from("finance_adjustments");
        const result = id ? await query.update(payload).eq("id", id) : await query.insert(payload);
        state.busy = false;
        if (result.error) {
            state.error = `The financial record was not saved: ${result.error.message}`;
            draw();
            return;
        }
        await loadRecords();
    }
    function exportCSV() {
        const lines = [["Date", "Type", "Client or category", "Description", "Reference", "Currency", "Amount", "Verification"]];
        getVisiblePayments().forEach(payment => lines.push([payment.payment_date || payment.verified_at || "", "Verified client payment", `${payment.client_name || "Client"} ${payment.client_code || ""}`, payment.purpose || "Client service", payment.reference || "", payment.currency, Number(payment.amount_received ?? payment.amount), "Verified"]));
        getVisibleEntries().forEach(entry => lines.push([entry.entry_date, entry.entry_type === "income" ? "Manual income" : "Expense", labelFor(entry.category, entry.entry_type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES), entry.description, entry.payment_reference || "", entry.currency, entryTotal(entry), "Saved"]));
        const csv = lines.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
        const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `lordbless-financial-report-${state.from}-${state.to}.csv`; link.click(); URL.revokeObjectURL(url);
    }
    function bindEvents() {
        state.container.querySelector("[data-refresh]")?.addEventListener("click", () => void loadRecords());
        state.container.querySelector("[data-add-entry='income']")?.addEventListener("click", () => openForm("income"));
        state.container.querySelector("[data-add-entry='expense']")?.addEventListener("click", () => openForm("expense"));
        state.container.querySelectorAll("[data-edit-entry]").forEach(button => button.addEventListener("click", () => {
            const entry = state.entries.find(item => String(item.id) === button.dataset.editEntry);
            if (entry) openForm(entry.entry_type, entry);
        }));
        state.container.querySelector("[data-export='csv']")?.addEventListener("click", exportCSV);
        state.container.querySelector("[data-export='print']")?.addEventListener("click", () => window.print());
        state.container.querySelector("#fm-period")?.addEventListener("change", event => {
            if (event.target.value !== "custom") applyPeriod(event.target.value);
            else state.period = "custom";
            draw();
        });
        state.container.querySelector("#fm-from")?.addEventListener("change", event => { state.period = "custom"; state.from = event.target.value; draw(); });
        state.container.querySelector("#fm-to")?.addEventListener("change", event => { state.period = "custom"; state.to = event.target.value; draw(); });
        state.container.querySelector("#fm-currency")?.addEventListener("change", event => { state.currency = event.target.value; draw(); });
    }
    async function render(container) {
        state.container = container;
        if (!state.from) applyPeriod("month");
        if (!canRead()) { draw(); return; }
        container.innerHTML = `<div class="empty-state">Loading saved financial records…</div>`;
        await loadRecords();
    }
    window.LORDBLESS_FINANCIAL_MANAGEMENT = { render, refresh: loadRecords };
})();