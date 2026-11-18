/**
 * Generic document data access and SOP presentation adapter.
 * Storage contract: documents / document_revisions.
 * Presentation contract: legacy SOP-shaped objects consumed by the current SOP UI.
 */
window.DocumentData = (() => {
    const DOCUMENT_TYPE = "sop";
    const DOCUMENT_SELECT = `
        id,
        document_type_code,
        document_number,
        document_code,
        workshop_id,
        created_by,
        created_at,
        updated_at,
        metadata,
        workshops!documents_workshop_id_fkey(name),
        document_revisions!document_revisions_document_id_fkey(
            id,
            document_id,
            revision_number,
            revision_code,
            status,
            description,
            created_by,
            created_at,
            released_at,
            metadata
        )
    `;

    const uniqueValues = values => [...new Set((values || []).filter(value => value !== null && value !== undefined && String(value).trim() !== "").map(String))];

    async function enrichSopDocuments(rows = []) {
        if (!rows.length) return [];
        const metadataOf = row => row.metadata || {};
        const processNames = uniqueValues(rows.map(row => metadataOf(row).process_area));
        const modelNames = uniqueValues(rows.map(row => metadataOf(row).model));
        const partNames = uniqueValues(rows.map(row => metadataOf(row).part_name));

        const [areasResult, modelsResult, partsByNameResult, partsByCodeResult, partsByValueResult] = await Promise.all([
            processNames.length ? supabaseClient.from("process_areas").select("id,name,code").in("name", processNames) : Promise.resolve({data: [], error: null}),
            modelNames.length ? supabaseClient.from("models").select("id,size_model,model_series").in("size_model", modelNames) : Promise.resolve({data: [], error: null}),
            partNames.length ? supabaseClient.from("part_names").select("id,name,code,part_name").in("name", partNames) : Promise.resolve({data: [], error: null}),
            partNames.length ? supabaseClient.from("part_names").select("id,name,code,part_name").in("code", partNames) : Promise.resolve({data: [], error: null}),
            partNames.length ? supabaseClient.from("part_names").select("id,name,code,part_name").in("part_name", partNames) : Promise.resolve({data: [], error: null})
        ]);
        for (const result of [areasResult, modelsResult, partsByNameResult, partsByCodeResult, partsByValueResult]) {
            if (result.error) throw result.error;
        }

        const seriesNames = uniqueValues((modelsResult.data || []).map(row => row.model_series));
        const seriesResult = seriesNames.length
            ? await supabaseClient.from("model_series").select("id,name,char").in("name", seriesNames)
            : {data: [], error: null};
        if (seriesResult.error) throw seriesResult.error;

        const areaMap = new Map((areasResult.data || []).map(row => [String(row.name), row]));
        const modelMap = new Map((modelsResult.data || []).map(row => [String(row.size_model), row]));
        const seriesMap = new Map((seriesResult.data || []).map(row => [String(row.name), row]));
        const partMap = new Map();
        [...(partsByNameResult.data || []), ...(partsByCodeResult.data || []), ...(partsByValueResult.data || [])].forEach(row => {
            partMap.set(String(row.name), row);
            partMap.set(String(row.code), row);
            partMap.set(String(row.part_name), row);
        });

        return rows.map(row => {
            const metadata = metadataOf(row);
            const workshopName = row.workshops?.name || metadata.workshop || "";
            const processArea = metadata.process_area || "";
            const modelName = metadata.model || "";
            const partName = metadata.part_name || "";
            const model = modelMap.get(String(modelName));
            const part = partMap.get(String(partName));
            const revisions = (row.document_revisions || []).map(revision => ({
                ...revision,
                sop_id: revision.document_id,
                sop_code: row.document_code,
                original_revision: revision.metadata?.original_revision || null,
                document_name: revision.metadata?.document_name || null,
                drive_file_id: revision.metadata?.drive_file_id || null,
                drive_url: revision.metadata?.drive_url || null
            }));
            return {
                id: row.id,
                sop_id: row.id,
                sop_number: row.document_number,
                sop_code: row.document_code,
                workshop: workshopName,
                workshop_id: row.workshop_id,
                process_area: processArea,
                model: modelName,
                part_name: partName,
                part_number: metadata.part_number || "",
                operation_name: metadata.operation_name || "",
                source_type: metadata.source_type || null,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
                workshops: {name: workshopName},
                process_areas: areaMap.get(String(processArea)) || {name: processArea, code: ""},
                models: model ? {
                    id: model.id,
                    size_model: model.size_model,
                    model_series: {
                        name: model.model_series,
                        char: seriesMap.get(String(model.model_series))?.char || ""
                    }
                } : {size_model: modelName, model_series: {name: ""}},
                part_names: part || {name: partName, code: partName},
                sop_revisions: revisions
            };
        });
    }

    async function getSopDocuments({ids = null, id = null} = {}) {
        let query = supabaseClient.from("documents").select(DOCUMENT_SELECT).eq("document_type_code", DOCUMENT_TYPE).order("created_at", {ascending: false});
        if (id !== null) query = query.eq("id", id).single();
        else if (Array.isArray(ids) && ids.length) query = query.in("id", ids);
        else if (Array.isArray(ids) && !ids.length) return {data: [], error: null};

        const {data, error} = await query;
        if (error) return {data: null, error};
        try {
            const hydrated = await enrichSopDocuments(id !== null ? [data] : (data || []));
            return {data: id !== null ? hydrated[0] || null : hydrated, error: null};
        } catch (enrichmentError) {
            return {data: null, error: enrichmentError};
        }
    }

    async function getSopRevisionsByIds(ids = []) {
        if (!ids.length) return {data: [], error: null};
        const {data, error} = await supabaseClient.from("document_revisions")
            .select("id,document_id,revision_number,revision_code,status,description,created_by,created_at,released_at,metadata")
            .in("id", ids);
        if (error) return {data: null, error};
        return {
            data: (data || []).map(row => ({
                ...row,
                sop_id: row.document_id,
                original_revision: row.metadata?.original_revision || null,
                document_name: row.metadata?.document_name || null,
                drive_file_id: row.metadata?.drive_file_id || null,
                drive_url: row.metadata?.drive_url || null
            })),
            error: null
        };
    }

    async function getSopRevisionByCode(documentId, revisionCode) {
        const {data, error} = await supabaseClient.from("document_revisions")
            .select("id,document_id,revision_number,revision_code,status,description,created_by,created_at,released_at,metadata")
            .eq("document_id", documentId)
            .eq("revision_code", revisionCode)
            .single();
        if (error) return {data: null, error};
        return {
            data: {
                ...data,
                sop_id: data.document_id,
                original_revision: data.metadata?.original_revision || null,
                document_name: data.metadata?.document_name || null,
                drive_file_id: data.metadata?.drive_file_id || null,
                drive_url: data.metadata?.drive_url || null
            },
            error: null
        };
    }

    async function getMySopDrafts(userId) {
        const {data, error} = await getSopDocuments();
        if (error) return {data: null, error};
        const drafts = [];
        (data || []).forEach(doc => (doc.sop_revisions || []).forEach(revision => {
            if (String(revision.created_by || "") === String(userId) && String(revision.status || "").toLowerCase() === "draft") {
                drafts.push({doc, revision});
            }
        }));
        drafts.sort((a, b) => new Date(b.revision.created_at || 0) - new Date(a.revision.created_at || 0));
        return {data: drafts, error: null};
    }

    return {getSopDocuments, getSopRevisionsByIds, getSopRevisionByCode, getMySopDrafts};
})();
