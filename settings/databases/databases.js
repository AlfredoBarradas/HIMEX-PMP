
// ============================================
// STATE
// ============================================

let currentTable = "";
let currentRecords = [];

const TABLE_CONFIG = {
    model_series: {
        label: "Model Series",
        nameColumn: "name"
    },
    models: {
        label: "Models",
        nameColumn: "size_model"
    },
    part_names: {
        label: "Part Names",
        nameColumn: "part_name"
    },
    process_areas: {
        label: "Process areas",
        nameColumn: "name"
    },
    workshops: {
        label: "Workshops",
        nameColumn: "name"
    },
};


// ============================================
// TABLE SELECTOR
// ============================================

function initializeTableSelector() {
    const selector = document.getElementById("table-selector");

    if (!selector) return;

    selector.innerHTML = `
        <option value="">
            Select a table...
        </option>
    `;

    Object.entries(TABLE_CONFIG).forEach(([tableName, config]) => {
        const option = document.createElement("option");

        option.value = tableName;
        option.textContent = config.label;

        selector.appendChild(option);
    });
}


// ============================================
// LOAD TABLE
// ============================================

async function loadTable(tableName) {
    const tableHeader = document.getElementById("table-header");
    const tableBody = document.getElementById("table-body");

    if (!tableName || !tableHeader || !tableBody) return;

    currentTable = tableName;

    tableHeader.innerHTML = "";
    tableBody.innerHTML = `
        <tr><td>Loading...</td></tr>
    `;

    const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .order("id");

    if (error) {
        console.error("Error loading table:", error);
        tableBody.innerHTML = `
            <tr><td>Unable to load records.</td></tr>
        `;
        return;
    }

    currentRecords = data ?? [];

    renderTable();
}


// ============================================
// RENDER TABLE
// ============================================

function renderTable() {
    const tableHeader = document.getElementById("table-header");
    const tableBody = document.getElementById("table-body");

    tableHeader.innerHTML = "";
    tableBody.innerHTML = "";

    if (!currentRecords.length) {
        tableBody.innerHTML = `
            <tr><td>No records found.</td></tr>
        `;
        return;
    }

    const columns = Object.keys(currentRecords[0]);

    const headerRow = document.createElement("tr");

    columns.forEach(column => {
        const th = document.createElement("th");
        th.textContent = column;
        headerRow.appendChild(th);
    });

    const actionsHeader = document.createElement("th");
    actionsHeader.textContent = "Actions";
    headerRow.appendChild(actionsHeader);

    tableHeader.appendChild(headerRow);

    currentRecords.forEach(record => {
        const row = document.createElement("tr");

        columns.forEach(column => {
            const cell = document.createElement("td");
            const value = record[column];

            cell.textContent =
                value === null ? "" :
                typeof value === "object" ? JSON.stringify(value) :
                String(value);

            row.appendChild(cell);
        });

        const actionsCell = document.createElement("td");

        if (typeof record.active === "boolean") {
            const button = document.createElement("button");

            button.type = "button";
            button.dataset.recordId = record.id;
            button.dataset.action = record.active ? "disable" : "enable";
            button.textContent = record.active ? "Disable" : "Enable";

            actionsCell.appendChild(button);
        }

        row.appendChild(actionsCell);
        tableBody.appendChild(row);
    });
}


// ============================================
// EDIT STATUS
// ============================================

async function editStatus({
    tableName,
    recordId,
    status,
    recordName,
    reload
}) {
    if (typeof status !== "boolean") {
        throw new Error("Status must be a boolean.");
    }

    const action = status ? "enable" : "disable";

    const confirmed = window.confirm(
        `${action.charAt(0).toUpperCase() + action.slice(1)} ${recordName}?`
    );

    if (!confirmed) return;

    const { data, error } = await supabaseClient.rpc("edit_status", {
        p_table_name: tableName,
        p_record_id: recordId,
        p_status: status
    });

    if (error) {
        console.error(`Error ${action}ing record:`, error);
        window.alert(error.message || `Unable to ${action} record.`);
        return;
    }

    if (typeof reload === "function") {
        await reload();
    }

    return true;
}


// ============================================
// CREATE RECORDS
// ============================================

async function createRecord(tableName, recordData) {
    const { error } = await supabaseClient
        .from(tableName)
        .insert(recordData);

    if (error) {
        console.error("Error creating record:", error);
        return false;
    }

    await loadTable(tableName);
    return true;
}

// ============================================
// EVENT LISTENERS
// ============================================

function initializeEvents() {
    const selector = document.getElementById("table-selector");
    const tableBody = document.getElementById("table-body");

    selector?.addEventListener("change", async event => {
        await loadTable(event.target.value);
    });

    tableBody?.addEventListener("click", async event => {
        const button = event.target.closest("button");

        if (!button) return;

        const recordId = Number(button.dataset.recordId);
        const action = button.dataset.action;

        const record = currentRecords.find(
            item => item.id === recordId
        );

        if (!record) return;

        const config = TABLE_CONFIG[currentTable];

        await editStatus({
            tableName: currentTable,
            recordId,
            status: action === "enable",
            recordName: `${currentTable}: ${record[config.nameColumn]}`,
            reload: () => loadTable(currentTable)
        });
    });
}


// ============================================
// INITIALIZATION
// ============================================

async function initializePage() {
    const authData = await requireAuth();

    if (!authData?.user) {
        window.location.replace("/auth/");
        return;
    }

    if (!isAdmin()) {
        window.location.replace("/");
        return;
    }

    initializeTableSelector();
    initializeEvents();

    document.body.classList.remove("auth-pending");
}

(async () => {
    await initializePage();
})();
