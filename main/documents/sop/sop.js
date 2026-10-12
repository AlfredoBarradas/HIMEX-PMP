document.addEventListener("DOMContentLoaded", async () => {
    const authData = await initializeSupabaseAuth();
    if (!authData?.user) {
        window.location.href = "/auth/";
        return;
    }
    await initializeSopPage();
});

async function initializeSopPage() {
    const sections = document.querySelectorAll(".sop-view");
    const navigationButtons = document.querySelectorAll("[data-section]");
    const sopForm = document.getElementById("sop-form");
    const editorTitle = document.getElementById("sop-editor-title");
    const editorDescription = document.getElementById("sop-editor-description");
    const sopMode = document.getElementById("sop-mode");
    const sopId = document.getElementById("sop-id");
    const revisionInfo = document.getElementById("revision-info");
    const revisionSopCode = document.getElementById("revision-sop-code");
    const revisionCurrent = document.getElementById("revision-current");
    const revisionNew = document.getElementById("revision-new");
    const descriptionTitle = document.getElementById("sop-description-title");
    const descriptionLabel = document.getElementById("sop-description-label");
    const descriptionInput = document.getElementById("sop-description");
    const fileInput = document.getElementById("sop-file");

    function setMyDraftsCount(count) {
        const counter = document.getElementById("my-drafts-count");
        if (counter) counter.textContent = String(count);
    }
    function applySopPermissions() {
        document.querySelectorAll("[data-required-permission]").forEach(element => {
            const permission = element.dataset.requiredPermission;
            element.classList.toggle("hidden", !hasPermission(permission));
        });
    }
    async function refreshWorkflowCounts() {
        try {
            const { data: instances, error: instanceError } = await supabaseClient.from("workflow_instances").select("id,status").in("status", ["active", "in_progress", "pending"]);
            if (instanceError) throw instanceError;
            const active = instances || [];
            if (!active.length) {
                document.getElementById("pending-validation-count").textContent = "0";
                document.getElementById("pending-approval-count").textContent = "0";
                return;
            }
            const ids = active.map(item => item.id);
            const [taskResult, nodeResult] = await Promise.all([
                supabaseClient.from("workflow_tasks").select("instance_id,node_id,status").in("instance_id", ids),
                supabaseClient.from("workflow_nodes").select("id,label,node_type,required_permission_code")
            ]);
            if (taskResult.error) throw taskResult.error;
            if (nodeResult.error) throw nodeResult.error;
            const nodeMap = new Map((nodeResult.data || []).map(node => [String(node.id), node]));
            const pending = (taskResult.data || []).filter(task => ["pending","assigned","in_progress"].includes(String(task.status || "").toLowerCase()));
            let validationCount = 0;
            let approvalCount = 0;
            pending.forEach(task => {
                const node = nodeMap.get(String(task.node_id));
                const permission = String(node?.required_permission_code || "").toLowerCase();
                const stage = [node?.label,node?.node_type].filter(Boolean).join(" ").toLowerCase();
                if (permission === "documents.sop.validate" || stage.includes("validat")) validationCount++;
                else if (permission === "documents.sop.approve" || stage.includes("approv")) approvalCount++;
            });
            document.getElementById("pending-validation-count").textContent = String(validationCount);
            document.getElementById("pending-approval-count").textContent = String(approvalCount);
        } catch (error) {
            console.error("Unable to refresh SOP workflow counters:", error);
            const validationCount = document.getElementById("pending-validation-count");
            const approvalCount = document.getElementById("pending-approval-count");
            if (validationCount) validationCount.title = "Could not refresh. See browser console.";
            if (approvalCount) approvalCount.title = "Could not refresh. See browser console.";
        }
    }
    async function loadSopWorkflow() { await loadSopTaskCatalog("sop-workflow"); }
    async function loadSopTaskCatalog(sectionId) {
        const body = document.getElementById(sectionId + "-body"); if (!body) return;
        body.innerHTML = '<tr><td colspan="11">Loading...</td></tr>';
        try {
            const { data: instances, error } = await supabaseClient.from("workflow_instances").select("id,source_document_id,source_revision_id,status,current_node_id,started_at,completed_at").order("started_at", { ascending: false }); if (error) throw error;
            const docIds = [...new Set((instances || []).map(item => item.source_document_id).filter(Boolean))], revisionIds = [...new Set((instances || []).map(item => item.source_revision_id).filter(Boolean))];
            const [docs,revisions,nodes] = await Promise.all([docIds.length ? supabaseClient.from("sop_documents").select("id,sop_code,part_number,operation_name,created_at,created_by,workshops(name),process_areas(name),models(name),part_names(name)").in("id",docIds) : Promise.resolve({data:[],error:null}),revisionIds.length ? supabaseClient.from("sop_revisions").select("id,revision_code,status,created_at,created_by").in("id",revisionIds) : Promise.resolve({data:[],error:null}),supabaseClient.from("workflow_nodes").select("id,label,node_type")]);
            for (const result of [docs,revisions,nodes]) if (result.error) throw result.error;
            const docMap = new Map((docs.data || []).map(item => [String(item.id),item])), revisionMap = new Map((revisions.data || []).map(item => [String(item.id),item])), nodeMap = new Map((nodes.data || []).map(item => [String(item.id),item]));
            let rows = (instances || []).map(instance => { const doc=docMap.get(String(instance.source_document_id))||{}, revision=revisionMap.get(String(instance.source_revision_id))||{}, node=nodeMap.get(String(instance.current_node_id))||{}, status=String(instance.status||"pending").toLowerCase(), stage=status==="completed"?"Completed":status==="rejected"?"Rejected":String(node.label||node.node_type||"In progress"); return {instance,doc,revision,node,status,stage}; });
            if (sectionId === "sop-validation") rows = rows.filter(row => /validat/i.test(row.stage) && !["completed","rejected"].includes(row.status));
            if (sectionId === "sop-approval") rows = rows.filter(row => /approv/i.test(row.stage) && !["completed","rejected"].includes(row.status));
            if (!rows.length) { body.innerHTML = '<tr><td colspan="11">No records found.</td></tr>'; return; }
            body.innerHTML = rows.map(({instance,doc,revision,status,stage}) => '<tr class="catalog-clickable-row workflow-clickable-row" tabindex="0" role="button" data-sop-id="' + escapeHtml(doc.id || instance.source_document_id) + '" data-instance-id="' + escapeHtml(instance.id) + '" aria-label="Review SOP ' + escapeHtml(doc.sop_code || "Unassigned") + '"><td>' + escapeHtml(formatDate(instance.started_at || doc.created_at)) + '</td><td>' + renderStatusBadge(status === "active" || status === "in_progress" ? stage : status) + '</td><td>' + escapeHtml(doc.sop_code || "Unassigned") + '</td><td>' + escapeHtml(doc.workshops?.name || "") + '</td><td>' + escapeHtml(doc.process_areas?.name || "") + '</td><td>' + escapeHtml(doc.models?.name || "") + '</td><td>' + escapeHtml(doc.part_names?.name || "") + '</td><td>' + escapeHtml(doc.part_number || "") + '</td><td>' + escapeHtml(doc.operation_name || "") + '</td><td>' + renderRevisionBadge(revision.revision_code,revision.status) + '</td><td>' + escapeHtml(revision.created_by || doc.created_by || "") + '</td></tr>').join("");
        } catch (error) { console.error("Unable to load SOP task catalog:",error); body.innerHTML = '<tr><td colspan="11">Unable to load records. Check permissions and the browser console.</td></tr>'; }
    }
    function showSection(sectionId) {
        const targetSection = document.getElementById(sectionId);
        if (!targetSection || !targetSection.classList.contains("sop-view")) return;
        const canView = hasPermission("documents.sop.view");
        const canCreate = hasPermission("documents.sop.create");
        if (!canView) {
            document.querySelectorAll(".sop-view").forEach(section => section.classList.add("hidden"));
            return;
        }
        if (!canCreate) sectionId = "sop-catalog";
        const mainSections = ["sop-control", "sop-workflow-summary", "sop-catalog"];
        const secondarySections = ["sop-create", "sop-drafts", "sop-validation", "sop-approval", "sop-workflow"];
        if (sectionId === "sop-control" && canCreate) {
            secondarySections.forEach(id => document.getElementById(id)?.classList.add("hidden"));
            applySopPermissions();
            document.getElementById("sop-workflow")?.classList.add("hidden");
            mainSections.forEach(id => document.getElementById(id)?.classList.remove("hidden"));
            mainSections.forEach(id => {
                const section = document.getElementById(id);
                if (section) section.classList.toggle("hidden", id === "sop-workflow");
            });
            refreshWorkflowCounts();
            loadMyDrafts();
        } else {
            document.querySelectorAll(".sop-view").forEach(section => section.classList.add("hidden"));
            mainSections.forEach(id => {
                const section = document.getElementById(id);
                if (section) section.classList.toggle("hidden", id !== sectionId);
            });
            secondarySections.forEach(id => {
                const section = document.getElementById(id);
                if (section) section.classList.toggle("hidden", id !== sectionId);
            });
        }
        if (sectionId === "sop-workflow") loadSopWorkflow();
        if (sectionId === "sop-validation" || sectionId === "sop-approval") loadSopTaskCatalog(sectionId);
        if (sectionId === "sop-catalog") loadSopCatalog();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    window.addEventListener("focus", () => {
        if (!document.getElementById("sop-control")?.classList.contains("hidden")) refreshWorkflowCounts();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && !document.getElementById("sop-control")?.classList.contains("hidden")) refreshWorkflowCounts();
    });
    function setFormEditable(editable) {
        document.getElementById("sop-workshop").disabled = !editable;
        document.getElementById("sop-process").disabled = !editable;
        document.getElementById("sop-model-series").disabled = !editable;
        document.getElementById("sop-model").disabled = !editable;
        document.getElementById("sop-part-name").disabled = !editable;
        document.getElementById("sop-part-number").readOnly = !editable;
        document.getElementById("sop-operation").readOnly = !editable;
    }
    function setCreateMode() {
        if (typeof editingRevisionId !== "undefined") editingRevisionId = null;
        sopMode.value = "create";
        sopId.value = "";
        editorTitle.textContent = "Create New SOP";
        editorDescription.textContent = "Create a new standard operating process.";
        revisionInfo.classList.add("hidden");
        descriptionTitle.innerHTML = 'Description <span class="required-marker" aria-hidden="true">*</span>';
        descriptionLabel.textContent = "Description";
        descriptionInput.placeholder = "Describe the purpose and scope of this SOP.";
        fileInput.value = "";
        setFormEditable(true);
    }
    function setRevisionMode(sop) {
        sopMode.value = "revision";
        sopId.value = sop.id;
        editorTitle.textContent = "SOP Revision";
        editorDescription.textContent = "Create a new revision of an existing SOP.";
        revisionInfo.classList.remove("hidden");
        revisionSopCode.value = sop.sopCode;
        revisionCurrent.value = sop.currentRevision;
        revisionNew.value = getNextRevision(sop.currentRevision);
        descriptionTitle.textContent = "Change Summary";
        descriptionLabel.textContent = "Change Summary";
        descriptionInput.placeholder = "Describe what changed in this revision.";
        fileInput.value = "";
        document.getElementById("sop-workshop").value = sop.workshopId;
        document.getElementById("sop-process").value = sop.processAreaId;
        document.getElementById("sop-model-series").value = sop.modelSeriesId;
        document.getElementById("sop-model").value = sop.modelId;
        document.getElementById("sop-part-name").value = sop.partNameId;
        document.getElementById("sop-part-number").value = sop.partNumber || "";
        document.getElementById("sop-operation").value = sop.operationName || "";
        descriptionInput.value = "";
        setFormEditable(false);
    }
    function getNextRevision(revision) {
        if (!revision) return "R01";
        const number = parseInt(revision.replace("R", ""), 10);
        if (Number.isNaN(number)) return "R01";
        return `R${String(number + 1).padStart(2, "0")}`;
    }
    function openCreateSop() {
        sopForm.reset();
        setCreateMode();
        showSection("sop-create");
    }
    async function openRevisionSop(sop) {
        setRevisionMode(sop);
        showSection("sop-create");
    }
    let editingRevisionId = null;
    async function openEditSop(draftSopId) {
        try {
            const { data: authResult, error: authError } = await supabaseClient.auth.getUser();
            if (authError) throw authError;
            const userId = authResult?.user?.id;
            if (!userId) throw new Error("Please sign in again.");
            const { data: sop, error } = await supabaseClient
                .from("sop_documents")
                .select("id,workshop_id,process_area_id,model_id,part_name_id,part_number,operation_name,created_by,models(model_series_id),sop_revisions(id,revision_number,revision_code,status,description,created_by,created_at)")
                .eq("id", Number(draftSopId))
                .eq("created_by", userId)
                .single();
            if (error) throw error;
            const revision = (sop.sop_revisions || []).find(item => String(item.status || "").toLowerCase() === "draft" && String(item.created_by || sop.created_by) === String(userId));
            if (!revision) throw new Error("This SOP has no editable Draft revision.");
            await loadWorkshops();
            document.getElementById("sop-workshop").value = String(sop.workshop_id);
            await loadProcessAreas(sop.workshop_id);
            document.getElementById("sop-process").value = String(sop.process_area_id);
            await loadPartNames(sop.workshop_id);
            document.getElementById("sop-part-name").value = String(sop.part_name_id);
            await loadModelSeries();
            const seriesId = sop.models?.model_series_id;
            document.getElementById("sop-model-series").value = String(seriesId || "");
            await loadModels(seriesId);
            document.getElementById("sop-model").value = String(sop.model_id);
            document.getElementById("sop-part-number").value = sop.part_number || "";
            document.getElementById("sop-operation").value = sop.operation_name || "";
            document.getElementById("sop-description").value = revision.description || "";
            document.getElementById("sop-file").value = "";
            sopMode.value = "edit";
            sopId.value = String(sop.id);
            editingRevisionId = revision.id;
            editorTitle.textContent = "Edit Draft SOP";
            editorDescription.textContent = "Update the details of this draft before submitting it for validation.";
            descriptionTitle.textContent = "Description";
            descriptionLabel.textContent = "Description";
            revisionInfo.classList.add("hidden");
            setFormEditable(true);
            showSection("sop-create");
        } catch (error) {
            console.error("Error opening draft for editing:", error);
            alert("Could not open this draft for editing. " + (error?.message || ""));
        }
    }
    navigationButtons.forEach(button => {
        button.addEventListener("click", () => {
            showSection(button.dataset.section);
        });
    });
    document.querySelectorAll(".create-sop-button").forEach(button => {
        button.addEventListener("click", openCreateSop);
    });
    document.querySelectorAll(".edit-draft-button").forEach(button => {
        button.addEventListener("click", () => openEditSop(button.dataset.sopId));
    });
    document.querySelectorAll(".revision-sop-button").forEach(button => {
        button.addEventListener("click", () => {
            const sop = {
                id: button.dataset.sopId,
                sopCode: button.dataset.sopCode,
                currentRevision: button.dataset.revision,
                workshopId: button.dataset.workshopId,
                processAreaId: button.dataset.processAreaId,
                modelSeriesId: button.dataset.modelSeriesId,
                modelId: button.dataset.modelId,
                partNameId: button.dataset.partNameId,
                partNumber: button.dataset.partNumber,
                operationName: button.dataset.operationName
            };
            openRevisionSop(sop);
        });
    });
    document.getElementById("save-sop-draft").addEventListener("click", async () => {
        await saveNewSop({ submitForValidation: false });
    });
    sopForm.addEventListener("submit", async event => {
        event.preventDefault();
        await saveNewSop({ submitForValidation: true });
    });
    document.querySelectorAll(".danger-button").forEach(button => {
        button.addEventListener("click", () => {
            if (!confirm("Are you sure you want to delete this draft?")) return;
            const row = button.closest("tr");
            if (row) row.remove();
        });
    });
    document.querySelectorAll("#sop-validation .primary-button").forEach(button => {
        button.addEventListener("click", () => {
            if (!confirm("Validate this SOP?")) return;
            const row = button.closest("tr");
            if (row) row.remove();
            alert("SOP validated successfully.");
        });
    });
    document.querySelectorAll("#sop-approval .primary-button").forEach(button => {
        button.addEventListener("click", () => {
            if (!confirm("Approve this SOP?")) return;
            const row = button.closest("tr");
            if (row) row.remove();
            alert("SOP approved successfully.");
        });
    });
    document.querySelectorAll(".view-flow-button").forEach(button => {
        button.addEventListener("click", () => {
            alert("Workflow detail will be displayed here.");
        });
    });
    applySopPermissions();
    if (hasPermission("documents.sop.view")) {
        if (hasPermission("documents.sop.create")) {
            showSection("sop-control");
            loadSopCatalog();
        } else {
            showSection("sop-catalog");
            loadSopCatalog();
        }
    }




    async function loadPartNames(workshopId) {
        const partNameSelect = document.getElementById("sop-part-name");
        partNameSelect.innerHTML = '<option value="">Select part name</option>';
        partNameSelect.disabled = true;
        if (!workshopId) return;
        const { data: relations, error: relationError } = await supabaseClient
            .from("workshop_part_names")
            .select("part_name_id")
            .eq("workshop_id", workshopId);
        if (relationError) {
            console.error("Error loading workshop part names:", relationError);
            return;
        }
        const partNameIds = relations.map(item => item.part_name_id);
        if (partNameIds.length === 0) {
            console.warn("No part names found for workshop:", workshopId);
            partNameSelect.disabled = false;
            return;
        }
        const { data: partNames, error: partNameError } = await supabaseClient
            .from("part_names")
            .select("id, name, code")
            .in("id", partNameIds)
            .eq("active", true)
            .order("name");
        if (partNameError) {
            console.error("Error loading part names:", partNameError);
            return;
        }
        partNames.forEach(part => {
            const option = document.createElement("option");
            option.value = part.id;
            option.textContent = part.name;
            partNameSelect.appendChild(option);
        });
        partNameSelect.disabled = false;
    }

    async function loadModels(seriesId) {
        const modelSelect = document.getElementById("sop-model");
        modelSelect.innerHTML = '<option value="">Select model</option>';
        modelSelect.disabled = true;
        if (!seriesId) return;
        const { data, error } = await supabaseClient
            .from("models")
            .select("id, name")
            .eq("model_series_id", seriesId)
            .eq("active", true)
            .order("name");
        if (error) {
            console.error("Error loading models:", error);
            return;
        }
        data.forEach(model => {
            const option = document.createElement("option");
            option.value = model.id;
            option.textContent = model.name;
            modelSelect.appendChild(option);
        });
        modelSelect.disabled = false;
    }

    async function loadModelSeries() {
        const seriesSelect = document.getElementById("sop-model-series");
        seriesSelect.innerHTML = '<option value="">Select model series</option>';
        seriesSelect.disabled = true;
        const { data, error } = await supabaseClient
            .from("model_series")
            .select("id, name, code")
            .eq("active", true)
            .order("name");
        if (error) {
            console.error("Error loading model series:", error);
            return;
        }
        data.forEach(series => {
            const option = document.createElement("option");
            option.value = series.id;
            option.textContent = series.name;
            seriesSelect.appendChild(option);
        });
        seriesSelect.disabled = false;
    }

    async function loadProcessAreas(workshopId) {
        const processSelect = document.getElementById("sop-process");
        processSelect.innerHTML = '<option value="">Select process area</option>';
        processSelect.disabled = true;
        if (!workshopId) return;
        const { data: relations, error: relationError } = await supabaseClient
            .from("workshop_process_areas")
            .select("process_area_id")
            .eq("workshop_id", workshopId);
        if (relationError) {
            console.error("Error loading workshop process areas:", relationError);
            return;
        }
        const areaIds = relations.map(item => item.process_area_id);
        if (areaIds.length === 0) {
            console.warn("No process areas found for workshop:", workshopId);
            processSelect.disabled = false;
            return;
        }
        const { data: areas, error: areaError } = await supabaseClient
            .from("process_areas")
            .select("id, name, code")
            .in("id", areaIds)
            .eq("active", true)
            .order("name");
        if (areaError) {
            console.error("Error loading process areas:", areaError);
            return;
        }
        areas.forEach(area => {
            const option = document.createElement("option");
            option.value = area.id;
            option.textContent = `${area.name} (${area.code})`;
            processSelect.appendChild(option);
        });
        processSelect.disabled = false;
    }

    async function loadWorkshops() {
        const workshopSelect = document.getElementById("sop-workshop");
        const { data, error } = await supabaseClient
            .from("workshops")
            .select("id, name, code")
            .eq("active", true)
            .order("name");
        if (error) {
            console.error("Error loading workshops:", error);
            return;
        }
        workshopSelect.innerHTML = '<option value="">Select workshop</option>';
        data.forEach(workshop => {
            const option = document.createElement("option");
            option.value = workshop.id;
            option.textContent = `${workshop.name} (${workshop.code})`;
            workshopSelect.appendChild(option);
        });
    }


    function validateSopForm() {
        const alertBox = document.getElementById("sop-validation-alert");
        const fields = [
            { id: "sop-workshop", label: "Workshop area" },
            { id: "sop-process", label: "Process area" },
            { id: "sop-model-series", label: "Model series" },
            { id: "sop-model", label: "Model size" },
            { id: "sop-part-name", label: "Part Name" },
            { id: "sop-part-number", label: "Part Number" },
            { id: "sop-operation", label: "Operation Name" },
            { id: "sop-description", label: "Description" }
        ];
        const missing = [];
        fields.forEach(field => {
            const input = document.getElementById(field.id);
            const group = input.closest(".form-group");
            const empty = !String(input.value || "").trim();
            group?.classList.toggle("sop-field-invalid", empty);
            input.setAttribute("aria-invalid", empty ? "true" : "false");
            const existingError = group?.querySelector(".sop-field-error");
            if (existingError) existingError.remove();
            if (empty) {
                missing.push(field.label);
                const message = document.createElement("small");
                message.className = "sop-field-error";
                message.textContent = "This field is required.";
                group?.appendChild(message);
            }
        });
        if (missing.length) {
            alertBox.innerHTML = "<h3>Please complete all required fields.</h3><p>The following fields are missing:</p><ul>" + missing.map(label => "<li>" + escapeHtml(label) + "</li>").join("") + "</ul>";
            alertBox.classList.remove("hidden");
            const actions = sopForm.querySelector(".form-actions");
            actions?.insertAdjacentElement("beforebegin", alertBox);
            const firstMissing = fields.find(field => missing.includes(field.label));
            document.getElementById(firstMissing.id).focus();
            alertBox.scrollIntoView({ behavior: "smooth", block: "center" });
            return false;
        }
        alertBox.classList.add("hidden");
        alertBox.innerHTML = "";
        const originalPosition = sopForm.querySelector(".form-section");
        if (originalPosition && alertBox.parentElement !== sopForm) originalPosition.insertAdjacentElement("beforebegin", alertBox);
        return true;
    }
    sopForm.addEventListener("input", event => {
        if (event.target.matches("input, textarea, select")) {
            const group = event.target.closest(".form-group");
            if (group && String(event.target.value || "").trim()) {
                group.classList.remove("sop-field-invalid");
                event.target.setAttribute("aria-invalid", "false");
                group.querySelector(".sop-field-error")?.remove();
            }
            if (!sopForm.querySelector(".sop-field-invalid")) {
                const alertBox = document.getElementById("sop-validation-alert");
                alertBox.classList.add("hidden");
                alertBox.innerHTML = "";
            }
        }
    });
    async function saveNewSop({ submitForValidation = false } = {}) {
        const workshopId = document.getElementById("sop-workshop").value;
        const processAreaId = document.getElementById("sop-process").value;
        const modelId = document.getElementById("sop-model").value;
        const partNameId = document.getElementById("sop-part-name").value;
        const partNumber = document.getElementById("sop-part-number").value.trim();
        const operationName = document.getElementById("sop-operation").value.trim();
        const description = document.getElementById("sop-description").value.trim();
        if (!validateSopForm()) return;
        const saveButton = document.getElementById("save-sop-draft");
        const submitButton = sopForm.querySelector('button[type="submit"]');
        const originalSaveText = saveButton.textContent;
        const originalSubmitText = submitButton.textContent;
        saveButton.disabled = true;
        submitButton.disabled = true;
        saveButton.textContent = "Saving...";
        submitButton.textContent = submitForValidation ? "Submitting..." : originalSubmitText;
        try {
            if (sopMode.value === "revision") {
                const { data: authResult, error: authError } = await supabaseClient.auth.getUser();
                if (authError) throw authError;
                const userId = authResult?.user?.id;
                if (!userId) throw new Error("Please sign in again before creating a revision.");
                const { data: revisionData, error: revisionCreateError } = await supabaseClient.rpc("create_sop_revision", {
                    p_sop_id: Number(sopId.value),
                    p_change_summary: description,
                    p_created_by: userId
                });
                if (revisionCreateError) throw revisionCreateError;
                const createdRevision = Array.isArray(revisionData) ? revisionData[0] : revisionData;
                if (!createdRevision?.revision_code) {
                    console.error("Unexpected create_sop_revision response:", revisionData);
                    throw new Error("Revision creation returned an unexpected response.");
                }
                const { data: revisionRecord, error: revisionLookupError } = await supabaseClient
                    .from("sop_revisions")
                    .select("id")
                    .eq("sop_id", Number(sopId.value))
                    .eq("revision_code", createdRevision.revision_code)
                    .single();
                if (revisionLookupError) throw revisionLookupError;
                if (submitForValidation) {
                    const { error: workflowError } = await supabaseClient.rpc("workflow_start_instance", {
                        p_definition_id: 1,
                        p_source_document_id: Number(sopId.value),
                        p_source_revision_id: Number(revisionRecord.id),
                        p_metadata: { source: "sop_revision_form", submitted_from: "Submit for Validation" }
                    });
                    if (workflowError) {
                        alert("Revision " + createdRevision.revision_code + " was saved as Draft, but submission failed: " + workflowError.message);
                        await loadMyDrafts();
                        await loadSopCatalog();
                        return;
                    }
                    alert("Revision " + createdRevision.revision_code + " was created and submitted for validation.");
                } else {
                    alert("Revision " + createdRevision.revision_code + " was saved as Draft.");
                }
                sopForm.reset();
                editingRevisionId = null;
                setCreateMode();
                applySopPermissions();
                showSection(hasPermission("documents.sop.create") ? "sop-control" : "sop-catalog");
                loadSopCatalog();
                await loadMyDrafts();
                await loadSopCatalog();
                return;
            }
            if (sopMode.value === "edit") {
                if (!editingRevisionId) throw new Error("Draft revision is missing. Reopen the draft and try again.");
                const { data: updateResult, error: updateError } = await supabaseClient.rpc("update_sop_draft", {
                    p_sop_id: Number(sopId.value),
                    p_revision_id: Number(editingRevisionId),
                    p_workshop_id: Number(workshopId),
                    p_process_area_id: Number(processAreaId),
                    p_model_id: Number(modelId),
                    p_part_name_id: Number(partNameId),
                    p_part_number: partNumber,
                    p_operation_name: operationName,
                    p_description: description
                });
                if (updateError) throw updateError;
                if (submitForValidation) {
                    const { error: workflowError } = await supabaseClient.rpc("workflow_start_instance", {
                        p_definition_id: 1,
                        p_source_document_id: Number(sopId.value),
                        p_source_revision_id: Number(editingRevisionId),
                        p_metadata: { source: "sop_form", submitted_from: "Submit for Validation" }
                    });
                    if (workflowError) {
                        console.error("Draft saved but workflow submission failed:", workflowError);
                        alert("Draft changes were saved, but submission for validation failed: " + workflowError.message);
                        await loadMyDrafts();
                        await loadSopCatalog();
                        return;
                    }
                    alert("Draft updated and submitted for validation.");
                } else {
                    alert("Draft updated successfully. No official SOP code has been assigned.");
                }
                sopForm.reset();
                editingRevisionId = null;
                setCreateMode();
                showSection("sop-drafts");
                await loadMyDrafts();
                await loadSopCatalog();
                return;
            }
            const { data, error } = await supabaseClient.rpc("create_new_sop", {
                p_workshop_id: Number(workshopId),
                p_process_area_id: Number(processAreaId),
                p_model_id: Number(modelId),
                p_part_name_id: Number(partNameId),
                p_part_number: partNumber,
                p_operation_name: operationName,
                p_description: description
            });
            if (error) throw error;
            const createdSop = Array.isArray(data) ? data[0] : data;
            if (!createdSop?.sop_id || !createdSop?.revision_code) {
                console.error("Unexpected create_new_sop response:", data);
                throw new Error("SOP creation returned an unexpected response. Check the browser console for the RPC response.");
            }
            const sopDisplayCode = createdSop.sop_code || "Unassigned";
            if (submitForValidation) {
                const { data: revision, error: revisionError } = await supabaseClient
                    .from("sop_revisions")
                    .select("id")
                    .eq("sop_id", createdSop.sop_id)
                    .eq("revision_code", createdSop.revision_code)
                    .single();
                if (revisionError) {
                    console.error("Error retrieving created SOP revision:", revisionError);
                    alert("SOP " + sopDisplayCode + " was created as Draft, but its revision could not be retrieved. Submission did not start. " + revisionError.message);
                    await loadMyDrafts();
                    await loadSopCatalog();
                    return;
                }
                const { data: workflow, error: workflowError } = await supabaseClient.rpc("workflow_start_instance", {
                    p_definition_id: 1,
                    p_source_document_id: Number(createdSop.sop_id),
                    p_source_revision_id: Number(revision.id),
                    p_metadata: {
                        source: "sop_form",
                        submitted_from: "Submit for Validation"
                    }
                });
                if (workflowError) {
                    console.error("Error starting SOP workflow:", workflowError);
                    alert("SOP " + sopDisplayCode + " was created as Draft, but submission for validation failed. No workflow was started. " + workflowError.message);
                    await loadMyDrafts();
                    await loadSopCatalog();
                    return;
                }
                console.log("SOP workflow started:", workflow);
                alert("SOP " + sopDisplayCode + " (" + createdSop.revision_code + ") was created and submitted for validation.");
            } else {
                alert("SOP draft saved successfully as " + createdSop.revision_code + ". Official SOP code will be assigned upon release.");
            }
            sopForm.reset();
            setCreateMode();
            showSection("sop-control");
            await loadSopCatalog();
        } catch (error) {
            console.error("Error saving SOP:", error);
            alert("Error saving SOP. " + (error?.message || "Check the browser console for details."));
        } finally {
            saveButton.disabled = false;
            submitButton.disabled = false;
            saveButton.textContent = originalSaveText;
            submitButton.textContent = originalSubmitText;
        }
    }

    loadWorkshops();
    document.getElementById("sop-workshop").addEventListener("change", event => {
        const workshopId = event.target.value;
        loadProcessAreas(workshopId);
        loadPartNames(workshopId);
    });
    document.getElementById("sop-model-series").addEventListener("change", event => {
        loadModels(event.target.value);
    });
    loadModelSeries();

    // Removed duplicate legacy click handler; the configured handler above handles Save Draft.





    async function loadMyDrafts() {
        const body = document.getElementById("sop-drafts-body");
        if (!body) return;
        body.innerHTML = '<tr><td colspan="8">Loading your drafts...</td></tr>';
        try {
            const { data: authData, error: authError } = await supabaseClient.auth.getUser();
            if (authError) throw authError;
            const userId = authData?.user?.id;
            if (!userId) {
                setMyDraftsCount(0);
                body.innerHTML = '<tr><td colspan="8">Please sign in to view your drafts.</td></tr>';
                return;
            }
            const { data: revisions, error: revisionError } = await supabaseClient
                .from("sop_revisions")
                .select("id,sop_id,revision_code,revision_number,status,created_at,created_by,description,sop_documents!inner(id,sop_code,part_number,operation_name,created_at,created_by,workshops(name),process_areas(name),models(name),part_names(name))")
                .eq("created_by", userId)
                .eq("status", "Draft")
                .order("created_at", { ascending: false });
            if (revisionError) throw revisionError;
            const drafts = (revisions || []).map(revision => ({
                doc: revision.sop_documents,
                revision
            })).filter(item => item.doc);
            setMyDraftsCount(drafts.length);
            if (!drafts.length) {
                body.innerHTML = '<tr><td colspan="8">You have no draft SOPs.</td></tr>';
                return;
            }
            body.innerHTML = drafts.map(item => '<tr class="catalog-clickable-row" tabindex="0" role="button" data-sop-id="' + escapeHtml(item.doc.id) + '" aria-label="View SOP ' + escapeHtml(item.doc.sop_code || "Unassigned") + '"><td>' + escapeHtml(item.doc.sop_code || "Unassigned") + '</td><td>' + escapeHtml(item.doc.workshops?.name || "") + '</td><td>' + escapeHtml(item.doc.process_areas?.name || "") + '</td><td>' + escapeHtml(item.doc.models?.name || "") + '</td><td>' + escapeHtml(item.doc.part_names?.name || "") + '</td><td>' + escapeHtml(item.doc.part_number || "") + '</td><td>' + escapeHtml(item.doc.operation_name || "") + '</td></tr>').join("");
        } catch (error) {
            console.error("Error loading My Drafts:", error);
            const counter = document.getElementById("my-drafts-count");
            if (counter) counter.title = "Could not refresh. See browser console.";
            body.innerHTML = '<tr><td colspan="8">Unable to load drafts. Check Supabase permissions and the browser console.</td></tr>';
        }
    }
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    }
    document.addEventListener("click", async event => {
        const workflowRow = event.target.closest("#sop-workflow-body .workflow-clickable-row");
        if (workflowRow && !event.target.closest("button, a, input, select, textarea, label")) { viewSop(workflowRow.dataset.sopId); return; }
        const draftRow = event.target.closest("#sop-drafts-body .catalog-clickable-row");
        if (draftRow && !event.target.closest("button, a, input, select, textarea, label")) { viewSop(draftRow.dataset.sopId); return; }
        const viewButton = event.target.closest(".draft-view-button");
        if (viewButton) { viewSop(viewButton.dataset.sopId); return; }
        const editButton = event.target.closest(".edit-draft-button");
        if (editButton) {
            alert("Revision information cannot be edited after the revision is created. If changes are required, delete this Draft revision and create it again with the correct information.");
            return;
        }
        const deleteButton = event.target.closest(".delete-draft-button");
        if (deleteButton) {
            if (!confirm("Delete this Draft SOP permanently? This action cannot be undone.")) return;
            deleteButton.disabled = true;
            try {
                const { data, error } = await supabaseClient.rpc("delete_sop_draft", {
                    p_sop_id: Number(deleteButton.dataset.sopId)
                });
                if (error) throw error;
                alert("Draft deleted successfully.");
                await loadMyDrafts();
                await loadSopCatalog();
            } catch (error) {
                console.error("Error deleting SOP draft:", error);
                alert("Could not delete this draft: " + (error.message || "Check the delete_sop_draft RPC and permissions."));
            } finally {
                deleteButton.disabled = false;
            }
            return;
        }
        const submitButton = event.target.closest(".draft-submit-button");
        if (!submitButton) return;
        if (!confirm("Submit " + submitButton.dataset.sopCode + " (" + submitButton.dataset.revisionCode + ")? This will start the workflow.")) return;
        submitButton.disabled = true;
        try {
            const { data, error } = await supabaseClient.rpc("workflow_start_instance", {
                p_definition_id: 1,
                p_source_document_id: Number(submitButton.dataset.sopId),
                p_source_revision_id: Number(submitButton.dataset.revisionId),
                p_metadata: { source: "my_drafts", submitted_from: "My Drafts" }
            });
            if (error) throw error;
            alert("SOP submitted. The workflow has started.");
            await loadMyDrafts();
            await loadSopCatalog();
        } catch (error) {
            console.error("Error submitting draft for validation:", error);
            alert("Could not submit this draft: " + (error.message || "Check workflow permissions and configuration."));
        } finally {
            submitButton.disabled = false;
        }
    });
    async function loadSopCatalog() {
        const catalogBody = document.getElementById("sop-catalog-body");
        catalogBody.innerHTML = '<tr><td colspan="12">Loading...</td></tr>';
        const { data, error } = await supabaseClient.from("sop_documents").select(`
            id,sop_code,part_number,operation_name,created_at,created_by,
            workshops(name,code),process_areas(name,code),models(name,model_series(name,code)),part_names(name,code),
            sop_revisions(revision_number,revision_code,status,created_at,created_by,released_at)
        `).order("created_at", { ascending: false });
        if (error) { console.error("Error loading SOP catalog:", error); catalogBody.innerHTML = '<tr><td colspan="12">Error loading SOP catalog.</td></tr>'; return; }
        if (!data || data.length === 0) { catalogBody.innerHTML = '<tr><td colspan="12">No SOPs found.</td></tr>'; populateSopCatalogFilters(); return; }
        const creatorIds = [...new Set(data.map(sop => { const revs=sop.sop_revisions||[]; const released=revs.filter(r=>String(r.status||"").toLowerCase()==="released"); const current=[...(released.length?released:revs)].sort((a,b)=>revisionNumber(b)-revisionNumber(a))[0]; return current?.created_by||sop.created_by; }).filter(Boolean))];
        let profiles=[];
        if (creatorIds.length) { const profileResult=await supabaseClient.from("user_profiles").select("id,full_name").in("id",creatorIds); if(profileResult.error) console.warn("Creator names unavailable in SOP catalog:",profileResult.error); else profiles=profileResult.data||[]; }
        renderSopCatalog(data,new Map(profiles.map(profile=>[String(profile.id),profile.full_name||"Unknown"])));
        populateSopCatalogFilters();
        applySopCatalogFilters();
    }
    function revisionNumber(revision) { return Number(revision?.revision_number)||parseInt(String(revision?.revision_code||"").replace(/\D/g,""),10)||0; }
    function statusKey(value) { return String(value||"unknown").trim().toLowerCase().replace(/[\s-]+/g,"_"); }
    function statusLabel(value) { const key=statusKey(value); return ({released:"Released",validation:"In Validation",in_validation:"In Validation",approval:"In Approval",in_approval:"In Approval",draft:"Draft",obsolete:"Obsolete",rejected:"Rejected"}[key]||String(value||"Unknown").replaceAll("_"," ").replace(/\b\w/g,char=>char.toUpperCase())); }
    function renderStatusBadge(status) { return '<span class="status-badge status-' + statusKey(status) + '">' + escapeHtml(statusLabel(status)) + '</span>'; }
    function renderRevisionBadge(code,status) { if(!code) return '<span class="revision-badge revision-unassigned">—</span>'; return '<span class="revision-badge status-' + statusKey(status) + '">' + escapeHtml(code) + '</span>'; }
    function renderSopCatalog(sops,creatorMap=new Map()) {
        const body=document.getElementById("sop-catalog-body"); body.innerHTML="";
        sops.forEach(sop=>{
            const revisions=sop.sop_revisions||[];
            const released=revisions.filter(revision=>String(revision.status||"").toLowerCase()==="released");
            const current=[...(released.length?released:revisions)].sort((a,b)=>revisionNumber(b)-revisionNumber(a))[0];
            const creator=creatorMap.get(String(current?.created_by||sop.created_by))||"Unknown";
            const status=current?.status||"Unknown";
            const row=document.createElement("tr"); row.className="catalog-clickable-row"; row.tabIndex=0; row.setAttribute("role","button"); row.setAttribute("aria-label","View SOP "+(sop.sop_code||"Unassigned")); row.dataset.sopId=String(sop.id);
            row.dataset.area=sop.workshops?.name||""; row.dataset.process=sop.process_areas?.name||""; row.dataset.series=sop.models?.model_series?.name||""; row.dataset.model=sop.models?.name||""; row.dataset.partName=sop.part_names?.name||""; row.dataset.createdBy=creator; row.dataset.status=statusLabel(status);
            row.innerHTML = "<td>"+escapeHtml(formatDate(current?.released_at||current?.created_at||sop.created_at))+"</td>"+
                "<td>"+renderStatusBadge(status)+"</td>"+
                "<td>"+escapeHtml(sop.sop_code||"Unassigned")+"</td>"+
                "<td>"+escapeHtml(sop.workshops?.name||"")+"</td>"+
                "<td>"+escapeHtml(sop.process_areas?.name||"")+"</td>"+
                "<td>"+escapeHtml(sop.models?.name||"")+"</td>"+
                "<td>"+escapeHtml(sop.part_names?.name||"")+"</td>"+
                "<td>"+escapeHtml(sop.part_number||"")+"</td>"+
                "<td>"+escapeHtml(sop.operation_name||"")+"</td>"+
                "<td>"+renderRevisionBadge(current?.revision_code,status)+"</td>";
            body.appendChild(row);
        });
    }
    function populateSopCatalogFilters() {
        const fields=[["filter-area","area","All areas"],["filter-process","process","All processes"],["filter-series","series","All model series"],["filter-model","model","All sizes"],["filter-part-name","partName","All part names"],["filter-created-by","createdBy","All creators"],["filter-status","status","All statuses"]];
        fields.forEach(([id,key,label])=>{const select=document.getElementById(id);if(!select)return;const previous=select.value;const values=[...new Set([...document.querySelectorAll("#sop-catalog-body tr")].map(row=>row.dataset[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));select.innerHTML='<option value="">' + escapeHtml(label) + '</option>'+values.map(value=>'<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>').join("");select.value=values.includes(previous)?previous:"";});
    }
    function applySopCatalogFilters() {
        const query=(document.getElementById("sop-search-box")?.value||"").trim().toLowerCase();
        const filters={area:document.getElementById("filter-area")?.value||"",process:document.getElementById("filter-process")?.value||"",series:document.getElementById("filter-series")?.value||"",model:document.getElementById("filter-model")?.value||"",partName:document.getElementById("filter-part-name")?.value||"",createdBy:document.getElementById("filter-created-by")?.value||"",status:document.getElementById("filter-status")?.value||""};
        document.querySelectorAll("#sop-catalog-body tr").forEach(row=>{const textMatch=!query||row.textContent.toLowerCase().includes(query);const filterMatch=Object.entries(filters).every(([key,value])=>!value||row.dataset[key]===value);row.hidden=!(textMatch&&filterMatch);});
    }
    function initializeSopCatalogFilters() {
        document.getElementById("sop-search-box")?.addEventListener("input",applySopCatalogFilters);
        ["filter-area","filter-process","filter-series","filter-model","filter-part-name","filter-created-by","filter-status"].forEach(id=>document.getElementById(id)?.addEventListener("change",applySopCatalogFilters));
        document.getElementById("clear-sop-filters")?.addEventListener("click",()=>{const search=document.getElementById("sop-search-box");if(search)search.value="";["filter-area","filter-process","filter-series","filter-model","filter-part-name","filter-created-by","filter-status"].forEach(id=>{const select=document.getElementById(id);if(select)select.value="";});applySopCatalogFilters();});
        document.querySelectorAll("[data-table-search]").forEach(input=>input.addEventListener("input",()=>{const body=document.getElementById(input.dataset.tableSearch);const query=input.value.trim().toLowerCase();body?.querySelectorAll("tr").forEach(row=>row.hidden=Boolean(query)&&!row.textContent.toLowerCase().includes(query));}));
        document.addEventListener("click",event=>{const row=event.target.closest("#sop-catalog-body .catalog-clickable-row");if(row&&!event.target.closest("button,a,input,select,textarea,label"))viewSop(row.dataset.sopId);});
        document.addEventListener("keydown",event=>{const row=event.target.closest("#sop-catalog-body .catalog-clickable-row");if(row&&(event.key==="Enter"||event.key===" ")){event.preventDefault();viewSop(row.dataset.sopId);}});
    }
    function formatDate(dateString) {
        if (!dateString) return "";
        return new Date(dateString).toLocaleDateString("en-US");
    }
    function initializeCatalogSorting() {
        document.querySelectorAll(".catalog-table table").forEach(table => table.querySelectorAll("thead th").forEach((header,index) => {
            header.title = "Sort by " + header.textContent.trim(); header.setAttribute("aria-sort","none");
            header.addEventListener("click", () => { const body=table.tBodies[0]; if(!body)return; const direction=header.dataset.sortDirection==="A-Z"?"Z-A":"A-Z"; table.querySelectorAll("thead th").forEach(item=>{delete item.dataset.sortDirection;item.setAttribute("aria-sort","none");}); header.dataset.sortDirection=direction;header.setAttribute("aria-sort",direction==="A-Z"?"ascending":"descending");
                const rows=[...body.rows].filter(row=>row.cells.length>1); rows.sort((a,b)=>{const av=(a.cells[index]?.innerText||"").trim(),bv=(b.cells[index]?.innerText||"").trim();const ad=Date.parse(av),bd=Date.parse(bv);const cmp=/date/i.test(header.textContent)&&!Number.isNaN(ad)&&!Number.isNaN(bd)?ad-bd:av.localeCompare(bv,undefined,{numeric:true,sensitivity:"base"});return direction==="A-Z"?cmp:-cmp;});rows.forEach(row=>body.appendChild(row));
            });
        }));
    }
    initializeSopCatalogFilters();
    initializeCatalogSorting();
    loadSopCatalog();
    loadMyDrafts();
    document.querySelectorAll('[data-section="sop-drafts"]').forEach(button => button.addEventListener("click", loadMyDrafts));

    function openSopModal() {
        document.getElementById("sop-modal").classList.remove("hidden");
    }
    function closeSopModal() {
        document.getElementById("sop-modal").classList.add("hidden");
    }
    document.getElementById("sop-modal-close").addEventListener("click", closeSopModal);
    document.getElementById("sop-modal-close-footer").addEventListener("click", closeSopModal);
    document.querySelector(".sop-modal-overlay").addEventListener("click", closeSopModal);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSopModal();
        }
    });

    async function viewSop(sopId) {
        const modalBody = document.querySelector(".sop-modal-body");
        modalBody.innerHTML = "<p>Loading...</p>";
        openSopModal();
        const { data, error } = await supabaseClient
            .from("sop_documents")
            .select(`
                id,
                sop_code,
                part_number,
                operation_name,
                created_at,
                workshops (
                    name,
                    code
                ),
                process_areas (
                    name,
                    code
                ),
                models (
                    name,
                    model_series (
                        name,
                        code
                    )
                ),
                part_names (
                    name,
                    code
                ),
                sop_revisions (
                    revision_number,
                    revision_code,
                    description,
                    status,
                    created_at,
                    released_at
                )
            `)
            .eq("id", sopId)
            .single();
        if (error) {
            console.error("Error loading SOP:", error);
            modalBody.innerHTML = "<p>Error loading SOP information.</p>";
            return;
        }
        renderSopModal(data);
        document.getElementById("sop-modal").dataset.sop = JSON.stringify(data);
        await renderSopWorkflowHistory(sopId);
    }

    async function renderSopWorkflowHistory(sopId) {
        const modalBody = document.querySelector(".sop-modal-body");
        try {
            const { data: instances, error: instanceError } = await supabaseClient
                .from("workflow_instances").select("id,status,started_at,completed_at")
                .eq("source_document_id", Number(sopId)).order("started_at", { ascending: false });
            if (instanceError) throw instanceError;
            const instanceIds = (instances || []).map(item => item.id);
            let history = [];
            if (instanceIds.length) {
                const { data, error } = await supabaseClient.from("workflow_history")
                    .select("instance_id,task_id,event_type,from_status,to_status,created_at,details")
                    .in("instance_id", instanceIds).order("created_at", { ascending: true });
                if (error) throw error;
                history = data || [];
            }
            const taskIds = [...new Set(history.map(item => item.task_id).filter(Boolean))];
            let taskNodeMap = new Map();
            if (taskIds.length) {
                const { data: tasks, error: taskError } = await supabaseClient.from("workflow_tasks").select("id,node_id").in("id", taskIds);
                if (taskError) throw taskError;
                const nodeIds = [...new Set((tasks || []).map(task => task.node_id).filter(Boolean))];
                const { data: nodes, error: nodeError } = nodeIds.length ? await supabaseClient.from("workflow_nodes").select("id,label,node_type").in("id", nodeIds) : { data: [], error: null };
                if (nodeError) throw nodeError;
                const nodeMap = new Map((nodes || []).map(node => [String(node.id), node]));
                taskNodeMap = new Map((tasks || []).map(task => [String(task.id), nodeMap.get(String(task.node_id)) || {}]));
            }
            const events = history.map(item => {
                const node = taskNodeMap.get(String(item.task_id)) || {};
                const raw = [node.label, item.event_type, item.to_status].filter(Boolean).join(" ").toLowerCase().replace(/[_-]+/g, " ");
                const label = raw.includes("validat") ? "Validated" : raw.includes("reject") ? "Rejected" : raw.includes("approv") ? "Approved" : raw.includes("complet") || raw.includes("finish") || raw.includes("release") ? "Completed" : raw.replace(/\b\w/g, char => char.toUpperCase());
                return { label: label || "Workflow update", date: item.created_at, details: item.details || {} };
            });
            (instances || []).forEach(item => {
                const status = String(item.status || "").toLowerCase();
                if (status === "completed" || status === "rejected") events.push({
                    label: status === "completed" ? "Completed" : "Rejected",
                    date: item.completed_at || item.started_at,
                    details: {}
                });
            });
            const uniqueEvents = [...new Map(events.map(item => [String(item.label)+"|"+String(item.date), item])).values()]
                .sort((a,b) => new Date(a.date || 0) - new Date(b.date || 0));
            const section = document.createElement("section");
            section.className = "sop-workflow-detail";
            section.innerHTML = '<h3>Workflow History</h3>';
            if (!uniqueEvents.length) {
                section.insertAdjacentHTML("beforeend", '<p>No validation, rejection, or completion events recorded yet.</p>');
            } else {
                const list = document.createElement("ol");
                list.className = "workflow-history-list";
                uniqueEvents.forEach(item => {
                    const li = document.createElement("li");
                    const title = document.createElement("strong");
                    title.textContent = item.label || "Workflow update";
                    li.appendChild(title);
                    if (item.date) {
                        const date = document.createElement("small");
                        date.textContent = " · " + formatDate(item.date);
                        li.appendChild(date);
                    }
                    const comment = item.details?.comments || item.details?.comment || item.details?.reason;
                    if (comment) {
                        const p = document.createElement("p");
                        p.textContent = String(comment);
                        li.appendChild(p);
                    }
                    list.appendChild(li);
                });
                section.appendChild(list);
            }
            modalBody.appendChild(section);
        } catch (error) {
            console.warn("Unable to load SOP workflow history:", error);
            const section = document.createElement("section");
            section.className = "sop-workflow-detail";
            section.innerHTML = '<h3>Workflow History</h3><p>Workflow history is unavailable for this SOP.</p>';
            modalBody.appendChild(section);
        }
    }


    function renderSopModal(sop) {
        const modalBody = document.querySelector(".sop-modal-body");
        const revisions = sop.sop_revisions || [];
        const currentRevision = revisions
            .sort((a, b) => b.revision_number - a.revision_number)[0];
        const orderedRevisions = [...revisions].sort((a, b) => (Number(b.revision_number) || 0) - (Number(a.revision_number) || 0));
        const revisionHistoryHtml = orderedRevisions.length > 1 ? `
            <details class="sop-revision-history">
                <summary>Revision History (${orderedRevisions.length})</summary>
                <div class="sop-revision-history-list">
                    ${orderedRevisions.map(revision => `
                        <details class="sop-revision-history-item">
                            <summary>
                                <strong>${renderRevisionBadge(revision.revision_code, revision.status)}</strong>
                                <span class="status-badge status-${statusKey(revision.status)}">${escapeHtml(statusLabel(revision.status))}</span>
                                <small>${escapeHtml(formatDate(revision.released_at || revision.created_at))}</small>
                            </summary>
                            <div class="sop-revision-history-details">
                                <p><strong>Change Summary</strong></p>
                                <p>${escapeHtml(revision.description || "No change summary recorded.")}</p>
                                <p><strong>Status:</strong> ${renderStatusBadge(revision.status)}</p>
                                <p><strong>Created:</strong> ${escapeHtml(formatDate(revision.created_at))}</p>
                                ${revision.released_at ? `<p><strong>Released:</strong> ${escapeHtml(formatDate(revision.released_at))}</p>` : ""}
                            </div>
                        </details>
                    `).join("")}
                </div>
            </details>
        ` : "";
        modalBody.innerHTML = `
            ${revisionHistoryHtml}
            <div class="sop-modal-grid">
                <div class="sop-modal-field">
                    <span>SOP Code</span>
                    <strong>${sop.sop_code || "Unassigned"}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Revision</span>
                    <strong>${renderRevisionBadge(currentRevision?.revision_code, currentRevision?.status)}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Workshop</span>
                    <strong>${sop.workshops?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Process Area</span>
                    <strong>${sop.process_areas?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Model Series</span>
                    <strong>${sop.models?.model_series?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Model</span>
                    <strong>${sop.models?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Part Name</span>
                    <strong>${sop.part_names?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Part Number</span>
                    <strong>${sop.part_number || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Operation Name</span>
                    <strong>${sop.operation_name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Status</span>
                    <strong>${currentRevision?.status || ""}</strong>
                </div>
                <div class="sop-modal-field sop-modal-field-full">
                    <span>Description</span>
                    <p>${currentRevision?.description || ""}</p>
                </div>
                ${String(currentRevision?.status || "").toLowerCase() === "released" ? `
                    <div class="sop-modal-actions">
                        <button type="button" class="remark-button modal-revision-button" data-sop-id="${sop.id}">
                            Revision
                        </button>
                    </div>
                ` : ""}
            </div>
        `;
    }

    function openRevisionModal(sop) {
        const modalBody = document.querySelector(".sop-modal-body");
        const revisions = sop.sop_revisions || [];
        const currentRevision = revisions
            .sort((a, b) => b.revision_number - a.revision_number)[0];
        const currentRevisionNumber = currentRevision?.revision_number ?? 0;
        const nextRevisionNumber = currentRevisionNumber + 1;
        const currentRevisionCode = currentRevision?.revision_code || `R${String(currentRevisionNumber).padStart(2, "0")}`;
        const nextRevisionCode = `R${String(nextRevisionNumber).padStart(2, "0")}`;
        modalBody.innerHTML = `
            <div class="sop-revision-header">
                <h3>Revision Information</h3>
                <p>Create a new revision for this SOP.</p>
            </div>
            <div class="sop-modal-grid">
                <div class="sop-modal-field">
                    <span>SOP Code</span>
                    <strong>${sop.sop_code}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Current Revision</span>
                    <strong>${currentRevisionCode}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>New Revision</span>
                    <strong>${nextRevisionCode}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Workshop</span>
                    <strong>${sop.workshops?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Process Area</span>
                    <strong>${sop.process_areas?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Model Series</span>
                    <strong>${sop.models?.model_series?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Model</span>
                    <strong>${sop.models?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Part Name</span>
                    <strong>${sop.part_names?.name || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Part Number</span>
                    <strong>${sop.part_number || ""}</strong>
                </div>
                <div class="sop-modal-field">
                    <span>Operation Name</span>
                    <strong>${sop.operation_name || ""}</strong>
                </div>
            </div>
            <div class="sop-revision-section">
                <label for="revision-change-summary">Change Summary</label>
                <textarea id="revision-change-summary" rows="5" placeholder="Describe what changed in this revision."></textarea>
            </div>
            <div class="sop-revision-section">
                <label for="revision-file">New SOP File</label>
                <input type="file" id="revision-file" accept=".pdf,.xlsx,.xls,.docx,.doc">
                <small>Upload the updated SOP document.</small>
            </div>
            <div class="sop-modal-actions">
                <button type="button" class="secondary-button" id="revision-cancel-button">Cancel</button>
                <button type="button" class="primary-button" id="create-revision-button" data-sop-id="${sop.id}">
                    Create Revision
                </button>
            </div>
        `;
    }



    document.addEventListener("click", async event => {
        const viewButton = event.target.closest(".view-sop-button");
        if (viewButton) {
            viewSop(viewButton.dataset.sopId);
            return;
        }
        const revisionButton = event.target.closest(".modal-revision-button");
        if (revisionButton) {
            const modal = document.getElementById("sop-modal");
            const sop = JSON.parse(modal.dataset.sop);
            openRevisionModal(sop);
            return;
        }
        const cancelRevisionButton = event.target.closest("#revision-cancel-button");
        if (cancelRevisionButton) {
            const modal = document.getElementById("sop-modal");
            const sop = JSON.parse(modal.dataset.sop);
            renderSopModal(sop);
            return;
        }
        const createRevisionButton = event.target.closest("#create-revision-button");
        if (createRevisionButton) {
            const modal = document.getElementById("sop-modal");
            const sop = JSON.parse(modal.dataset.sop || "null");
            const summaryInput = document.getElementById("revision-change-summary");
            const changeSummary = String(summaryInput?.value || "").trim();
            if (!sop?.id) {
                alert("Could not identify the SOP for this revision. Close the window and try again.");
                return;
            }
            if (!changeSummary) {
                summaryInput?.focus();
                alert("Enter a Change Summary before creating the revision.");
                return;
            }
            createRevisionButton.disabled = true;
            createRevisionButton.textContent = "Creating...";
            try {
                const { data: authResult, error: authError } = await supabaseClient.auth.getUser();
                if (authError) throw authError;
                const userId = authResult?.user?.id;
                if (!userId) throw new Error("Please sign in again before creating a revision.");
                const { data: revisionData, error: revisionError } = await supabaseClient.rpc("create_sop_revision", {
                    p_sop_id: Number(sop.id),
                    p_change_summary: changeSummary,
                    p_created_by: userId
                });
                if (revisionError) throw revisionError;
                const createdRevision = Array.isArray(revisionData) ? revisionData[0] : revisionData;
                if (!createdRevision?.revision_code) {
                    console.error("Unexpected create_sop_revision response:", revisionData);
                    throw new Error("Revision creation returned an unexpected response.");
                }
                const { data: revisionRecord, error: revisionLookupError } = await supabaseClient
                    .from("sop_revisions")
                    .select("id")
                    .eq("sop_id", Number(sop.id))
                    .eq("revision_code", createdRevision.revision_code)
                    .single();
                if (revisionLookupError) throw revisionLookupError;
                const { error: workflowError } = await supabaseClient.rpc("workflow_start_instance", {
                    p_definition_id: 1,
                    p_source_document_id: Number(sop.id),
                    p_source_revision_id: Number(revisionRecord.id),
                    p_metadata: { source: "sop_revision_modal", submitted_from: "Create Revision" }
                });
                closeSopModal();
                await Promise.all([loadSopCatalog(), loadMyDrafts(), refreshWorkflowCounts()]);
                if (workflowError) {
                    alert("Revision " + createdRevision.revision_code + " was created, but submission failed: " + workflowError.message + ". It remains Draft. Check My Drafts to retry.");
                } else {
                    alert("Revision " + createdRevision.revision_code + " was created and submitted for validation.");
                }
            } catch (error) {
                console.error("Error creating SOP revision:", error);
                alert("Could not create the revision: " + (error?.message || "Check the browser console for details."));
                createRevisionButton.disabled = false;
                createRevisionButton.textContent = "Create Revision";
            }
            return;
        }
    });

}
