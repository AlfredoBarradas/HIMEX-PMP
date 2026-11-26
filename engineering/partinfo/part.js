async function loadPartIndex() {
    const tableBody = document.getElementById("index-body-pn");
    tableBody.innerHTML = `<tr><td colspan="11">Loading...</td></tr>`;
    
    const { data, error } = await supabaseClient
        .from("part_numbers")
        .select(`
            id,
            models(size_model),
            part_number,
            part_names(part_name),
            description,
            workshops!part_numbers_workshop_fkey(name),
            status!part_numbers_status_fkey(status),
            structure,
            size,
            model_series,
            uph,
            headcount,
            Active
        `).eq("Active", true)
        .order("part_number");
        
    if (error) { 
        console.error("Error loading partnumber catalog:", error); 
        tableBody.innerHTML = 
            `<tr>
                <td colspan="11">Error loading Part Number catalog.</td>
            </tr>
        `; 
        return; 
    }
    if (!data || data.length === 0) { 
        tableBody.innerHTML = 
            `<tr>
                <td colspan="11">No Part Numbers found.</td>
            </tr>
        `; 
        // populateSopCatalogFilters(); 
        return; 
    }
    renderPartIndex(data);
    // populateSopCatalogFilters();
    // applySopCatalogFilters();
    
}


// Index section
function renderPartIndex(parts) {
    const body = document.getElementById("index-body-pn"); 
    body.innerHTML = "";
    parts.forEach(part => {
        const row = document.createElement("tr"); 
        const part_model = part.models?.size_model ?? "";
        const part_num = part.part_number ?? "";
        const part_name = part.part_names?.part_name ?? "";
        const part_desc = part.description ?? "Undefined";
        const part_ws = part.workshops?.name ?? "";
        const part_status = part.status?.status ?? "Undefined";
        const part_structure = part.structure ?? "";
        const part_size = part.size ?? "Undefined";
        const part_series = part.model_series ?? "Undefined";
        const part_uph = part.uph ?? "Undefined";
        const part_hc = part.headcount ?? "Undefined";

        row.tabIndex = 0; 
        row.dataset.part_model = part_model;
        row.dataset.part_num = part_num;
        row.dataset.part_name = part_name;
        row.dataset.part_desc = part_desc;
        row.dataset.part_ws = part_ws;
        row.dataset.part_status = part_status;
        row.dataset.part_structure = part_structure;
        row.dataset.part_size = part_size;
        row.dataset.part_series = part_series;
        row.dataset.part_uph = part_uph;
        row.dataset.part_hc = part_hc;
        
        row.innerHTML = 
            `
            <td>${escapeHtml(part_model)}</td>
            <td>${escapeHtml(part_num)}</td>
            <td>${escapeHtml(part_name)}</td>
            <td>${escapeHtml(part_desc)}</td>
            <td>${escapeHtml(part_ws)}</td>
            <td>${escapeHtml(part_status)}</td>
            <td>${escapeHtml(part_structure)}</td>
            <td>${escapeHtml(part_size)}</td>
            <td>${escapeHtml(part_series)}</td>
            <td>${escapeHtml(part_uph)}</td>
            <td>${escapeHtml(part_hc)}</td>
        `;
        body.appendChild(row);
    });
}



// ============================================
// INITIALIZATION
// ============================================

async function initializePartInfoPage() {
    const authData = await requireAuth();

    if (!authData?.user) {
        window.location.replace("/auth/");
        console.log("test de partinfo")
        return;
    }

    // ==== Add functions here ====

    loadPartIndex()

    // ============================

    document.body.classList.remove("auth-pending");
}

(async () => {
    await initializePartInfoPage();
})();