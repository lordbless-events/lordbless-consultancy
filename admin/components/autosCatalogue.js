/* LORDBLESS AUTOS catalogue administration. Access is also enforced by database RLS. */
window.LORDBLESS_AUTOS_ADMIN = (() => {
    const BUCKET = "lordbless-autos-catalogue";
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    const REVERIFY_FIELDS = [
        "make", "model", "year", "mileage_km", "condition", "fuel_type",
        "transmission", "drivetrain", "engine", "description",
        "supplier_name", "supplier_vehicle_id", "supplier_listing_url"
    ];
    let root;
    let vehicles = [];
    let activeVehicle = null;
    let photos = [];
    let notice = "";
    let error = "";
    let busy = false;

    async function render(container) {
        root = container;
        root.innerHTML = '<section class="section"><p>Loading AUTOS catalogue…</p></section>';
        if (typeof lordblessSupabase === "undefined") {
            root.innerHTML = '<section class="section"><p role="alert">The Supabase client is unavailable. No local/mock catalogue is shown.</p></section>';
            return;
        }
        await loadData();
        renderWorkspace();
    }

    async function loadData() {
        error = "";
        const { data, error: queryError } = await lordblessSupabase
            .from("autos_vehicles")
            .select("*")
            .order("reference", { ascending: true });
        if (queryError) {
            vehicles = [];
            error = `Catalogue records could not be loaded: ${queryError.message}`;
            return;
        }
        vehicles = data || [];
        if (activeVehicle) {
            activeVehicle = vehicles.find(vehicle => vehicle.id === activeVehicle.id) || null;
            await loadPhotos();
        }
    }

    async function loadPhotos() {
        photos = [];
        if (!activeVehicle) return;
        const { data, error: photoError } = await lordblessSupabase
            .from("autos_vehicle_photos")
            .select("*")
            .eq("vehicle_id", activeVehicle.id)
            .order("sort_order", { ascending: true });
        if (photoError) {
            error = `Vehicle photos could not be loaded: ${photoError.message}`;
            return;
        }
        photos = await Promise.all((data || []).map(async photo => {
            const { data: signed, error: signError } = await lordblessSupabase.storage.from(BUCKET).createSignedUrl(photo.storage_path, 3600);
            return { ...photo, signedUrl: signError ? "" : signed?.signedUrl || "" };
        }));
    }

    function renderWorkspace() {
        const selected = activeVehicle || {};
        const escape = escapeHTML;
        const supplierUrl = safeSupplierUrl(activeVehicle?.supplier_listing_url);
        const opt = (value, label, current) => `<option value="${escape(value)}" ${current === value ? "selected" : ""}>${escape(label)}</option>`;
        root.innerHTML = `<section class="section autos-admin">
            <div class="section-header"><div><h2>LORDBLESS AUTOS Catalogue</h2><p class="section-subtitle">Draft, verify and publish catalogue records. Public visitors see only verified, published vehicles.</p></div><button type="button" class="primary-button" data-autos-new>New draft</button></div>
            ${error ? `<p class="autos-admin-alert is-error" role="alert">${escape(error)}</p>` : ""}
            ${notice ? `<p class="autos-admin-alert" role="status">${escape(notice)}</p>` : ""}
            <div class="autos-admin-layout">
                <aside class="autos-admin-records"><h3>Vehicle records (${vehicles.length})</h3>${vehicles.length ? vehicles.map(vehicle => `<article class="autos-admin-record ${vehicle.id === activeVehicle?.id ? "is-selected" : ""}"><button type="button" data-autos-edit="${escape(vehicle.id)}"><strong>${escape(vehicle.reference)}</strong><span>${escape([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Details pending")}</span><small>${escape(vehicle.status)} · ${escape(vehicle.verification_status)}</small></button></article>`).join("") : `<p>No catalogue records are stored yet. Create assigned LBC-CAR references as drafts; do not reuse or invent an assigned reference.</p>`}</aside>
                <div class="autos-admin-editor">
                    <form id="autos-admin-vehicle-form">
                        <div class="autos-admin-form-heading"><h3>${activeVehicle ? `Edit ${escape(activeVehicle.reference)}` : "Create a vehicle draft"}</h3><p>Confirm supplier details before setting verification to verified or publishing.</p>${activeVehicle?.verified_at ? `<p class="autos-admin-verification-meta">Last verified: ${escape(new Date(activeVehicle.verified_at).toLocaleString())}</p>` : ""}</div>
                        <div class="autos-admin-fields">
                            <label>LORDBLESS reference<input name="reference" required pattern="LBC-CAR-[0-9]{4}" maxlength="12" placeholder="LBC-CAR-0001" value="${escape(selected.reference || "")}" ${activeVehicle ? "readonly" : ""}></label>
                            <label>Make<input name="make" maxlength="80" value="${escape(selected.make || "")}"></label>
                            <label>Model / variant<input name="model" maxlength="160" value="${escape(selected.model || "")}"></label>
                            <label>Year<input name="year" type="number" min="2016" max="2100" value="${escape(selected.year || "")}"></label>
                            <label>Mileage (km)<input name="mileage_km" type="number" min="0" value="${escape(selected.mileage_km ?? "")}"></label>
                            <label>Body type<input name="body_type" maxlength="60" value="${escape(selected.body_type || "")}"></label>
                            <label>Condition<input name="condition" maxlength="60" value="${escape(selected.condition || "")}"></label>
                            <label>Fuel / powertrain<input name="fuel_type" maxlength="60" value="${escape(selected.fuel_type || "")}"></label>
                            <label>Transmission<input name="transmission" maxlength="60" value="${escape(selected.transmission || "")}"></label>
                            <label>Drivetrain<input name="drivetrain" maxlength="60" value="${escape(selected.drivetrain || "")}"></label>
                            <label>Engine<input name="engine" maxlength="60" value="${escape(selected.engine || "")}"></label>
                            <label>Supplier name<input name="supplier_name" maxlength="160" value="${escape(selected.supplier_name || "CBBase")}"></label>
                            <label>Supplier / source ID<input name="supplier_vehicle_id" maxlength="120" value="${escape(selected.supplier_vehicle_id || "")}"></label>
                            <label>Supplier listing URL<input name="supplier_listing_url" type="url" maxlength="1000" value="${escape(selected.supplier_listing_url || "")}"></label>
                            <label>Verification status<select name="verification_status">${opt("pending", "Pending confirmation", selected.verification_status || "pending")}${opt("verified", "Verified", selected.verification_status)}${opt("conflict", "Conflict — keep draft", selected.verification_status)}</select></label>
                            <label>Catalogue status<select name="status">${opt("draft", "Draft", selected.status || "draft")}${opt("published", "Published", selected.status)}${opt("unavailable", "Unavailable", selected.status)}</select></label>
                            <label class="autos-admin-wide">Verification notes<textarea name="verification_notes" rows="3" maxlength="4000">${escape(selected.verification_notes || "")}</textarea></label>
                            <label class="autos-admin-wide">Public description<textarea name="description" rows="3" maxlength="2000">${escape(selected.description || "")}</textarea></label>
                        </div>
                        <div class="autos-admin-actions"><button type="submit" class="primary-button" ${busy ? "disabled" : ""}>Save vehicle</button>${activeVehicle ? `${supplierUrl ? `<a href="${escape(supplierUrl)}" target="_blank" rel="noopener noreferrer">Open supplier listing</a>` : ""}<button type="button" class="secondary-button" data-autos-preview>Preview public listing</button>` : ""}</div>
                    </form>
                    ${activeVehicle ? renderPhotoManager(escape) : `<p class="autos-admin-photo-note">Save the draft before adding photographs. Add only photographs matched to this exact vehicle. The multi-file upload is the dependable fallback; CBBase images are not hotlinked.</p>`}
                </div>
            </div>
        </section>`;
        bindWorkspaceEvents();
    }

    function renderPhotoManager(escape) {
        const supplierUrl = safeSupplierUrl(activeVehicle.supplier_listing_url);
        const source = supplierUrl ? `<a href="${escape(supplierUrl)}" target="_blank" rel="noopener noreferrer">Open the recorded supplier listing to verify the vehicle and select its photographs.</a>` : "Record an HTTPS supplier listing URL before matching supplier photographs.";
        return `<section class="autos-admin-photos"><h3>Vehicle photo gallery</h3><p>${source} Upload the selected image files below to the dedicated private LORDBLESS AUTOS bucket.</p>
            <label class="autos-admin-upload">Add multiple photographs<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple data-autos-upload ${busy ? "disabled" : ""}></label>
            <div class="autos-admin-photo-grid">${photos.map((photo, index) => `<article class="autos-admin-photo">${photo.signedUrl ? `<img src="${escape(photo.signedUrl)}" alt="${escape(activeVehicle.reference)} photograph ${index + 1}">` : `<div class="autos-photo-unavailable">Preview unavailable</div>`}<p>${photo.is_cover ? "Cover photo" : `Gallery photo ${index + 1}`}</p><div><button type="button" data-photo-cover="${escape(photo.id)}" ${photo.is_cover ? "disabled" : ""}>Set cover</button><button type="button" data-photo-up="${escape(photo.id)}" ${index === 0 ? "disabled" : ""} aria-label="Move photo earlier">↑</button><button type="button" data-photo-down="${escape(photo.id)}" ${index === photos.length - 1 ? "disabled" : ""} aria-label="Move photo later">↓</button><button type="button" data-photo-delete="${escape(photo.id)}">Remove</button></div></article>`).join("")}</div>
            <div class="autos-admin-preview" data-autos-preview-panel hidden><h4>Public preview</h4><p>${escape([activeVehicle.year, activeVehicle.make, activeVehicle.model].filter(Boolean).join(" "))}</p><p>${escape(activeVehicle.reference)} · ${escape(activeVehicle.body_type || "")} · ${escape(activeVehicle.fuel_type || "")}</p><p>No public price shown. Draft/conflict records remain off the public catalogue.</p>${photos.filter(photo => photo.is_cover && photo.signedUrl).map(photo => `<img src="${escape(photo.signedUrl)}" alt="Cover preview">`).join("")}</div>
        </section>`;
    }

    function bindWorkspaceEvents() {
        root.querySelector("[data-autos-new]")?.addEventListener("click", () => { activeVehicle = null; photos = []; notice = ""; error = ""; renderWorkspace(); });
        root.querySelectorAll("[data-autos-edit]").forEach(button => button.addEventListener("click", async () => {
            activeVehicle = vehicles.find(vehicle => vehicle.id === button.dataset.autosEdit) || null;
            notice = "";
            await loadPhotos();
            renderWorkspace();
        }));
        root.querySelector("#autos-admin-vehicle-form")?.addEventListener("submit", saveVehicle);
        root.querySelector("[data-autos-upload]")?.addEventListener("change", uploadPhotos);
        root.querySelector("[data-autos-preview]")?.addEventListener("click", () => {
            const panel = root.querySelector("[data-autos-preview-panel]");
            if (panel) panel.hidden = !panel.hidden;
        });
        root.querySelectorAll("[data-photo-cover]").forEach(button => button.addEventListener("click", () => setCover(button.dataset.photoCover)));
        root.querySelectorAll("[data-photo-up]").forEach(button => button.addEventListener("click", () => movePhoto(button.dataset.photoUp, -1)));
        root.querySelectorAll("[data-photo-down]").forEach(button => button.addEventListener("click", () => movePhoto(button.dataset.photoDown, 1)));
        root.querySelectorAll("[data-photo-delete]").forEach(button => button.addEventListener("click", () => removePhoto(button.dataset.photoDelete)));
    }

    async function saveVehicle(event) {
        event.preventDefault();
        if (busy || !event.currentTarget.reportValidity()) return;
        const form = new FormData(event.currentTarget);
        const yearText = String(form.get("year") || "").trim();
        const mileageText = String(form.get("mileage_km") || "").trim();
        const payload = {
            reference: String(form.get("reference") || "").trim().toUpperCase(),
            make: String(form.get("make") || "").trim(),
            model: String(form.get("model") || "").trim(),
            year: yearText ? Number(yearText) : null,
            mileage_km: mileageText ? Number(mileageText) : null,
            body_type: blankToNull(form.get("body_type")), condition: blankToNull(form.get("condition")),
            fuel_type: blankToNull(form.get("fuel_type")), transmission: blankToNull(form.get("transmission")),
            drivetrain: blankToNull(form.get("drivetrain")), engine: blankToNull(form.get("engine")),
            supplier_name: String(form.get("supplier_name") || "CBBase").trim() || "CBBase",
            supplier_vehicle_id: blankToNull(form.get("supplier_vehicle_id")),
            supplier_listing_url: blankToNull(form.get("supplier_listing_url")),
            verification_status: String(form.get("verification_status") || "pending"),
            verification_notes: blankToNull(form.get("verification_notes")),
            description: blankToNull(form.get("description")),
            status: String(form.get("status") || "draft")
        };
        const needsReverification = Boolean(activeVehicle) && REVERIFY_FIELDS.some(field =>
            normalizeReviewValue(field, activeVehicle[field]) !== normalizeReviewValue(field, payload[field])
        );
        if (needsReverification) {
            payload.status = "draft";
            payload.verification_status = "pending";
        }
        setBusy(true);
        const query = activeVehicle
            ? lordblessSupabase.from("autos_vehicles").update(payload).eq("id", activeVehicle.id).select("*").single()
            : lordblessSupabase.from("autos_vehicles").insert(payload).select("*").single();
        const { data, error: saveError } = await query;
        setBusy(false);
        if (saveError) {
            error = `Vehicle was not saved: ${saveError.message}`;
            renderWorkspace();
            return;
        }
        activeVehicle = data;
        notice = needsReverification
            ? `${data.reference} saved as draft and marked pending verification because its details or supplier information changed.`
            : `${data.reference} saved as ${data.status}.`;
        await loadData();
        renderWorkspace();
    }

    async function uploadPhotos(event) {
        const files = Array.from(event.currentTarget.files || []);
        event.currentTarget.value = "";
        const uploadVehicle = activeVehicle;
        let nextOrder = photos.length;
        if (!uploadVehicle || !files.length || busy) return;
        if (files.some(file => !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
            error = "Choose JPEG, PNG, WebP or AVIF image files no larger than 15 MB each.";
            renderWorkspace();
            return;
        }
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(uploadVehicle.id)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        error = "";
        for (const file of files) {
            const path = `${uploadVehicle.id}/${crypto.randomUUID()}.${file.name.split(".").pop().toLowerCase()}`;
            const { error: uploadError } = await lordblessSupabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
            if (uploadError) { error = `Photo upload failed: ${uploadError.message}`; break; }
            const { error: rowError } = await lordblessSupabase.from("autos_vehicle_photos").insert({ vehicle_id: uploadVehicle.id, storage_path: path, sort_order: nextOrder, is_cover: nextOrder === 0 });
            if (rowError) {
                await lordblessSupabase.storage.from(BUCKET).remove([path]);
                error = `Photo metadata could not be saved: ${rowError.message}`;
                break;
            }
            nextOrder += 1;
        }
        setBusy(false);
        if (!error) notice = "Photos uploaded. The vehicle is a draft pending re-verification.";
        await loadPhotos();
        renderWorkspace();
    }

    async function setCover(photoId) {
        if (busy || !activeVehicle) return;
        const vehicleId = activeVehicle.id;
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(vehicleId)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        let result = await lordblessSupabase.from("autos_vehicle_photos").update({ is_cover: false }).eq("vehicle_id", vehicleId);
        if (!result.error) result = await lordblessSupabase.from("autos_vehicle_photos").update({ is_cover: true }).eq("id", photoId).eq("vehicle_id", vehicleId);
        setBusy(false);
        error = result.error ? `Cover photo could not be changed: ${result.error.message}` : "";
        notice = error ? "" : "Cover photo updated. The vehicle is a draft pending re-verification.";
        await loadPhotos(); renderWorkspace();
    }

    async function movePhoto(photoId, direction) {
        const index = photos.findIndex(photo => photo.id === photoId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= photos.length || busy) return;
        const vehicleId = activeVehicle?.id;
        const order = [...photos];
        if (!vehicleId) return;
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(vehicleId)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        [order[index], order[target]] = [order[target], order[index]];
        for (let position = 0; position < order.length; position += 1) {
            const { error: orderError } = await lordblessSupabase.from("autos_vehicle_photos").update({ sort_order: position }).eq("id", order[position].id);
            if (orderError) { error = `Photo order could not be saved: ${orderError.message}`; break; }
        }
        setBusy(false);
        if (!error) notice = "Photo order changed. The vehicle is a draft pending re-verification.";
        await loadPhotos(); renderWorkspace();
    }

    async function removePhoto(photoId) {
        const photo = photos.find(item => item.id === photoId);
        if (!photo || busy || !window.confirm("Remove this vehicle photo from the catalogue?")) return;
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(photo.vehicle_id)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        const { error: rowError } = await lordblessSupabase.from("autos_vehicle_photos").delete().eq("id", photoId);
        if (!rowError) {
            const { error: storageError } = await lordblessSupabase.storage.from(BUCKET).remove([photo.storage_path]);
            error = storageError ? `Photo metadata was removed, but its stored file could not be removed: ${storageError.message}` : "";
        } else error = `Photo record could not be removed: ${rowError.message}`;
        setBusy(false);
        if (!error) notice = "Photo removed. The vehicle is a draft pending re-verification.";
        await loadPhotos(); renderWorkspace();
    }

    async function markDraftPendingBeforeCatalogueChange(vehicleId) {
        const { data, error: updateError } = await lordblessSupabase
            .from("autos_vehicles")
            .update({ status: "draft", verification_status: "pending" })
            .eq("id", vehicleId)
            .select("id")
            .single();
        if (updateError || !data) {
            error = `The vehicle could not be moved to draft pending verification: ${updateError?.message || "record not found"}`;
            return false;
        }

        vehicles = vehicles.map(vehicle => vehicle.id === vehicleId
            ? { ...vehicle, status: "draft", verification_status: "pending" }
            : vehicle
        );
        if (activeVehicle?.id === vehicleId) {
            activeVehicle = { ...activeVehicle, status: "draft", verification_status: "pending" };
        }
        error = "";
        notice = `${vehicles.find(vehicle => vehicle.id === vehicleId)?.reference || "Vehicle"} moved to draft pending re-verification.`;
        return true;
    }

    function normalizeReviewValue(field, value) {
        if (field === "year" || field === "mileage_km") {
            return value === null || value === undefined || value === "" ? null : Number(value);
        }
        return String(value ?? "").trim();
    }

    function safeSupplierUrl(value) {
        try {
            const parsed = new URL(String(value || ""));
            return parsed.protocol === "https:" ? parsed.href : "";
        } catch {
            return "";
        }
    }
    function setBusy(value) { busy = value; }
    function blankToNull(value) { const text = String(value || "").trim(); return text || null; }
    function escapeHTML(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

    return { render };
})();
