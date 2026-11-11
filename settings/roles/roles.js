    let roles = [];
    let permissions = [];
    let editingRoleId = null;


    async function initializeData() {
        await loadRoles();
        await loadPermissions();
    }


    async function loadRoles() {
        const tableBody = document.getElementById("roles-table-body");

        if (!tableBody) {
            return;
        }

        tableBody.innerHTML = `
            <tr>
                <td colspan="4">Loading roles...</td>
            </tr>
        `;

        const { data, error } = await supabaseClient
            .from("roles")
            .select(`
                id,
                code,
                name,
                description,
                active
            `)
            .order("name");

        if (error) {
            console.error("Error loading roles:", error);
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4">Unable to load roles.</td>
                </tr>
            `;
            return;
        }

        roles = data ?? [];
        console.log("Roles loaded:", roles);
        renderRoles();
    }

    function renderRoles() {
        const tableBody = document.getElementById("roles-table-body");
        if (!tableBody) {
            return;
        }
        if (!roles.length) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4">No roles found.</td>
                </tr>
            `;
            return;
        }
        tableBody.innerHTML = "";
        roles.forEach(role => {
            const row = document.createElement("tr");
            const nameCell = document.createElement("td");
            nameCell.textContent = role.name;
            const descriptionCell = document.createElement("td");
            descriptionCell.textContent = role.description ?? "";
            const statusCell = document.createElement("td");
            const status = document.createElement("span");
            status.className = `role-status ${role.active ? "active" : "inactive"}`;
            status.textContent = role.active ? "Active" : "Inactive";
            statusCell.appendChild(status);
            const actionsCell = document.createElement("td");
            const actions = document.createElement("div");
            actions.className = "role-actions";
            if (role.code === "admin" || role.code === "user") {
                const protectedLabel = document.createElement("span");
                protectedLabel.textContent = "Protected";
                actions.appendChild(protectedLabel);
            } else if (role.active) {
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.dataset.action = "edit-role";
                editButton.dataset.roleId = role.id;
                editButton.textContent = "Edit";
                actions.appendChild(editButton);
                const disableButton = document.createElement("button");
                disableButton.type = "button";
                disableButton.dataset.action = "disable-role";
                disableButton.dataset.roleId = role.id;
                disableButton.textContent = "Disable";
                actions.appendChild(disableButton);
            } else {
                const enableButton = document.createElement("button");
                enableButton.type = "button";
                enableButton.dataset.action = "enable-role";
                enableButton.dataset.roleId = role.id;
                enableButton.textContent = "Enable";
                actions.appendChild(enableButton);
            }
            actionsCell.appendChild(actions);
            row.appendChild(nameCell);
            row.appendChild(descriptionCell);
            row.appendChild(statusCell);
            row.appendChild(actionsCell);
            tableBody.appendChild(row);
        });
    }

    async function loadPermissions() {
        const container = document.getElementById("permissions-container");

        if (!container) {
            return;
        }

        container.innerHTML = "<p>Loading permissions...</p>";

        const { data, error } = await supabaseClient
            .from("permissions")
            .select(`
                id,
                code,
                name,
                module,
                action,
                description
            `)
            .order("module")
            .order("action");

        if (error) {
            console.error("Error loading permissions:", error);
            container.innerHTML = "<p>Unable to load permissions.</p>";
            return;
        }

        permissions = data ?? [];
        renderPermissions();
    }

    function renderPermissions() {
        const container = document.getElementById("permissions-container");

        if (!container) {
            return;
        }

        if (!permissions.length) {
            container.innerHTML = "<p>No permissions found.</p>";
            return;
        }

        const groupedPermissions = permissions.reduce((groups, permission) => {
            if (!groups[permission.module]) {
                groups[permission.module] = [];
            }

            groups[permission.module].push(permission);

            return groups;
        }, {});

        container.innerHTML = Object.entries(groupedPermissions)
            .map(([module, modulePermissions]) => {
                return `
                    <div class="permission-module">
                        <div class="permission-module-header">
                            ${escapeHtml(module)}
                        </div>

                        <div class="permission-list">
                            ${modulePermissions.map(permission => {
                                return `
                                    <div class="permission-item">
                                        <input
                                            type="checkbox"
                                            id="permission-${permission.id}"
                                            value="${permission.id}"
                                            data-permission-id="${permission.id}"
                                            data-permission-code="${escapeHtml(permission.code)}"
                                        >
                                        <label for="permission-${permission.id}">
                                            ${escapeHtml(permission.name)}
                                        </label>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                `;
            })
            .join("");
    }

    function initializeEvents() {
        const createButton = document.getElementById("create-role-button");
        const closeButton = document.getElementById("close-role-modal");
        const cancelButton = document.getElementById("cancel-role-button");
        const overlay = document.getElementById("role-modal-overlay");
        const form = document.getElementById("role-form");
        const clearButton = document.getElementById("clear-permissions-button");
        const tableBody = document.getElementById("roles-table-body");
        const permissionsContainer = document.getElementById("permissions-container");

        permissionsContainer?.addEventListener("change", event => {
            const checkbox = event.target.closest("input[data-permission-code]");
            if (!checkbox) return;
            if (checkbox.dataset.permissionCode === "documents.sop.create") {
                syncSopWorkflowPermission();
            } else if (checkbox.dataset.permissionCode === "workflow.instances.start") {
                const createCheckbox = permissionsContainer.querySelector('input[data-permission-code="documents.sop.create"]');
                if (createCheckbox?.checked) checkbox.checked = true;
            }
        });

        createButton?.addEventListener("click", () => {
            openCreateRoleModal();
        });

        closeButton?.addEventListener("click", closeRoleModal);
        cancelButton?.addEventListener("click", closeRoleModal);
        overlay?.addEventListener("click", closeRoleModal);

        clearButton?.addEventListener("click", clearPermissions);

        form?.addEventListener("submit", handleRoleSubmit);

        tableBody?.addEventListener("click", event => {
            const button = event.target.closest("button");

            if (!button) {
                return;
            }

            const roleId = Number(button.dataset.roleId);
            const action = button.dataset.action;

            if (action === "edit-role") {
                openEditRoleModal(roleId);
                return;
            }

            if (action === "disable-role") {
                disableRole(roleId);
            }

            if (action === "enable-role") {
                enableRole(roleId);
            }
        });
    }

    function openCreateRoleModal() {
        editingRoleId = null;

        document.getElementById("role-modal-title").textContent = "Create Role";
        document.getElementById("save-role-button").textContent = "Create Role";
        document.getElementById("role-id").value = "";
        document.getElementById("role-name").value = "";
        document.getElementById("role-description").value = "";

        clearPermissions();
        clearFormMessage();

        document.getElementById("role-modal").classList.remove("hidden");
        document.getElementById("role-name").focus();
    }

    async function openEditRoleModal(roleId) {
        const role = roles.find(item => item.id === roleId);

        if (!role) {
            return;
        }

        editingRoleId = role.id;

        document.getElementById("role-modal-title").textContent = "Edit Role";
        document.getElementById("save-role-button").textContent = "Save Changes";
        document.getElementById("role-id").value = role.id;
        document.getElementById("role-name").value = role.name;
        document.getElementById("role-description").value = role.description ?? "";

        clearPermissions();
        clearFormMessage();

        const modal = document.getElementById("role-modal");

        modal.classList.remove("hidden");

        try {
            const rolePermissions = await loadRolePermissions(role.id);

            rolePermissions.forEach(permission => {
                const checkbox = document.querySelector(
                    `#permissions-container input[data-permission-id="${permission.permission_id}"]`
                );

                if (checkbox) {
                    checkbox.checked = true;
                }
            });
            syncSopWorkflowPermission();
        } catch (error) {
            showFormMessage(
                "Unable to load role permissions.",
                "error"
            );
        }

        document.getElementById("role-name").focus();
    }

    function closeRoleModal() {
        document.getElementById("role-modal").classList.add("hidden");
        editingRoleId = null;
        clearFormMessage();
    }

    function clearPermissions() {
        document
            .querySelectorAll("#permissions-container input[type='checkbox']")
            .forEach(checkbox => {
                checkbox.checked = false;
                checkbox.disabled = false;
                delete checkbox.dataset.autoAddedBySopCreate;
            });
    }

    function syncSopWorkflowPermission() {
        const createCheckbox = document.querySelector('#permissions-container input[data-permission-code="documents.sop.create"]');
        const startCheckbox = document.querySelector('#permissions-container input[data-permission-code="workflow.instances.start"]');
        if (!createCheckbox || !startCheckbox) return;
        if (createCheckbox.checked) {
            if (!startCheckbox.checked) startCheckbox.dataset.autoAddedBySopCreate = "true";
            startCheckbox.checked = true;
            startCheckbox.disabled = true;
            startCheckbox.title = "Automatically included because this role can create SOPs.";
        } else {
            if (startCheckbox.dataset.autoAddedBySopCreate === "true") startCheckbox.checked = false;
            delete startCheckbox.dataset.autoAddedBySopCreate;
            startCheckbox.disabled = false;
            startCheckbox.title = "";
        }
    }

    async function handleRoleSubmit(event) {
        event.preventDefault();

        const name = document.getElementById("role-name").value.trim();
        const description = document.getElementById("role-description").value.trim();
        const button = document.getElementById("save-role-button");

        clearFormMessage();

        if (!name) {
            showFormMessage("Role name is required.", "error");
            return;
        }

        const permissionIds = Array.from(
            document.querySelectorAll(
                "#permissions-container input[type='checkbox']:checked"
            )
        ).map(checkbox => Number(checkbox.value));

        button.disabled = true;

        try {
            if (editingRoleId) {
                const { error } = await supabaseClient.rpc("update_role", {
                    p_role_id: editingRoleId,
                    p_name: name,
                    p_description: description || null,
                    p_permission_ids: permissionIds
                });

                if (error) {
                    throw error;
                }

                showFormMessage("Role updated successfully.", "success");
            } else {
                const { error } = await supabaseClient.rpc("create_role", {
                    p_name: name,
                    p_description: description || null,
                    p_permission_ids: permissionIds
                });

                if (error) {
                    throw error;
                }

                showFormMessage("Role created successfully.", "success");
            }

            await loadRoles();

            setTimeout(() => {
                closeRoleModal();
            }, 500);
        } catch (error) {
            console.error("Error saving role:", error);
            showFormMessage(
                error.message || "Unable to save role.",
                "error"
            );
        } finally {
            button.disabled = false;
        }
    }

    function showFormMessage(message, type) {
        const element = document.getElementById("role-form-message");

        if (!element) {
            return;
        }

        element.textContent = message;
        element.className = `form-message ${type}`;
    }

    function clearFormMessage() {
        const element = document.getElementById("role-form-message");

        if (!element) {
            return;
        }

        element.textContent = "";
        element.className = "form-message";
    }

    function escapeHtml(value) {
        const element = document.createElement("div");
        element.textContent = value;
        return element.innerHTML;
    }

    async function loadRolePermissions(roleId) {
        const { data, error } = await supabaseClient
            .from("role_permissions")
            .select("permission_id")
            .eq("role_id", roleId);

        if (error) {
            console.error("Error loading role permissions:", error);
            throw error;
        }

        return data ?? [];
    }


    async function disableRole(roleId) {
        const role = roles.find(item => item.id === roleId);

        if (!role) {
            return;
        }

        const confirmed = window.confirm(
            `Disable the role "${role.name}"?`
        );

        if (!confirmed) {
            return;
        }

        const { error } = await supabaseClient.rpc("disable_role", {
            p_role_id: roleId
        });

        if (error) {
            console.error("Error disabling role:", error);
            window.alert(error.message || "Unable to disable role.");
            return;
        }

        await loadRoles();
    }

    async function enableRole(roleId) {
        const role = roles.find(item => item.id === roleId);
        if (!role) {
            return;
        }
        const confirmed = window.confirm(`Enable the role "${role.name}"?`);
        if (!confirmed) {
            return;
        }
        const { error } = await supabaseClient.rpc("enable_role", {
            p_role_id: roleId
        });
        if (error) {
            console.error("Error enabling role:", error);
            window.alert(error.message || "Unable to enable role.");
            return;
        }
        await loadRoles();
    }



window.PMPModules = window.PMPModules || {};
window.PMPModules.Roles = {
    async mount() {
        await initializeData();
        initializeEvents();
    },
    async unmount() {}
};
