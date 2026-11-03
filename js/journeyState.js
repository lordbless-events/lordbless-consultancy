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
        ["completed", "Completed"]
    ];
    const stageLabels = Object.freeze(Object.fromEntries(stages));
    const operationalStatusLabels = Object.freeze(Object.fromEntries(operationalStatuses));

    function normalize(value, options, fallback) {
        const candidate = String(value || "").trim().toLowerCase().replaceAll(" ", "_");
        return options.some(([key]) => key === candidate) ? candidate : fallback;
    }

    window.LORDBLESS_JOURNEY_STATE = Object.freeze({
        stages: Object.freeze(stages.map(([value, label]) => Object.freeze({ value, label }))),
        operationalStatuses: Object.freeze(operationalStatuses.map(([value, label]) => Object.freeze({ value, label }))),
        normalizeStage: value => normalize(value, stages, "enquiry"),
        stageLabel: value => stageLabels[normalize(value, stages, "enquiry")],
        normalizeOperationalStatus: value => normalize(value, operationalStatuses, "active"),
        operationalStatusLabel: value => operationalStatusLabels[normalize(value, operationalStatuses, "active")]
    });
})();
