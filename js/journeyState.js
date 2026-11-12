(function () {
    const stages = [
        ["enquiry", "Enquiry"],
        ["assessment", "Assessment"],
        ["planning", "Planning"],
        ["preparation", "Preparation"],
        ["applications_approvals", "Applications and Approvals"],
        ["visa_processing", "Visa Processing"],
        ["travel", "Travel"],
        ["arrival", "Arrival"],
        ["completed", "Completed"]
    ];
    const operationalStatuses = [
        ["active", "Active"],
        ["on_hold", "On Hold"],
        ["completed", "Completed"],
        ["cancelled", "Cancelled"],
        ["unsuccessful", "Unsuccessful"]
    ];
    const autosStages = [
        ["enquiry_received", "Enquiry Received"],
        ["enquiry_reviewed", "Enquiry Reviewed"],
        ["availability_confirmation", "Vehicle Availability Confirmation"],
        ["quotation_preparation", "Quotation Preparation"],
        ["quotation_sent", "Quotation Sent"],
        ["awaiting_customer_decision", "Awaiting Customer Decision"],
        ["order_confirmed", "Order Confirmed"],
        ["payment_processing", "Payment Processing"],
        ["vehicle_sourcing", "Vehicle Sourcing"],
        ["inspection_documentation", "Inspection and Documentation"],
        ["shipping_preparation", "Shipping Preparation"],
        ["in_transit", "In Transit"],
        ["arrived_in_ghana", "Arrived in Ghana"],
        ["customs_clearing", "Customs and Clearing"],
        ["delivery_arrangements", "Delivery Arrangements"],
        ["delivered", "Delivered"],
        ["autos_completed", "Completed"]
    ];
    const allStages = [...stages, ...autosStages];
    const stageLabels = Object.freeze(Object.fromEntries(allStages));
    const operationalStatusLabels = Object.freeze(Object.fromEntries(operationalStatuses));

    function normalize(value, options, fallback) {
        const candidate = String(value || "").trim().toLowerCase().replaceAll(" ", "_");
        return options.some(([key]) => key === candidate) ? candidate : fallback;
    }

    window.LORDBLESS_JOURNEY_STATE = Object.freeze({
        stages: Object.freeze(stages.map(([value, label]) => Object.freeze({ value, label }))),
        autosStages: Object.freeze(autosStages.map(([value, label]) => Object.freeze({ value, label }))),
        operationalStatuses: Object.freeze(operationalStatuses.map(([value, label]) => Object.freeze({ value, label }))),
        stagesForJourney: journey => {
            const identity = [journey?.service, journey?.journeyType, journey?.title, journey?.businessType]
                .filter(Boolean).join(" ").toLowerCase();
            return identity.includes("autos") || identity.includes("vehicle sourcing")
                ? autosStages.map(([value, label]) => ({ value, label }))
                : stages.map(([value, label]) => ({ value, label }));
        },
        normalizeStage: value => normalize(value, allStages, "enquiry"),
        stageLabel: value => stageLabels[normalize(value, allStages, "enquiry")],
        normalizeOperationalStatus: value => normalize(value, operationalStatuses, "active"),
        operationalStatusLabel: value => operationalStatusLabels[normalize(value, operationalStatuses, "active")]
    });
})();
