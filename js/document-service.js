/**
 * Generic access layer for the shared documents data model.
 * SOP-specific fields and enrichment belong in SopDocumentAdapter.
 */
window.DocumentService = (() => {
    const ensureClient = () => {
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            throw new Error("Supabase client is not initialized.");
        }
        return supabaseClient;
    };

    const emptyResult = () => ({data: [], error: null});

    async function listDocuments({
        documentTypeCode,
        id,
        ids,
        select = "*",
        orderBy = "created_at",
        ascending = false
    } = {}) {
        let query = ensureClient().from("documents").select(select);

        if (documentTypeCode) {
            query = query.eq("document_type_code", documentTypeCode);
        }
        if (orderBy) {
            query = query.order(orderBy, {ascending});
        }
        if (id !== null && id !== undefined) {
            return query.eq("id", id).single();
        }
        if (Array.isArray(ids)) {
            if (!ids.length) return emptyResult();
            query = query.in("id", ids);
        }
        return query;
    }

    async function listRevisions({
        ids,
        documentId,
        revisionCode,
        select = "*",
        orderBy = null,
        ascending = true,
        single = false
    } = {}) {
        let query = ensureClient().from("document_revisions").select(select);

        if (documentId !== undefined && documentId !== null) {
            query = query.eq("document_id", documentId);
        }
        if (revisionCode !== undefined && revisionCode !== null) {
            query = query.eq("revision_code", revisionCode);
        }
        if (Array.isArray(ids)) {
            if (!ids.length) return emptyResult();
            query = query.in("id", ids);
        }
        if (orderBy) {
            query = query.order(orderBy, {ascending});
        }
        return single ? query.single() : query;
    }

    return Object.freeze({listDocuments, listRevisions});
})();
