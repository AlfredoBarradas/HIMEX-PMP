/**
 * Shared workflow data and RPC service.
 *
 * This layer owns Supabase access for workflow entities and actions.
 * UI modules should consume this API instead of querying workflow tables
 * or invoking workflow RPCs directly.
 */
window.WorkflowService = (() => {
    const ensureClient = () => {
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            throw new Error("Supabase client is not initialized.");
        }
        return supabaseClient;
    };

    const emptyResult = () => ({ data: [], error: null });

    async function listInstances({
        documentTypeCode,
        sourceDocumentId,
        statuses,
        orderBy = "started_at",
        ascending = false,
        select = "*"
    } = {}) {
        let query = ensureClient()
            .from("workflow_instances")
            .select(select);

        if (documentTypeCode) {
            query = query.eq("document_type_code", documentTypeCode);
        }
        if (sourceDocumentId !== undefined && sourceDocumentId !== null) {
            query = query.eq("source_document_id", sourceDocumentId);
        }
        if (Array.isArray(statuses) && statuses.length) {
            query = query.in("status", statuses);
        }
        if (orderBy) {
            query = query.order(orderBy, { ascending });
        }
        return query;
    }

    async function getInstance({
        id,
        documentTypeCode,
        select = "*",
        single = true
    } = {}) {
        let query = ensureClient()
            .from("workflow_instances")
            .select(select)
            .eq("id", id);

        if (documentTypeCode) {
            query = query.eq("document_type_code", documentTypeCode);
        }
        return single ? query.single() : query.maybeSingle();
    }

    async function listTasks({
        instanceId,
        instanceIds,
        taskIds,
        orderBy = "created_at",
        ascending = true,
        select = "*"
    } = {}) {
        let query = ensureClient()
            .from("workflow_tasks")
            .select(select);

        if (instanceId !== undefined && instanceId !== null) {
            query = query.eq("instance_id", instanceId);
        } else if (Array.isArray(instanceIds)) {
            if (!instanceIds.length) return emptyResult();
            query = query.in("instance_id", instanceIds);
        }

        if (Array.isArray(taskIds)) {
            if (!taskIds.length) return emptyResult();
            query = query.in("id", taskIds);
        }
        if (orderBy) {
            query = query.order(orderBy, { ascending });
        }
        return query;
    }

    async function listNodes({ ids, select = "*" } = {}) {
        let query = ensureClient()
            .from("workflow_nodes")
            .select(select);

        if (Array.isArray(ids)) {
            if (!ids.length) return emptyResult();
            query = query.in("id", ids);
        }
        return query;
    }

    async function getNode({ id, select = "*" } = {}) {
        return ensureClient()
            .from("workflow_nodes")
            .select(select)
            .eq("id", id)
            .maybeSingle();
    }

    async function listHistory({
        instanceId,
        instanceIds,
        orderBy = "created_at",
        ascending = true,
        select = "*"
    } = {}) {
        let query = ensureClient()
            .from("workflow_history")
            .select(select);

        if (instanceId !== undefined && instanceId !== null) {
            query = query.eq("instance_id", instanceId);
        } else if (Array.isArray(instanceIds)) {
            if (!instanceIds.length) return emptyResult();
            query = query.in("instance_id", instanceIds);
        }
        if (orderBy) {
            query = query.order(orderBy, { ascending });
        }
        return query;
    }

    async function listTaskAssignees({ taskIds, select = "task_id,user_id" } = {}) {
        if (!Array.isArray(taskIds) || !taskIds.length) return emptyResult();
        return ensureClient()
            .from("workflow_task_assignees")
            .select(select)
            .in("task_id", taskIds);
    }

    async function getPeople(instanceIds) {
        if (!Array.isArray(instanceIds) || !instanceIds.length) return emptyResult();
        return ensureClient().rpc("get_workflow_people", {
            p_instance_ids: instanceIds
        });
    }

    async function startInstance({
        definitionId,
        sourceDocumentId,
        sourceRevisionId,
        metadata = {}
    }) {
        return ensureClient().rpc("workflow_start_instance", {
            p_definition_id: definitionId,
            p_source_document_id: sourceDocumentId,
            p_source_revision_id: sourceRevisionId,
            p_metadata: metadata
        });
    }

    async function completeTask({ taskId, transitionKey = null, result = {} }) {
        return ensureClient().rpc("workflow_complete_task", {
            p_task_id: taskId,
            p_transition_key: transitionKey,
            p_result: result
        });
    }

    async function rejectTask({ taskId, reason }) {
        return ensureClient().rpc("workflow_reject_task", {
            p_task_id: taskId,
            p_reason: reason
        });
    }

    async function returnTaskToDraft({ taskId, reason }) {
        return ensureClient().rpc("workflow_return_task_to_draft", {
            p_task_id: taskId,
            p_reason: reason
        });
    }

    return Object.freeze({
        listInstances,
        getInstance,
        listTasks,
        listNodes,
        getNode,
        listHistory,
        listTaskAssignees,
        getPeople,
        startInstance,
        completeTask,
        rejectTask,
        returnTaskToDraft
    });
})();
