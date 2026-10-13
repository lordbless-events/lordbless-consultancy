/* =========================================================
   LORDBLESS DATA CONNECTION
   Shared Admin + Client Supabase data layer
   ========================================================= */

async function getClientDocuments(clientId) {

    if (!clientId) {
        return [];
    }

    const { data, error } =
        await lordblessSupabase
            .from("client_documents")
            .select("*")
            .eq("client_id", clientId);

    if (error) {
        console.error(
            "LORDBLESS CLIENT DOCUMENTS ERROR:",
            error
        );

        throw error;
    }

    return (data || []).sort((left, right) =>
        new Date(right.uploaded_at || right.created_at || 0).getTime() -
        new Date(left.uploaded_at || left.created_at || 0).getTime()
    );
}


async function getTransactionRequirements(
    enquiryId
) {

    if (!enquiryId) {
        return [];
    }

    const { data, error } =
        await lordblessSupabase
            .from("enquiry_requirements")
            .select(`
                *,
                client_document:client_document_id (
                    *
                )
            `)
            .eq("enquiry_id", enquiryId)
            .order("created_at", {
                ascending: true
            });

    if (error) {
        console.error(
            "LORDBLESS REQUIREMENTS ERROR:",
            error
        );

        throw error;
    }

    return data || [];
}


async function getDocumentRequests(
    enquiryId
) {

    if (!enquiryId) {
        return [];
    }

    const { data, error } =
        await lordblessSupabase
            .from("document_requests")
            .select("*")
            .eq("enquiry_id", enquiryId)
            .order("created_at", {
                ascending: false
            });

    if (error) {
        console.error(
            "LORDBLESS DOCUMENT REQUESTS ERROR:",
            error
        );

        throw error;
    }

    return data || [];
}


async function getDocumentReviewHistory(
    documentId
) {

    if (!documentId) {
        return [];
    }

    const { data, error } =
        await lordblessSupabase
            .from("document_review_history")
            .select("*")
            .eq("document_id", documentId)
            .order("created_at", {
                ascending: false
            });

    if (error) {
        console.error(
            "LORDBLESS DOCUMENT HISTORY ERROR:",
            error
        );

        throw error;
    }

    return data || [];
}


window.LORDBLESS_DATA = {

    getClientDocuments,

    getTransactionRequirements,

    getDocumentRequests,

    getDocumentReviewHistory

};
