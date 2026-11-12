/* =========================================================
   LORDBLESS CONSULTANCY
   ACCESS CONTROL ENGINE
   ========================================================= */


/* ---------------------------------------------------------
   PERMISSION CHECK
   --------------------------------------------------------- */

function hasPermission(user, permission) {

    if (!user) {
        return false;
    }

    const permissions = Array.isArray(user.permissions)
        ? user.permissions
        : getUserPermissions(user);

    // AUTOS is restricted to Overall Admin and explicitly authorised China
    // Desk staff. Broad admin.all / wildcard grants must not bypass the desk
    // boundary for this permission.
    if (permission === "autos.manage") {
        if (user.isOverallAdmin === true || user.role === "super_admin") {
            return true;
        }
        const desks = Array.isArray(user.desks) ? user.desks : [];
        const hasChinaDesk = desks.some(desk =>
            String(typeof desk === "string" ? desk : desk?.code || "").toLowerCase() === "china"
        ) || (Array.isArray(user.deskIds) && user.deskIds.some(code => String(code).toLowerCase() === "china")) ||
            String(user.desk || "").toLowerCase() === "china";
        return hasChinaDesk && permissions.includes("autos.manage");
    }

    /* Super Admin */
    if (
        user.isOverallAdmin === true ||
        permissions.includes("*") ||
        permissions.includes("admin.all")
    ) {
        return true;
    }

    return permissions.includes(permission);
}


/* ---------------------------------------------------------
   DESK ACCESS
   --------------------------------------------------------- */

function canAccessDesk(user, deskId) {

    if (!user || !deskId) {
        return false;
    }

    /* Overall Admin */
    if (user.isOverallAdmin === true || user.role === "super_admin") {
        return true;
    }

    const assignedDesks = Array.isArray(user.deskIds)
        ? user.deskIds
        : [user.desk].filter(Boolean);

    return assignedDesks.includes(deskId);
}


/* ---------------------------------------------------------
   ENQUIRY DESK ACCESS
   --------------------------------------------------------- */

function canAccessEnquiry(user, enquiry) {

    if (!user || !enquiry) {
        return false;
    }

    /* Overall Admin */
    if (user.isOverallAdmin === true || user.role === "super_admin") {
        return true;
    }

    return Boolean(
        hasPermission(user, "enquiries.read") &&
        canAccessDesk(user, enquiry.desk || enquiry.deskId)
    );
}


/* ---------------------------------------------------------
   FILTER ENQUIRIES BY DESK
   --------------------------------------------------------- */

function getAccessibleEnquiries(user, enquiries) {

    if (!user || !Array.isArray(enquiries)) {
        return [];
    }

    /* Overall Admin sees everything */
    if (user.isOverallAdmin === true || user.role === "super_admin") {
        return enquiries;
    }

    if (!hasPermission(user, "enquiries.read")) {
        return [];
    }

    return enquiries.filter(
        enquiry => canAccessEnquiry(user, enquiry)
    );
}


/* ---------------------------------------------------------
   FINANCE ACCESS
   --------------------------------------------------------- */

function canAccessFinance(user) {

    if (!user) {
        return false;
    }

    return hasPermission(user, "finance.read");
}


/* ---------------------------------------------------------
   USER MANAGEMENT
   --------------------------------------------------------- */

function canManageUsers(user) {

    return hasPermission(
        user,
        "users.manage"
    );
}


/* ---------------------------------------------------------
   ACCESSIBLE DESKS
   --------------------------------------------------------- */

function getAccessibleDesks(user) {

    if (!user) {
        return [];
    }

    if (Array.isArray(user.desks)) {
        return user.desks;
    }

    /* Development fixture compatibility only. */
    if (user.isOverallAdmin === true || user.role === "super_admin") {
        return LORDBLESS_ACCESS_DATA.desks;
    }

    const desk = getDesk(user.desk);

    return desk ? [desk] : [];
}


/* ---------------------------------------------------------
   ROLE LABEL
   --------------------------------------------------------- */

function getRoleLabel(roleId) {

    const labels = {
        overall_admin: "Overall Admin",
        finance_manager: "Finance & Administration",
        desk_staff: "Desk Staff (legacy)",
        operations_client_services: "Operations & Client Services",
        documentation_admissions: "Documentation & Admissions"
    };

    if (labels[roleId]) {
        return labels[roleId];
    }

    const role = getRole(roleId);

    return role
        ? role.name
        : "Unknown Role";
}


/* ---------------------------------------------------------
   DESK LABEL
   --------------------------------------------------------- */

function getDeskLabel(deskId) {

    if (deskId === "all") {
        return "All Desks";
    }

    const desk = getDesk(deskId);

    return desk
        ? desk.name
        : "Unassigned";
}


/* ---------------------------------------------------------
   ACCESS SUMMARY
   --------------------------------------------------------- */

function getAccessSummary(user) {

    if (!user) {
        return {
            role: "Unknown",
            desk: "Unassigned",
            finance: false
        };
    }

    const deskSummary = Array.isArray(user.desks) && user.desks.length
        ? user.desks.map(desk => desk.name || desk.code).join(", ")
        : getDeskLabel(user.desk);

    return {
        role: getRoleLabel(user.role),
        desk: user.isOverallAdmin ? "All Desks" : deskSummary,
        finance: canAccessFinance(user)
    };
}
