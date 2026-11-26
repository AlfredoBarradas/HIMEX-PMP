/**
 * SOP catalog UI: filtering, sorting, rendering and catalog data loading.
 * Document enrichment is delegated to SopDocumentAdapter.
 */
window.SopCatalog = (() => {
    let deps = {};

    function initialize(options) {
        deps = options || {};
        initializeSopCatalogFilters();
        initializeCatalogSorting();
    }

    // Filter section
    function initializeSopCatalogFilters() {
        document.getElementById("sop-search-box")?.addEventListener("input",applySopCatalogFilters);
        [
            "filter-area",
            "filter-process",
            "filter-series",
            "filter-model",
            "filter-part-name",
            "filter-created-by",
            "filter-status"
        ].forEach(id => document.getElementById(id)?.addEventListener("change", applySopCatalogFilters));
        document.getElementById("clear-sop-filters")?.addEventListener("click", () => {
            const search = document.getElementById("sop-search-box");
            if (search) {
                search.value="";
            }
            [
                "filter-area",
                "filter-process",
                "filter-series",
                "filter-model",
                "filter-part-name",
                "filter-created-by",
                "filter-status"
            ].forEach(id => {
                const select=document.getElementById(id);
                if(select){
                    select.value="";
                }
            });
            applySopCatalogFilters();
        });
        document.querySelectorAll("[data-table-search]").forEach(input => input.addEventListener("input", () => {
            const body = document.getElementById(input.dataset.tableSearch);
            const query = input.value.trim().toLowerCase();
            body?.querySelectorAll("tr").forEach(row => 
                row.hidden = Boolean(query) && 
                !row.textContent.toLowerCase().includes(query));
            }
        ));
        document.addEventListener("click",event => { 
            const row = event.target.closest("#sop-catalog-body .catalog-clickable-row");
            if (row && !event.target.closest("button, a, input, select, textarea, label")){
                deps.onViewSop(row.dataset.sopId);
            }
        });
        document.addEventListener("keydown",event => {
            const row = event.target.closest("#sop-catalog-body .catalog-clickable-row");
            if (row && (event.key === "Enter" || event.key === " ")){
                event.preventDefault();
                deps.onViewSop(row.dataset.sopId);
            }
        });
    }
    function initializeCatalogSorting() {
        document.querySelectorAll(".catalog-table table").forEach(table => table.querySelectorAll("thead th").forEach((header, index) => {
            header.title = "Sort by " + header.textContent.trim(); 
            header.setAttribute("aria-sort", "none");
            header.addEventListener("click", () => { 
                const body = table.tBodies[0]; 
                if (!body) {
                    return; 
                }
                const direction = header.dataset.sortDirection === "A-Z"? "Z-A": "A-Z"; 
                table.querySelectorAll("thead th").forEach(item => {
                    delete item.dataset.sortDirection;
                    item.setAttribute("aria-sort", "none");
                }); 
                header.dataset.sortDirection = direction;
                header.setAttribute("aria-sort", direction === "A-Z"? "ascending": "descending");
                const rows = [...body.rows].filter(row => row.cells.length > 1); 
                rows.sort((a, b) => {
                    const av = (a.cells[index]?.innerText || "").trim();
                    const bv = (b.cells[index]?.innerText || "").trim();
                    const ad = Date.parse(av),bd=Date.parse(bv);
                    const cmp = 
                        /date/i.test(header.textContent) && 
                        !Number.isNaN(ad) && 
                        !Number.isNaN(bd)? ad-bd
                        : av.localeCompare(bv, undefined, {
                            numeric: true, 
                            sensitivity: "base"
                        });
                    return direction === "A-Z"? cmp: -cmp;
                });
                rows.forEach(row => body.appendChild(row));
            });
        }));
    }
    function populateSopCatalogFilters() {
        const fields = [
            ["filter-area", "area", "All areas"],
            ["filter-process", "process", "All processes"],
            ["filter-series", "series", "All model series"],
            ["filter-model", "model", "All sizes"],
            ["filter-part-name", "partName", "All part names"],
            ["filter-created-by", "createdBy", "All creators"],
            ["filter-status", "status", "All statuses"]
        ];
        fields.forEach(([id, key, label]) => {
            const select = document.getElementById(id);
            if (!select) {
                return;
            }
            const previous = select.value;
            const values = [...new Set([...document
                .querySelectorAll("#sop-catalog-body tr")]
                .map(row => row.dataset[key])
                .filter(Boolean))]
                .sort((a, b) => a.localeCompare(b));

            select.innerHTML=
                `<option value="">
                    ${deps.escapeHtml(label)}
                </option>
                ${values.map(value => 
                `<option value="${deps.escapeHtml(value)}">
                    ${deps.escapeHtml(value)}
                </option>
                `).join("")}`;
            select.value = values.includes(previous)?previous:"";
        });
    }
    function applySopCatalogFilters() {
        const query = (document.getElementById("sop-search-box")?.value || "").trim().toLowerCase();
        const filters = {
            area: document.getElementById("filter-area")?.value || "",
            process: document.getElementById("filter-process")?.value || "",
            series: document.getElementById("filter-series")?.value || "",
            model: document.getElementById("filter-model")?.value || "",
            partName: document.getElementById("filter-part-name")?.value || "",
            createdBy: document.getElementById("filter-created-by")?.value || "",
            status: document.getElementById("filter-status")?.value || ""
        };
        document.querySelectorAll("#sop-catalog-body tr").forEach(row => {
            const textMatch = !query || row.textContent.toLowerCase().includes(query);
            const filterMatch = Object.entries(filters).every(([key, value]) => !value || row.dataset[key] === value);
            row.hidden = !(textMatch&&filterMatch);
        });
    }


    // Index section
    function renderSopCatalog(sops, creatorMap = new Map()) {
        const body = document.getElementById("sop-catalog-body"); 
        body.innerHTML = "";
        sops.forEach(sop => {
            const revisions = sop.document_revisions || [];
            const released = revisions.filter(revision => String(revision.status || "").toLowerCase() === "released");
            const current = [...(released.length? released: revisions)].sort((a, b) => deps.revisionNumber(b) - deps.revisionNumber(a))[0];
            const creator = creatorMap.get(String(current?.created_by || sop.created_by)) || "Unknown";
            const status = current?.status || sop.status || "Unknown";
            const row = document.createElement("tr"); 

            row.className = "catalog-clickable-row"; 
            row.tabIndex = 0; 
            row.setAttribute("role", "button"); 
            row.setAttribute("aria-label", "View SOP " + (sop.sop_code || "Unassigned")); 
            row.dataset.sopId = String(sop.id);
            row.dataset.area = sop.workshops?.name || ""; 
            row.dataset.process = sop.process_areas?.name || ""; 
            row.dataset.series = sop.models?.model_series?.name || ""; 
            row.dataset.model = sop.models?.size_model || ""; 
            row.dataset.partName = sop.part_names?.code || ""; 
            row.dataset.createdBy = creator; 
            row.dataset.status = deps.statusLabel(status);
            
            row.innerHTML = 
                `<td>${deps.escapeHtml(deps.formatDate(current?.released_at||current?.created_at||sop.created_at))}</td>
                <td>${deps.renderStatusBadge(status)}</td>
                <td>${deps.escapeHtml(sop.sop_code||"Unassigned")}</td>
                <td>${deps.escapeHtml(sop.workshops?.name||"")}</td>
                <td>${deps.escapeHtml(sop.process_areas?.name||"")}</td>
                <td>${deps.escapeHtml(sop.models?.size_model||"")}</td>
                <td>${deps.escapeHtml(sop.part_names?.code||"")}</td>
                <td>${deps.escapeHtml(sop.part_number||"")}</td>
                <td>${deps.escapeHtml(sop.document_name||"")}</td>
                <td>${deps.renderRevisionBadge(current?.revision_code,status)}</td>
                <td>${deps.escapeHtml(creator)}</td>
            `;
            body.appendChild(row);
        });
    }
    async function load() {
        const catalogBody = document.getElementById("sop-catalog-body");
        catalogBody.innerHTML = '<tr><td colspan="12">Loading...</td></tr>';
        const { data, error } = await SopDocumentAdapter.getSopDocuments();

        if (error) { 
            console.error("Error loading SOP catalog:", error); 
            catalogBody.innerHTML = '<tr><td colspan="12">Error loading SOP catalog.</td></tr>'; 
            return; 
        }
        if (!data || data.length === 0) { 
            catalogBody.innerHTML = '<tr><td colspan="12">No SOPs found.</td></tr>'; 
            populateSopCatalogFilters(); 
            return; 
        }
        const creatorIds = [...new Set(data.map(sop => { 
            const revs=sop.document_revisions || []; 
            const released=revs.filter(r=>String(r.status||"").toLowerCase()==="released"); 
            const current=[...(released.length?released:revs)].sort((a,b)=>deps.revisionNumber(b)-deps.revisionNumber(a))[0]; 
            return current?.created_by || sop.created_by; 
        }).filter(Boolean))];
        let profiles=[];
        if (creatorIds.length) { const profileResult=await supabaseClient.from("user_profile_names").select("id,full_name").in("id",creatorIds); if(profileResult.error) console.warn("Creator names unavailable in SOP catalog:",profileResult.error); else profiles=profileResult.data||[]; }
        renderSopCatalog(data,new Map(profiles.map(profile=>[String(profile.id),profile.full_name||"Unknown"])));
        populateSopCatalogFilters();
        applySopCatalogFilters();
    }

    return Object.freeze({initialize, load});
})();
