(function () {
    "use strict";

    const TIMEZONES = ["Europe/Berlin", "Africa/Accra", "UTC", "America/Toronto", "Asia/Shanghai"];
    const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));

    function canManage() {
        const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
        return Boolean(user && typeof hasPermission === "function" && (
            hasPermission(user, "settings.manage") || hasPermission(user, "admin.all")
        ));
    }

    async function loadAppointmentTimezoneDefault() {
        if (typeof lordblessSupabase === "undefined") return "Europe/Berlin";
        try {
            const { data, error } = await lordblessSupabase.rpc("get_default_appointment_timezone");
            if (error) throw error;
            if (typeof data === "string" && data) {
                window.LORDBLESS_DEFAULT_APPOINTMENT_TIMEZONE = data;
                return data;
            }
        } catch (error) {
            console.warn("Default appointment timezone could not be loaded:", error?.message || error);
        }
        return window.LORDBLESS_DEFAULT_APPOINTMENT_TIMEZONE || "Europe/Berlin";
    }

    async function render(container) {
        if (!container) return;
        container.innerHTML = '<section class="section lbc-settings"><p class="section-eyebrow">ADMINISTRATION</p><h2>Settings</h2><p>Loading saved company settings…</p></section>';
        try {
            const { data, error } = await lordblessSupabase.rpc("get_company_settings");
            if (error) throw error;
            const settings = data || {};
            window.LORDBLESS_DEFAULT_APPOINTMENT_TIMEZONE = settings.default_appointment_timezone || "Europe/Berlin";
            const editable = canManage();
            const timezoneOptions = [...new Set([...TIMEZONES, settings.default_appointment_timezone].filter(Boolean))];
            const currencies = Array.isArray(settings.supported_currencies) ? settings.supported_currencies : ["EUR", "USD", "GHS"];

            container.innerHTML = `
                <section class="section lbc-settings">
                    <div class="section-header"><div><p class="section-eyebrow">ADMINISTRATION</p><h2>Settings</h2><p class="section-subtitle">Manage official company details and essential portal configuration.</p></div></div>
                    ${!editable ? '<p class="lbc-settings-notice">Settings are available for viewing. Contact an Overall Admin to make changes.</p>' : ""}
                    <form class="lbc-settings-panel" data-company-settings>
                        <div class="lbc-settings-panel-heading"><div><span>COMPANY INFORMATION</span><p>Official business identity and contact details.</p></div></div>
                        <div class="lbc-settings-grid">
                            <label>Consultancy name<input name="consultancy_name" maxlength="160" required value="${esc(settings.consultancy_name)}" ${editable ? "" : "readonly"}></label>
                            <label>Company logo path<input name="company_logo_url" maxlength="500" placeholder="/images/service-images/lordbless-header-logo.png" value="${esc(settings.company_logo_url)}" ${editable ? "" : "readonly"}><small>Use an image already served from this website’s /images folder.</small></label>
                            <label>Official email<input name="official_email" type="email" maxlength="254" value="${esc(settings.official_email)}" ${editable ? "" : "readonly"}></label>
                            <label>Telephone<input name="telephone" type="tel" maxlength="40" value="${esc(settings.telephone)}" ${editable ? "" : "readonly"}></label>
                            <label>WhatsApp<input name="whatsapp" type="tel" maxlength="40" value="${esc(settings.whatsapp)}" ${editable ? "" : "readonly"}></label>
                            <label>Business address<textarea name="business_address" maxlength="500" rows="3" ${editable ? "" : "readonly"}>${esc(settings.business_address)}</textarea></label>
                        </div>

                        <div class="lbc-settings-panel-heading"><div><span>CONTACT INFORMATION</span><p>The official email, telephone and WhatsApp are managed above.</p></div></div>
                        <div class="lbc-settings-grid">
                            <label>Official website<input name="official_website" type="url" maxlength="255" placeholder="https://example.com" value="${esc(settings.official_website)}" ${editable ? "" : "readonly"}></label>
                            <label>Additional business contact details<textarea name="business_contact_details" maxlength="1000" rows="3" placeholder="Optional service hours or office contact notes" ${editable ? "" : "readonly"}>${esc(settings.business_contact_details)}</textarea></label>
                        </div>

                        <div class="lbc-settings-panel-heading"><div><span>BUSINESS CONFIGURATION</span><p>Currency support remains EUR, USD and GHS across the existing finance workflows.</p></div></div>
                        <div class="lbc-settings-grid">
                            <div class="lbc-settings-field"><span>Supported currencies</span><div class="lbc-settings-currencies">${currencies.map(code => `<span>${esc(code)}</span>`).join("")}</div><small>Currency support is fixed by the existing finance modules.</small></div>
                            <label>Default appointment timezone<select name="default_appointment_timezone" ${editable ? "" : "disabled"}>${timezoneOptions.map(zone => `<option value="${esc(zone)}" ${settings.default_appointment_timezone === zone ? "selected" : ""}>${esc(zone)}</option>`).join("")}</select><small>Used for newly scheduled consultations. Existing appointments retain their saved timezone.</small></label>
                        </div>

                        <p class="lbc-settings-message" data-settings-message role="status" aria-live="polite"></p>
                        ${editable ? '<button class="button button-primary" type="submit">Save company settings</button>' : ""}
                        ${settings.updated_at ? `<small class="lbc-settings-updated">Last saved ${esc(new Date(settings.updated_at).toLocaleString("en-GB"))}</small>` : ""}
                    </form>

                    <section class="lbc-settings-panel">
                        <div class="lbc-settings-panel-heading"><div><span>ACCOUNT SECURITY</span><p>Change the password for your signed-in administrator account.</p></div></div>
                        <form data-admin-password-form class="lbc-settings-password-form">
                            <label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
                            <label>Confirm new password<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></label>
                            <label data-admin-reauth-field hidden>Email verification code<input name="nonce" inputmode="numeric" autocomplete="one-time-code"></label>
                            <p class="lbc-settings-message" data-password-message role="status" aria-live="polite"></p>
                            <button type="submit" class="button button-primary">Update password</button>
                        </form>
                        <div class="lbc-settings-signout"><div><strong>Secure sign-out</strong><p>End this administrator session on this device.</p></div><button type="button" class="button button-secondary" data-settings-signout>Sign out</button></div>
                    </section>
                </section>`;

            const settingsForm = container.querySelector("[data-company-settings]");
            if (editable) settingsForm?.addEventListener("submit", event => saveSettings(event, settingsForm));
            container.querySelector("[data-admin-password-form]")?.addEventListener("submit", savePassword);
            container.querySelector("[data-settings-signout]")?.addEventListener("click", () => {
                document.querySelector(".logout-button")?.click();
            });
        } catch (error) {
            container.innerHTML = `<section class="section lbc-settings"><p class="section-eyebrow">ADMINISTRATION</p><h2>Settings</h2><p class="lbc-settings-error" role="alert">${esc(error?.message || "Saved settings could not be loaded.")}</p></section>`;
        }
    }

    async function saveSettings(event, form) {
        event.preventDefault();
        if (!canManage()) return;
        const button = form.querySelector('[type="submit"]');
        const message = form.querySelector("[data-settings-message]");
        const values = new FormData(form);
        const payload = {
            p_consultancy_name: String(values.get("consultancy_name") || "").trim(),
            p_company_logo_url: String(values.get("company_logo_url") || "").trim(),
            p_official_email: String(values.get("official_email") || "").trim(),
            p_telephone: String(values.get("telephone") || "").trim(),
            p_whatsapp: String(values.get("whatsapp") || "").trim(),
            p_business_address: String(values.get("business_address") || "").trim(),
            p_official_website: String(values.get("official_website") || "").trim(),
            p_business_contact_details: String(values.get("business_contact_details") || "").trim(),
            p_default_appointment_timezone: String(values.get("default_appointment_timezone") || "")
        };
        button.disabled = true;
        message.textContent = "Saving settings…";
        try {
            const { data, error } = await lordblessSupabase.rpc("update_company_settings", payload);
            if (error) throw error;
            window.LORDBLESS_DEFAULT_APPOINTMENT_TIMEZONE = data?.default_appointment_timezone || payload.p_default_appointment_timezone;
            message.textContent = "Company settings saved.";
            const updated = form.parentElement.querySelector(".lbc-settings-updated");
            if (updated) updated.textContent = `Last saved ${new Date(data?.updated_at || Date.now()).toLocaleString("en-GB")}`;
        } catch (error) {
            message.textContent = error?.message || "Settings could not be saved.";
        } finally {
            button.disabled = false;
        }
    }

    async function savePassword(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const message = form.querySelector("[data-password-message]");
        const button = form.querySelector('[type="submit"]');
        const password = form.elements.password.value;
        const confirmation = form.elements.confirm_password.value;
        const nonce = form.elements.nonce.value.trim();
        if (password.length < 8) { message.textContent = "Use a password with at least 8 characters."; return; }
        if (password !== confirmation) { message.textContent = "The password confirmation does not match."; return; }

        button.disabled = true;
        message.textContent = "Updating password securely…";
        try {
            const attributes = { password };
            if (nonce) attributes.nonce = nonce;
            const { error } = await lordblessSupabase.auth.updateUser(attributes);
            if (error?.code === "reauthentication_needed" && !nonce) {
                const { error: reauthError } = await lordblessSupabase.auth.reauthenticate();
                if (reauthError) throw reauthError;
                const nonceField = form.querySelector("[data-admin-reauth-field]");
                nonceField.hidden = false;
                form.elements.nonce.required = true;
                message.textContent = "A verification code was sent to your registered email. Enter it above, then submit again.";
                return;
            }
            if (error) throw error;
            form.reset();
            form.querySelector("[data-admin-reauth-field]").hidden = true;
            form.elements.nonce.required = false;
            message.textContent = "Administrator password updated.";
        } catch (error) {
            message.textContent = error?.message || "Password could not be updated.";
        } finally {
            button.disabled = false;
        }
    }

    window.LORDBLESS_ADMIN_SETTINGS = Object.freeze({ render, loadAppointmentTimezoneDefault });
})();
