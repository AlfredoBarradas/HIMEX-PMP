document.addEventListener("DOMContentLoaded", async () => {
    const validationBody = document.getElementById("sop-validation-body");
    const approvalBody = document.getElementById("sop-approval-body");
    const workflowBody = document.getElementById("sop-workflow-body");
    if (!validationBody || !approvalBody || !workflowBody) return;
    const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const dateText = value => value ? new Date(value).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}) : "—";
    const labelText = value => ({in_progress:"In Progress",active:"In Progress",pending:"Pending",completed:"Completed",rejected:"Rejected",obsolete:"Obsolete",validation:"Validation",approval:"Approval",released:"Released",draft:"Draft",task_created:"Task created",task_completed:"Task completed",task_rejected:"Task rejected",workflow_started:"Workflow submitted",workflow_completed:"Workflow released",workflow_rejected:"Workflow rejected",sop_status_changed:"SOP status changed"}[String(value||"").toLowerCase()] || String(value||"").replaceAll("_"," ").replaceAll("-"," ").replace(/\b\w/g, char=>char.toUpperCase()));
    const dateDuration = (start,end) => {
        if (!start) return "—";
        const ms = Math.max(0, new Date(end || Date.now()) - new Date(start));
        const days = Math.floor(ms/86400000), hours = Math.floor(ms%86400000/3600000), mins = Math.floor(ms%3600000/60000);
        return days ? days+"d "+hours+"h" : hours ? hours+"h "+mins+"m" : mins+"m";
    };
    const message = (body, count, text) => { body.innerHTML = '<tr><td colspan="'+count+'">'+escapeText(text)+'</td></tr>'; };
    const pendingStatuses = ["pending","assigned","in_progress"];
    message(validationBody,7,"Loading validation tasks...");
    message(approvalBody,7,"Loading approval tasks...");
    message(workflowBody,6,"Loading SOP workflow history...");
    try {
        const {data: instances,error: instanceError}=await supabaseClient.from("workflow_instances").select("*").eq("document_type_code","sop").order("started_at",{ascending:false});
        if(instanceError) throw instanceError;
        const allInstances=instances||[];
        const active=allInstances.filter(row=>["active","in_progress","pending"].includes(String(row.status||"").toLowerCase()));
        const ids=allInstances.map(row=>row.id);
        const [taskResult,nodeResult]=await Promise.all([
            ids.length ? supabaseClient.from("workflow_tasks").select("*").in("instance_id",ids).order("created_at",{ascending:true}) : Promise.resolve({data:[],error:null}),
            supabaseClient.from("workflow_nodes").select("id,version_id,label,node_type,required_permission_code")
        ]);
        if(taskResult.error) throw taskResult.error;
        if(nodeResult.error) throw nodeResult.error;
        const tasks=taskResult.data||[];
        const nodeMap=new Map((nodeResult.data||[]).map(row=>[String(row.id),row]));
        const docIds=[...new Set(allInstances.map(row=>row.source_document_id).filter(Boolean))];
        const revisionIds=[...new Set(allInstances.map(row=>row.source_revision_id).filter(Boolean))];
        const [docResult,revisionResult,assignmentResult]=await Promise.all([
            docIds.length ? supabaseClient.from("sop_documents").select("id,sop_code,sop_number,part_number,operation_name,created_by,model_id,part_name_id").in("id",docIds) : Promise.resolve({data:[],error:null}),
            revisionIds.length ? supabaseClient.from("sop_revisions").select("id,sop_id,revision_code,status,created_at,created_by,released_at,description").in("id",revisionIds) : Promise.resolve({data:[],error:null}),
            tasks.length ? supabaseClient.from("workflow_task_assignees").select("task_id,user_id").in("task_id",tasks.map(row=>row.id)) : Promise.resolve({data:[],error:null})
        ]);
        if(docResult.error) throw docResult.error;
        if(revisionResult.error) throw revisionResult.error;
        if(assignmentResult.error) throw assignmentResult.error;
        const docs=docResult.data||[], revisions=revisionResult.data||[], assignments=assignmentResult.data||[];
        const modelIds=[...new Set(docs.map(row=>row.model_id).filter(Boolean))], partNameIds=[...new Set(docs.map(row=>row.part_name_id).filter(Boolean))];
        const [modelsResult,partNamesResult]=await Promise.all([
            modelIds.length ? supabaseClient.from("models").select("id,name").in("id",modelIds) : Promise.resolve({data:[],error:null}),
            partNameIds.length ? supabaseClient.from("part_names").select("id,name").in("id",partNameIds) : Promise.resolve({data:[],error:null})
        ]);
        if(modelsResult.error) throw modelsResult.error;
        if(partNamesResult.error) throw partNamesResult.error;
        const docMap=new Map(docs.map(row=>[String(row.id),row])), revisionMap=new Map(revisions.map(row=>[String(row.id),row]));
        const modelMap=new Map((modelsResult.data||[]).map(row=>[String(row.id),row.name]));
        const partNameMap=new Map((partNamesResult.data||[]).map(row=>[String(row.id),row.name]));
        const peopleResult=ids.length ? await supabaseClient.rpc("get_sop_workflow_people",{p_instance_ids:ids}) : {data:[],error:null};
        if(peopleResult.error) throw peopleResult.error;
        const peopleRows=peopleResult.data||[];
        const profileMap=new Map(peopleRows.map(row=>[String(row.user_id),row.full_name]));
        const taskFor=instance=>tasks.filter(task=>String(task.instance_id)===String(instance.id));
        const currentTask=instance=>taskFor(instance).find(task=>pendingStatuses.includes(String(task.status||"").toLowerCase()));
        const nodeFor=instance=>{const task=currentTask(instance);return nodeMap.get(String(task?.node_id ?? instance.current_node_id));};
        const stageFor=instance=>{
            const node=nodeFor(instance), revision=revisionMap.get(String(instance.source_revision_id));
            const permission=String(node?.required_permission_code||"").toLowerCase();
            if(permission==="documents.sop.validate") return "Validation";
            if(permission==="documents.sop.approve") return "Approval";
            if(instance.status==="rejected") return "Rejected";
            if(instance.status==="completed") return revision?.status==="Released" ? "Released" : labelText(revision?.status);
            return labelText(node?.label||node?.node_type||revision?.status||"Workflow");
        };
        const assigneeText=task=>{
            if(!task) return "—";
            const names=peopleRows.filter(row=>String(row.workflow_id)===String(task.instance_id)&&String(row.task_id)===String(task.id)).map(row=>profileMap.get(String(row.user_id))).filter(Boolean);
            return [...new Set(names)].join(", ") || "Unassigned";
        };
        const rows=allInstances.map(instance=>{
            const doc=docMap.get(String(instance.source_document_id)), revision=revisionMap.get(String(instance.source_revision_id)), task=currentTask(instance);
            return {instance,doc,revision,task,stage:stageFor(instance),assignees:assigneeText(task),creator:profileMap.get(String(revision?.created_by||doc?.created_by))||"Creator profile unavailable"};
        });
        const validation=rows.filter(row=>active.some(instance=>String(instance.id)===String(row.instance.id))&&row.task&&row.stage==="Validation");
        const approval=rows.filter(row=>active.some(instance=>String(instance.id)===String(row.instance.id))&&row.task&&row.stage==="Approval");
        document.getElementById("pending-validation-count").textContent=String(validation.length);
        document.getElementById("pending-approval-count").textContent=String(approval.length);
        const renderQueue=(body,list,stage)=>{
            if(!list.length){message(body,7,"No pending "+stage+" tasks.");return;}
            body.innerHTML=list.map(row=>'<tr><td>'+escapeText((row.doc?.sop_code||"Unassigned")+" ("+(row.revision?.revision_code||"R??")+")")+'</td><td>'+escapeText(modelMap.get(String(row.doc?.model_id))||"—")+'</td><td>'+escapeText(row.doc?.part_number||"—")+'</td><td>'+escapeText(row.creator)+'</td><td>'+escapeText(row.assignees)+'</td><td>'+escapeText(dateText(row.task?.created_at||row.instance.started_at))+'</td><td><button type="button" class="secondary-button workflow-detail-button" data-instance-id="'+escapeText(row.instance.id)+'">Review</button></td></tr>').join("");
        };
        renderQueue(validationBody,validation,"validation");
        renderQueue(approvalBody,approval,"approval");
        if(!rows.length){message(workflowBody,6,"No SOP workflows found.");}
        else workflowBody.innerHTML=rows.map(row=>'<tr><td>'+escapeText((row.doc?.sop_code||"Unassigned")+" ("+(row.revision?.revision_code||"R??")+")")+'</td><td>'+escapeText(row.stage)+'</td><td>'+escapeText(row.assignees)+'</td><td>'+escapeText(dateText(row.instance.started_at))+'</td><td><span class="status-badge status-'+escapeText(String(row.instance.status||"").toLowerCase())+'">'+escapeText(labelText(row.instance.status))+'</span></td><td><button type="button" class="secondary-button workflow-detail-button" data-instance-id="'+escapeText(row.instance.id)+'">View History</button></td></tr>').join("");
    } catch(error) {
        console.error("Unable to load SOP workflow data:",error);
        message(validationBody,7,"Unable to load validation tasks. See browser console for details.");
        message(approvalBody,7,"Unable to load approval tasks. See browser console for details.");
        message(workflowBody,6,"Unable to load SOP workflow history. See browser console for details.");
    }
    document.addEventListener("click",async event=>{
        const button=event.target.closest(".workflow-detail-button");
        if(!button)return;
        const instanceId=button.dataset.instanceId, detail=document.querySelector("#workflow-review-modal .sop-modal-body"), modal=document.getElementById("workflow-review-modal");
        detail.innerHTML="<p>Loading workflow review...</p>";
        modal.classList.remove("hidden");
        try{
            const {data:instance,error:instanceError}=await supabaseClient.from("workflow_instances").select("*").eq("id",instanceId).eq("document_type_code","sop").single();
            if(instanceError)throw instanceError;
            const [{data:tasks,error:taskError},{data:history,error:historyError}]=await Promise.all([
                supabaseClient.from("workflow_tasks").select("*").eq("instance_id",instanceId).order("created_at",{ascending:true}),
                supabaseClient.from("workflow_history").select("*").eq("instance_id",instanceId).order("created_at",{ascending:true})
            ]);
            if(taskError)throw taskError;if(historyError)throw historyError;
            const taskRows=tasks||[], taskIds=taskRows.map(row=>row.id);
            const assignmentResult=taskIds.length?await supabaseClient.from("workflow_task_assignees").select("task_id,user_id").in("task_id",taskIds):{data:[],error:null};
            if(assignmentResult.error)throw assignmentResult.error;
            const {data:currentUserData,error:currentUserError}=await supabaseClient.auth.getUser();
            if(currentUserError)throw currentUserError;
            const currentUserId=currentUserData?.user?.id||"";
            const docResult=instance.source_document_id?await supabaseClient.from("sop_documents").select("id,sop_code,part_number,operation_name,created_by,model_id").eq("id",instance.source_document_id).maybeSingle():{data:null,error:null};
            if(docResult.error)throw docResult.error;
            const revResult=instance.source_revision_id?await supabaseClient.from("sop_revisions").select("id,revision_code,status,created_by,description,released_at").eq("id",instance.source_revision_id).maybeSingle():{data:null,error:null};
            if(revResult.error)throw revResult.error;
            const peopleResult=await supabaseClient.rpc("get_sop_workflow_people",{p_instance_ids:[Number(instanceId)]});
            if(peopleResult.error)throw peopleResult.error;
            const peopleRows=peopleResult.data||[];
            const profileMap=new Map(peopleRows.map(row=>[String(row.user_id),row.full_name]));
            const pendingTask=taskRows.find(row=>pendingStatuses.includes(String(row.status||"").toLowerCase()));
            const nodeResult=pendingTask?await supabaseClient.from("workflow_nodes").select("label,node_type,required_permission_code").eq("id",pendingTask.node_id).maybeSingle():{data:null,error:null};
            if(nodeResult.error)throw nodeResult.error;
            const permission=nodeResult.data?.required_permission_code;
            const assignedUserIds=(assignmentResult.data||[]).filter(item=>String(item.task_id)===String(pendingTask?.id)).map(item=>String(item.user_id));
            const assignmentAllowsAction=!assignedUserIds.length||assignedUserIds.includes(String(currentUserId));
            const isRevisionCreator=Boolean(revResult.data?.created_by&&String(revResult.data.created_by)===String(currentUserId));
            const canAct=Boolean(pendingTask&&permission&&hasPermission(permission)&&hasPermission("workflow.tasks.act")&&assignmentAllowsAction&&!isRevisionCreator);
            const taskHtml=taskRows.map(task=>{
                const names=[...new Set(peopleRows.filter(row=>String(row.workflow_id)===String(instanceId)&&String(row.task_id)===String(task.id)).map(row=>profileMap.get(String(row.user_id))).filter(Boolean))].join(", ");
                return "<tr><td>"+escapeText(task.title||nodeMapLabel(task.node_id))+"</td><td>"+escapeText(labelText(task.status))+"</td><td>"+escapeText(names||"Unassigned")+"</td><td>"+escapeText(dateText(task.created_at))+"</td><td>"+escapeText(task.completed_at?dateText(task.completed_at):"—")+"</td></tr>";
            }).join("");
            const historyHtml=(history||[]).map(item=>{
                const detailObj=item.details||{}, actor=profileMap.get(String(item.actor_id))||"User";
                const reason=detailObj.reason||detailObj.result?.comment||detailObj.comment;
                return "<li><strong>"+escapeText(labelText(item.event_type))+"</strong> · "+escapeText(dateText(item.created_at))+" · "+escapeText(actor)+(item.from_status||item.to_status?" · "+escapeText(labelText(item.from_status||""))+" → "+escapeText(labelText(item.to_status||"")):"")+(reason?"<p>"+escapeText(reason)+"</p>":"")+"</li>";
            }).join("");
            const doc=docResult.data||{}, revision=revResult.data||{};
            const duration=dateDuration(instance.started_at,instance.completed_at);
            detail.innerHTML="<h3>"+escapeText(doc.sop_code||"Unassigned SOP")+" · "+escapeText(revision.revision_code||"Revision unknown")+"</h3><p><strong>Workflow ID:</strong> "+escapeText(instance.id)+" · <strong>Status:</strong> "+escapeText(labelText(instance.status))+"</p><p><strong>Creator:</strong> "+escapeText(profileMap.get(String(revision.created_by||doc.created_by))||"Creator profile unavailable")+"</p><p><strong>Part No.:</strong> "+escapeText(doc.part_number||"—")+" · <strong>Operation:</strong> "+escapeText(doc.operation_name||"—")+"</p><p><strong>Submitted:</strong> "+escapeText(dateText(instance.started_at))+" · <strong>Duration:</strong> "+escapeText(duration)+(instance.completed_at?"":" (in progress)")+"</p><h4>Tasks</h4><div class='workflow-task-table'><table><thead><tr><th>Task</th><th>Status</th><th>Assigned To</th><th>Created</th><th>Completed</th></tr></thead><tbody>"+(taskHtml||"<tr><td colspan='5'>No tasks found.</td></tr>")+"</tbody></table></div><h4>History</h4><ul class='workflow-history-list'>"+(historyHtml||"<li>No history available.</li>")+"</ul>"+(canAct?"<div class='sop-revision-section'><label for='workflow-task-comment'>Review comments</label><textarea id='workflow-task-comment' rows='3' placeholder='Enter comments for this review'></textarea></div><div class='sop-modal-actions'><button type='button' class='danger-button' id='workflow-reject-task' data-task-id='"+escapeText(pendingTask.id)+"'>Reject and return to Draft</button><button type='button' class='primary-button' id='workflow-complete-task' data-task-id='"+escapeText(pendingTask.id)+"' data-stage='"+escapeText(permission)+"'>Complete "+escapeText(labelText(permission))+"</button></div>":pendingTask?"<p>You can view this workflow, but you cannot act on this task. Check your review permission, task assignment, and separation-of-duties requirements.</p>":"");
        }catch(error){console.error("Unable to load workflow details:",error);detail.innerHTML="<p>Unable to load workflow details. "+escapeText(error?.message||"Check access policies and the browser console.")+"</p>";}
    });
    document.getElementById("workflow-modal-close")?.addEventListener("click", () => document.getElementById("workflow-review-modal")?.classList.add("hidden"));
    document.getElementById("workflow-modal-close-footer")?.addEventListener("click", () => document.getElementById("workflow-review-modal")?.classList.add("hidden"));
    document.querySelector("#workflow-review-modal .sop-modal-overlay")?.addEventListener("click", () => document.getElementById("workflow-review-modal")?.classList.add("hidden"));
    function nodeMapLabel(nodeId){return "Task #"+nodeId;}
    document.addEventListener("click",async event=>{
        const completeButton=event.target.closest("#workflow-complete-task"), rejectButton=event.target.closest("#workflow-reject-task");
        if(!completeButton&&!rejectButton)return;
        const button=completeButton||rejectButton, taskId=Number(button.dataset.taskId), comment=document.getElementById("workflow-task-comment")?.value?.trim()||"";
        const isReject=Boolean(rejectButton);
        if(isReject&&!comment){alert("Enter a reason before rejecting this SOP.");return;}
        if(!isReject&&!comment&&!confirm("Complete this task without review comments?"))return;
        if(isReject&&!confirm("Reject this task and return the SOP revision to Draft?"))return;
        button.disabled=true;
        try{
            const rpcName=isReject?"workflow_reject_task":"workflow_complete_task";
            const rpcArgs=isReject?{p_task_id:taskId,p_reason:comment}:{p_task_id:taskId,p_transition_key:null,p_result:{comment}};
            const {error}=await supabaseClient.rpc(rpcName,rpcArgs);
            if(error)throw error;
            alert(isReject?"Task rejected. The reason has been recorded.":"Workflow task completed successfully.");
            document.getElementById("workflow-review-modal").classList.add("hidden");window.location.reload();
        }catch(error){console.error("Workflow action failed:",error);alert("The workflow action failed: "+(error.message||"Check permissions and RPC parameters."));button.disabled=false;}
    });
});