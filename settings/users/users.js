    let users = [];
    let editingUserId = null;
    let usersModuleController = null;
    async function initializeData() {
        await Promise.all([loadUsers(), loadRoles()]);
    }
    async function loadUsers() {
        const tableBody = document.getElementById("users-table-body");
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="5">Loading users...</td></tr>`;
        const { data, error } = await supabaseClient.from("user_profiles").select(`
            id, employee_number, full_name, active, must_change_password, role_id,
            roles (id, code, name, active)
        `).order("employee_number");
        if (error) {
            console.error("Error loading users:", error);
            tableBody.innerHTML = `<tr><td colspan="5">Unable to load users.</td></tr>`;
            return;
        }
        users = data ?? [];
        renderUsers();
    }
    async function loadRoles() {
        const roleSelect = document.getElementById("user-role");
        if (!roleSelect) return;
        roleSelect.innerHTML = `<option value="">Loading roles...</option>`;
        const { data, error } = await supabaseClient.from("roles").select("id, name, active").eq("active", true).order("name");
        if (error) {
            console.error("Error loading roles:", error);
            roleSelect.innerHTML = `<option value="">Unable to load roles</option>`;
            return;
        }
        roleSelect.innerHTML = `<option value="">Select a role</option>`;
        (data ?? []).forEach(role => {
            const option = document.createElement("option");
            option.value = role.id;
            option.textContent = role.name;
            roleSelect.appendChild(option);
        });
    }
    function initializeEvents(signal) {
        const createUserButton = document.getElementById("create-user-button");
        const closeUserButton = document.getElementById("close-user-modal");
        const cancelUserButton = document.getElementById("cancel-user-button");
        const userModal = document.getElementById("user-modal");

        const searchInput = document.getElementById("users-search-input");
        const clearSearchButton = document.getElementById("clear-users-search");
        searchInput?.addEventListener("input", () => {
            clearSearchButton.hidden = !searchInput.value;
            renderUsers();
        });
        clearSearchButton?.addEventListener("click", () => {
            searchInput.value = "";
            clearSearchButton.hidden = true;
            renderUsers();
            searchInput.focus();
        });

        document.getElementById("user-form")?.addEventListener("submit", handleUserSubmit);
        createUserButton?.addEventListener("click", openCreateModal);
        closeUserButton?.addEventListener("click", closeModal);
        cancelUserButton?.addEventListener("click", closeModal);
        userModal?.addEventListener("click", event => {
            if (event.target.dataset.action === "close-user-modal") closeModal();
        });

        document.getElementById("users-table-body")?.addEventListener("click", event => {
            const row = event.target.closest("tr[data-user-id]");
            if (!row) return;
            openUserActions(row.dataset.userId);
        });
        document.getElementById("close-actions-modal")?.addEventListener("click", closeActionsModal);
        document.getElementById("user-actions-modal")?.addEventListener("click", event => {
            if (event.target.dataset.action === "close-actions-modal") closeActionsModal();
        });
        document.querySelector(".user-actions-grid")?.addEventListener("click", event => {
            const button = event.target.closest("[data-user-action]");
            if (!button) return;
            handleUserAction(button.dataset.userAction);
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeActionsModal();
                closeModal();
                closeResetPasswordModal();
            }
        }, { signal });
        document.getElementById("reset-password-form")?.addEventListener("submit", handleResetPasswordSubmit);
        document.getElementById("close-reset-password")?.addEventListener("click", closeResetPasswordModal);
        document.getElementById("cancel-reset-password")?.addEventListener("click", closeResetPasswordModal);
        document.getElementById("reset-password-modal")?.addEventListener("click", event => {
            if (event.target.dataset.action === "close-reset-password") closeResetPasswordModal();
        });

    }


    function openUserActions(userId) {
        const user = users.find(item => item.id === userId);
        if (!user) return;
        const modal = document.getElementById("user-actions-modal");
        document.getElementById("actions-user-name").textContent = user.full_name || "Unnamed User";
        document.getElementById("actions-user-details").textContent =
            `Employee No. ${user.employee_number} · ${user.roles?.name ?? "No role"}`;
        document.getElementById("user-actions-message").textContent = "";
        document.getElementById("user-actions-message").style.color = "";
        document.getElementById("actions-user-initial").textContent =
            (user.full_name || user.employee_number || "U").trim().charAt(0).toUpperCase();
        modal.dataset.userId = user.id;
        document.querySelector('[data-user-action="deactivate"]').hidden = !user.active;
        document.querySelector('[data-user-action="activate"]').hidden = user.active;
        modal.classList.remove("hidden");
    }
    function closeActionsModal() {
        document.getElementById("user-actions-modal")?.classList.add("hidden");
    }


    async function handleUserAction(action) {
        const modal = document.getElementById("user-actions-modal");
        const userId = modal.dataset.userId;
        const user = users.find(item => item.id === userId);
        if (!user) return;
        if (action === "edit") {
            closeActionsModal();
            openEditModal(user.id);
            return;
        }

        if (action === "reset-password") {
            closeActionsModal();
            openResetPasswordModal(user);
            return;
        }

        if (action !== "activate" && action !== "deactivate") return;
        const isActivating = action === "activate";
        const actionLabel = isActivating ? "activate" : "deactivate";
        if (!window.confirm(`Are you sure you want to ${actionLabel} ${user.full_name} (${user.employee_number})?`)) return;
        const message = document.getElementById("user-actions-message");
        const actionButtons = modal.querySelectorAll("[data-user-action]");
        actionButtons.forEach(button => {
            button.disabled = true;
        });
        message.style.color = "";
        message.textContent = isActivating ? "Activating user..." : "Deactivating user...";
        try {
            const { error } = await supabaseClient.rpc(
                isActivating ? "enable_user" : "disable_user",
                { p_user_id: user.id }
            );
            if (error) throw error;
            await loadUsers();
            closeActionsModal();
        } catch (error) {
            console.error(`Error trying to ${actionLabel} user:`, error);
            message.style.color = "#fca5a5";
            message.textContent = error.message || `Unable to ${actionLabel} user.`;
        } finally {
            actionButtons.forEach(button => {
                button.disabled = false;
            });
        }
    }

    function openCreateModal() {
        editingUserId = null;
        const form = document.getElementById("user-form");
        form.reset();
        document.getElementById("user-modal-title").textContent = "Create User";
        document.getElementById("employee-number").disabled = false;
        document.getElementById("temporary-password-group").hidden = false;
        document.getElementById("temporary-password").required = true;
        document.getElementById("save-user-button").textContent = "Create User";
        document.getElementById("user-form-message").textContent = "";
        document.getElementById("user-form-message").style.color = "";
        document.getElementById("user-modal").classList.remove("hidden");
    }
    function openEditModal(userId) {
        const user = users.find(item => item.id === userId);
        if (!user) {
            console.error("User not found:", userId);
            return;
        }
        editingUserId = user.id;
        const form = document.getElementById("user-form");
        form.reset();
        document.getElementById("user-modal-title").textContent = "Edit User";
        document.getElementById("employee-number").value = user.employee_number;
        document.getElementById("employee-number").disabled = true;
        document.getElementById("full-name").value = user.full_name ?? "";
        const roleSelect = document.getElementById("user-role");
        const currentRoleExists = [...roleSelect.options].some(option => option.value === String(user.role_id));
        if (!currentRoleExists && user.roles) {
            const option = document.createElement("option");
            option.value = user.role_id;
            option.textContent = `${user.roles.name} (Inactive)`;
            roleSelect.appendChild(option);
        }
        roleSelect.value = String(user.role_id);
        document.getElementById("temporary-password-group").hidden = true;
        document.getElementById("temporary-password").required = false;
        document.getElementById("temporary-password").value = "";
        document.getElementById("save-user-button").textContent = "Save Changes";
        document.getElementById("user-form-message").textContent = "";
        document.getElementById("user-form-message").style.color = "";
        document.getElementById("user-modal").classList.remove("hidden");
    }
    function closeModal() {
        document.getElementById("user-modal")?.classList.add("hidden");
        editingUserId = null;
        document.getElementById("user-form")?.reset();
        document.getElementById("employee-number").disabled = false;
        document.getElementById("temporary-password-group").hidden = false;
        document.getElementById("temporary-password").required = true;
        document.getElementById("user-modal-title").textContent = "Create User";
        document.getElementById("save-user-button").textContent = "Create User";
        document.getElementById("user-form-message").textContent = "";
    }
    async function handleUserSubmit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const button = document.getElementById("save-user-button");
        const message = document.getElementById("user-form-message");
        const employeeNumber = document.getElementById("employee-number").value.trim();
        const fullName = document.getElementById("full-name").value.trim();
        const roleId = Number(document.getElementById("user-role").value);
        const password = document.getElementById("temporary-password").value;
        const isEditing = Boolean(editingUserId);
        message.textContent = "";
        message.style.color = "";
        if (!employeeNumber || !fullName || !roleId) {
            message.textContent = "Please complete all required fields.";
            return;
        }
        if (fullName.length > 150) {
            message.textContent = "Full name must be 150 characters or fewer.";
            return;
        }
        if (!isEditing && (!password || password.length < 8 || password.length >= 128)) {
            message.textContent = password.length >= 128
                ? "Password must be less than 128 characters."
                : "Password must be at least 8 characters.";
            return;
        }
        button.disabled = true;
        button.textContent = isEditing ? "Saving..." : "Creating...";
        try {
            let error;
            let data;
            if (isEditing) {
                ({ error } = await supabaseClient.rpc("update_user_details", {
                    p_user_id: editingUserId,
                    p_full_name: fullName,
                    p_role_id: roleId
                }));
                if (error) throw new Error(error.message || "Unable to update user.");
            } else {
                ({ data, error } = await supabaseClient.functions.invoke("create-user", {
                    body: {
                        employee_number: employeeNumber,
                        full_name: fullName,
                        role_id: roleId,
                        password
                    }
                }));
                if (error) {
                    let details = "";
                    try {
                        details = await error.context?.json?.().then(result => result.error || "").catch(() => "");
                    } catch {}
                    throw new Error(details || error.message || "Unable to create user.");
                }
                if (!data?.success) throw new Error(data?.error || "Unable to create user.");
            }
            message.textContent = isEditing ? "User updated successfully." : "User created successfully.";
            message.style.color = "#166534";
            await loadUsers();
            setTimeout(closeModal, 800);
        } catch (error) {
            console.error(isEditing ? "Error updating user:" : "Error creating user:", error);
            message.textContent = error.message || (isEditing ? "Unable to update user." : "Unable to create user.");
            message.style.color = "#991b1b";
        } finally {
            button.disabled = false;
            button.textContent = editingUserId ? "Save Changes" : "Create User";
        }
    }


    let resettingUserId = null;
    function openResetPasswordModal(user) {
        if (!user || !user.active) return;
        resettingUserId = user.id;
        document.getElementById("reset-password-form").reset();
        document.getElementById("reset-password-user-details").textContent =
            `Employee No. ${user.employee_number} · ${user.full_name}`;
        const message = document.getElementById("reset-password-message");
        message.textContent = "The user will be required to change this password at the next login.";
        message.style.color = "";
        document.getElementById("save-reset-password").disabled = false;
        document.getElementById("save-reset-password").textContent = "Reset Password";
        document.getElementById("reset-password-modal").classList.remove("hidden");
        document.getElementById("reset-password-input").focus();
    }
    function closeResetPasswordModal() {
        document.getElementById("reset-password-modal")?.classList.add("hidden");
        document.getElementById("reset-password-form")?.reset();
        document.getElementById("reset-password-message").textContent = "";
        resettingUserId = null;
    }
    
    async function handleResetPasswordSubmit(event) {
        event.preventDefault();
        if (!resettingUserId) return;
        const password = document.getElementById("reset-password-input").value;
        const confirmation = document.getElementById("reset-password-confirm").value;
        const message = document.getElementById("reset-password-message");
        const button = document.getElementById("save-reset-password");
        if (password.length < 8 || password.length >= 128) {
            message.textContent = "Password must contain between 8 and 127 characters.";
            message.style.color = "#991b1b";
            return;
        }
        if (password !== confirmation) {
            message.textContent = "Passwords do not match.";
            message.style.color = "#991b1b";
            return;
        }
        button.disabled = true;
        button.textContent = "Resetting...";
        message.textContent = "Updating password...";
        message.style.color = "";
        try {
            const { data, error } = await supabaseClient.functions.invoke("reset-user-password", {
                body: { user_id: resettingUserId, password }
            });
            if (error) {
                let details = "";
                try {
                    details = await error.context?.json?.().then(result => result.error || "").catch(() => "");
                } catch {}
                throw new Error(details || error.message || "Unable to reset password.");
            }
            if (!data?.success) throw new Error(data?.error || "Unable to reset password.");
            message.textContent = "Password reset successfully. The user must change it at next login.";
            message.style.color = "#166534";
            await loadUsers();
            setTimeout(closeResetPasswordModal, 1200);
        } catch (error) {
            console.error("Error resetting password:", error.message);
            message.textContent = "Unable to reset password. Check your connection and try again.";
            message.style.color = "#991b1b";
        } finally {
            button.disabled = false;
            button.textContent = "Reset Password";
        }
    }
    
    function renderUsers() {
        const tableBody = document.getElementById("users-table-body");
        if (!tableBody) return;
        const searchTerm = (document.getElementById("users-search-input")?.value ?? "").trim().toLocaleLowerCase();
        const filteredUsers = users.filter(user => {
            const searchableValues = [
                user.employee_number,
                user.full_name,
                user.roles?.name,
                user.active ? "active" : "inactive",
                user.active ? "activo" : "inactivo",
                user.active ? "habilitado" : "deshabilitado",
                user.must_change_password ? "password change pending" : "password updated"
            ];
            return searchableValues.some(value =>
                String(value ?? "").toLocaleLowerCase().includes(searchTerm)
            );
        });

        if (!filteredUsers.length) {
            tableBody.innerHTML = `<tr><td colspan="5">${users.length ? "No users match your search." : "No users found."}</td></tr>`;
            return;
        }

        tableBody.innerHTML = "";
        filteredUsers.forEach(user => {
            const row = document.createElement("tr");
            row.dataset.userId = user.id;
            row.tabIndex = 0;
            row.setAttribute("role", "button");
            row.setAttribute("aria-label", `Manage user ${user.full_name || user.employee_number}`);
            row.style.cursor = "pointer";
            row.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openUserActions(user.id);
                }
            });
            const employeeCell = document.createElement("td");
            employeeCell.textContent = user.employee_number;
            const nameCell = document.createElement("td");
            nameCell.textContent = user.full_name ?? "";
            const roleCell = document.createElement("td");
            roleCell.textContent = user.roles?.name ?? "No role";
            const statusCell = document.createElement("td");
            const status = document.createElement("span");
            status.className = `user-status ${user.active ? "active" : "inactive"}`;
            status.textContent = user.active ? "Active" : "Inactive";
            statusCell.appendChild(status);
            const actionsCell = document.createElement("td");
            actionsCell.textContent = "Manage";
            actionsCell.className = "user-manage-cell";
            row.append(employeeCell, nameCell, roleCell, statusCell, actionsCell);
            tableBody.appendChild(row);
        });
    }



window.PMPModules = window.PMPModules || {};
window.PMPModules.Users = {
    async mount() {
        usersModuleController?.abort();
        usersModuleController = new AbortController();
        await initializeData();
        initializeEvents(usersModuleController.signal);
    },
    async unmount() {
        usersModuleController?.abort();
        usersModuleController = null;
    }
};
