document.addEventListener("DOMContentLoaded", async () => {

    const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const dateText = value => value ? new Date(value).toLocaleString([], {dateStyle:"medium", timeStyle:"short"}) : "—";
    const labelText = value => ({
        in_progress: "In Progress",
        active: "In Progress",
        pending: "Pending",
        completed: "Completed",
        rejected: "Rejected",
        obsolete: "Obsolete",
        validation: "Validation",
        approval: "Approval",
        released: "Released",
        draft: "Draft",
        task_created: "Task created",
        task_completed: "Task completed",
        task_rejected: "Task rejected",
        workflow_started: "Workflow submitted",
        workflow_completed: "Workflow released",
        workflow_rejected: "Workflow rejected",
        sop_returned_to_draft: "Returned to Draft",
        workflow_cancelled: "Workflow cancelled",
        sop_status_changed: "SOP status changed"
    }[
        String(value || "").toLowerCase()] || 
        String(value || "").replaceAll("_"," ").replaceAll("-"," ").replace(/\b\w/g, char => char.toUpperCase())
    );

    const dateDuration = (start,end) => {
        if (!start) {
            return "—";
        }
        const ms = Math.max(0, new Date(end || Date.now()) - new Date(start));
        const days = Math.floor(ms/86400000), 
        hours = Math.floor(ms%86400000/3600000), 
        mins = Math.floor(ms%3600000/60000);
        return days ? days+"d "+hours+"h" : hours ? hours+"h "+mins+"m" : mins+"m";
    };
    const pendingStatuses = ["pending", "assigned", "in_progress"];

    document.addEventListener("click", async event => {
        const button=event.target.closest(".workflow-detail-button");
        if (!button) {
            return;
        }
        const 
            instanceId = button.dataset.instanceId, 
            detail = document.querySelector("#workflow-review-modal .sop-modal-body"), 
            modal = document.getElementById("workflow-review-modal");
        
        detail.innerHTML="<p>Loading workflow review...</p>";
        modal.classList.remove("hidden");

        try{
            const {data:instance,error:instanceError} = await WorkflowService.getInstance({
                id: instanceId,
                documentTypeCode: "sop"
            });
            if (instanceError) {
                throw instanceError;
            }

            const [
                {data:tasks,error:taskError}, 
                {data:history,error:historyError}
            ] = await Promise.all([
                WorkflowService.listTasks({
                    instanceId,
                    orderBy: "created_at",
                    ascending: true
                }),
                WorkflowService.listHistory({
                    instanceId,
                    orderBy: "created_at",
                    ascending: true
                })
            ]);
            if (taskError) {
                throw taskError;
            }
            if (historyError) {
                throw historyError;
            }

            const 
                taskRows = tasks || [], 
                taskIds=taskRows.map(row => row.id);
            
            const assignmentResult = await WorkflowService.listTaskAssignees({
                taskIds
            });
            
            if(assignmentResult.error){
                throw assignmentResult.error;
            }

            const {data: currentUserData, error: currentUserError} = await supabaseClient.auth.getUser();
            if(currentUserError){
                throw currentUserError;
            }

            const currentUserId = currentUserData?.user?.id || "";
            const docResult = instance.source_document_id
                ? await DocumentData.getSopDocuments({id: Number(instance.source_document_id)})
                : {data: null, error: null};

            if(docResult.error){
                throw docResult.error;
            }

            const revisionResult = instance.source_revision_id
                ? await DocumentData.getSopRevisionsByIds([Number(instance.source_revision_id)])
                : {data: [], error: null};
            const revResult = {data: revisionResult.data?.[0] || null, error: revisionResult.error};

            if (revResult.error) {
                throw revResult.error;
            }
            
            const peopleResult = await WorkflowService.getPeople([Number(instanceId)]);
            if (peopleResult.error) {
                throw peopleResult.error;
            }
            
            const peopleRows = peopleResult.data || [];
            const profileMap = new Map(peopleRows.map(row => [String(row.user_id), row.full_name]));
            const pendingTask = taskRows.find(row => pendingStatuses.includes(String(row.status || "").toLowerCase()));
            const nodeResult = pendingTask
                ? await WorkflowService.getNode({
                    id: pendingTask.node_id,
                    select: "label,node_type,required_permission_code"
                })
                : {data: null, error: null};

            if (nodeResult.error) {
                throw nodeResult.error;
            }
            
            const permission = nodeResult.data?.required_permission_code;
            const assignedUserIds = (assignmentResult.data || []).filter(item => String(item.task_id) === String(pendingTask?.id)).map(item => String(item.user_id));
            const assignmentAllowsAction = !assignedUserIds.length || assignedUserIds.includes(String(currentUserId));
            const isRevisionCreator = Boolean(
                revResult.data?.created_by && 
                String(revResult.data.created_by) === String(currentUserId)
            );
            const canAct = Boolean(
                pendingTask && 
                permission && 
                hasPermission(permission) && 
                hasPermission("workflow.tasks.act") && 
                assignmentAllowsAction && 
                !isRevisionCreator
            );
            const taskHtml = taskRows.map(task => {
                const names = [...new Set(peopleRows.filter(row => String(row.workflow_id) === String(instanceId) && String(row.task_id) === String(task.id)).map(row => profileMap.get(String(row.user_id))).filter(Boolean))].join(", ");
                return `<tr>
                            <td>` + escapeText(task.title || nodeMapLabel(task.node_id))+`</td>
                            <td>` + escapeText(labelText(task.status)) + `</td>
                            <td>` + escapeText(names || "Unassigned") + `</td>
                            <td>` + escapeText(dateText(task.created_at)) + `</td>
                            <td>` + escapeText(task.completed_at? dateText(task.completed_at): "—")+`</td>
                        </tr>`;
            }).join("");

            const historyHtml = (history || []).map(item => {
                const detailObj = item.details || {};
                const actor = profileMap.get(String(item.actor_id)) || "User";
                const reason = detailObj.reason || detailObj.result?.comment || detailObj.comment;

                return `<li>
                            <strong>` + escapeText(labelText(item.event_type))+"</strong> · " +
                            escapeText(dateText(item.created_at))+" · "+
                            escapeText(actor) + 
                            (item.from_status || item.to_status?" · " + 
                                escapeText(labelText(item.from_status || "")) + " → " + escapeText(labelText(item.to_status || "")):"") + 
                                (reason?" <p>"+ escapeText(reason) + "</p>": "") +
                        "</li>";
            }).join("");

            const doc = docResult.data || {}, revision=revResult.data || {};
            const duration = dateDuration(instance.started_at, instance.completed_at);
            detail.innerHTML = "<h3>" + escapeText(doc.sop_code || "Unassigned SOP") + " · " + escapeText(revision.revision_code || "Revision unknown")+`</h3>
                                <p><strong>Workflow ID:</strong> ` + escapeText(instance.id) + " · <strong>Status:</strong> "+ escapeText(labelText(instance.status)) + `</p>
                                <p><strong>Creator:</strong> ` + escapeText(profileMap.get(String(revision.created_by || doc.created_by)) || "Creator profile unavailable") + `</p>
                                <p><strong>Part No.:</strong> ` + escapeText(doc.part_number||"—")+" · <strong>Document Name:</strong> "+ escapeText(doc.document_name||"—")+`</p>
                                <p><strong>Submitted:</strong> ` + escapeText(dateText(instance.started_at)) + " · <strong>Duration:</strong> "+ escapeText(duration)+(instance.completed_at?"": " (in progress)") + `</p>
                                <h4>Tasks</h4>
                                    <div class='workflow-task-table'>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Task</th>
                                                    <th>Status</th>
                                                    <th>Assigned To</th>
                                                    <th>Created</th>
                                                    <th>Completed</th>
                                                </tr>
                                            </thead>
                                        <tbody>` + (taskHtml || 
                                            `<tr>
                                                <td colspan='5'>No tasks found.</td>
                                            </tr>`)+
                                        `</tbody>
                                    </table>
                                </div>
                                <h4>History</h4>
                                    <ul class='workflow-history-list'>`+ (historyHtml || 
                                        "<li>No history available.</li>") +
                                    "</ul>"+ (canAct?`
                                        <div class='sop-revision-section'>
                                            <label for='workflow-task-comment'>Review comments / correction reason</label>
                                            <textarea id='workflow-task-comment' rows='3' placeholder='Enter review comments or required corrections'></textarea>
                                        </div>
                                        <div class='sop-modal-actions'>
                                            <button type='button' class='secondary-button' id='workflow-return-to-draft' data-task-id='` + escapeText(pendingTask.id)+`'>
                                                Return to Draft
                                            </button>
                                            <button type='button' class='danger-button' id='workflow-reject-task' data-task-id='` + escapeText(pendingTask.id)+`'>
                                                Reject Revision (terminal)
                                            </button>
                                            <button type='button' class='primary-button' id='workflow-complete-task' data-task-id='` + escapeText(pendingTask.id)+"' data-stage='"+ escapeText(permission)+`'>
                                                Complete `+ escapeText(labelText(permission)) + 
                                            `</button>
                                        </div>`: pendingTask? "<p>You can view this workflow, but you cannot act on this task. Check your review permission, task assignment, and separation-of-duties requirements.</p>":"");
        } catch(error){
            console.error("Unable to load workflow details:", error);
            detail.innerHTML = "<p>Unable to load workflow details. "+ escapeText(error?.message || "Check access policies and the browser console.")+"</p>";}
    });

    document.getElementById("workflow-modal-close")?.addEventListener("click", () => document.getElementById("workflow-review-modal")?.classList.add("hidden"));
    document.getElementById("workflow-modal-close-footer")?.addEventListener("click", () => document.getElementById("workflow-review-modal")?.classList.add("hidden"));
    document.querySelector("#workflow-review-modal .sop-modal-overlay")?.addEventListener("click", () => document.getElementById("workflow-review-modal")?.classList.add("hidden"));
    
    function nodeMapLabel(nodeId){
        return "Task #"+nodeId;
    }

    document.addEventListener("click", async event => {
        const completeButton = event.target.closest("#workflow-complete-task");
        const returnButton = event.target.closest("#workflow-return-to-draft"); 
        const rejectButton = event.target.closest("#workflow-reject-task");

        if (!completeButton && !returnButton && !rejectButton){
            return;
        }

        const button = completeButton || returnButton || rejectButton;
        const taskId = Number(button.dataset.taskId);
        const comment = document.getElementById("workflow-task-comment")?.value?.trim() || "";

        const isReject = Boolean(rejectButton);
        const isReturn=Boolean(returnButton);

        if ((isReject || isReturn) && !comment){
            alert(isReject?"Enter a reason before rejecting this revision.": "Enter the correction request before returning this revision to Draft.");
            return;
        }
        if (!isReject && !isReturn && !comment && !confirm("Complete this task without review comments?")){
            return;
        }
        if (isReject && !confirm("Reject this revision permanently? It will remain in history and cannot be resubmitted.")){
            return;
        }
        if (isReturn && !confirm("Return this revision to Draft? Its revision code will be preserved so the creator can correct and resubmit it.")){
            return;
        }
        
        button.disabled = true;
        try{
            const actionResult = isReject
                ? await WorkflowService.rejectTask({taskId, reason: comment})
                : isReturn
                    ? await WorkflowService.returnTaskToDraft({taskId, reason: comment})
                    : await WorkflowService.completeTask({
                        taskId,
                        transitionKey: null,
                        result: {comment}
                    });

            const {error} = actionResult;
            if (error){
                throw error;
            }
            alert(
                isReject?"Revision rejected permanently. The released revision remains unchanged.": 
                isReturn?"Revision returned to Draft. The same revision code can be corrected and resubmitted.":
                "Workflow task completed successfully.");
            
            document.getElementById("workflow-review-modal").classList.add("hidden");
            window.location.reload();
        } catch(error){
            console.error("Workflow action failed:", error);
            alert("The workflow action failed: " + (error.message || "Check permissions and RPC parameters."));
            button.disabled=false;}
    });
});