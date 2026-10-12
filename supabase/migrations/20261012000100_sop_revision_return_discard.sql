-- SOP revision lifecycle: return for correction, terminal rejection, and creator-controlled discard.
-- Apply through the project's normal migration process after reviewing this PR.
ALTER TABLE public.sop_revisions DROP CONSTRAINT IF EXISTS revision_status_valid;
ALTER TABLE public.sop_revisions ADD CONSTRAINT revision_status_valid
CHECK (status = ANY (ARRAY['Draft','Validation','Approval','Released','Obsolete','Rejected','Discarded']::text[]));

CREATE OR REPLACE FUNCTION public.workflow_return_task_to_draft(p_task_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_instance_id bigint;
    v_node_id bigint;
    v_task_status text;
    v_instance_status text;
    v_current_node_id bigint;
    v_required_permission text;
    v_document_type_code text;
    v_source_document_id bigint;
    v_source_revision_id bigint;
    v_revision_status text;
    v_revision_number integer;
    v_revision_creator uuid;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
    IF NOT public.has_permission('workflow.tasks.act') THEN RAISE EXCEPTION 'Missing permission: workflow.tasks.act' USING ERRCODE = '42501'; END IF;
    IF NULLIF(pg_catalog.btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A correction request is required'; END IF;
    SELECT t.instance_id,t.node_id,t.status,wi.status,wi.current_node_id,n.required_permission_code,
           wi.document_type_code,wi.source_document_id,wi.source_revision_id
    INTO v_instance_id,v_node_id,v_task_status,v_instance_status,v_current_node_id,v_required_permission,
         v_document_type_code,v_source_document_id,v_source_revision_id
    FROM public.workflow_tasks t
    JOIN public.workflow_instances wi ON wi.id=t.instance_id
    JOIN public.workflow_nodes n ON n.id=t.node_id AND n.version_id=wi.version_id
    WHERE t.id=p_task_id
    FOR UPDATE OF t,wi;
    IF NOT FOUND THEN RAISE EXCEPTION 'Workflow task not found or node/version mismatch'; END IF;
    IF v_task_status NOT IN ('pending','in_progress') OR v_instance_status<>'in_progress' OR v_current_node_id<>v_node_id THEN
        RAISE EXCEPTION 'Task is not the active workflow task';
    END IF;
    IF v_document_type_code<>'sop' THEN RAISE EXCEPTION 'Return to Draft is only available for SOP workflows'; END IF;
    IF v_required_permission NOT IN ('documents.sop.validate','documents.sop.approve') OR NOT public.has_permission(v_required_permission) THEN
        RAISE EXCEPTION 'Missing permission to return this SOP task to Draft' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.workflow_task_assignees a WHERE a.task_id=p_task_id)
       AND NOT EXISTS (SELECT 1 FROM public.workflow_task_assignees a WHERE a.task_id=p_task_id AND a.user_id=auth.uid()) THEN
        RAISE EXCEPTION 'Only an assigned user may return this task to Draft' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.sop_documents d WHERE d.id=v_source_document_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SOP document not found'; END IF;
    SELECT r.status,r.revision_number,r.created_by
    INTO v_revision_status,v_revision_number,v_revision_creator
    FROM public.sop_revisions r
    WHERE r.id=v_source_revision_id AND r.sop_id=v_source_document_id
    FOR UPDATE;
    IF NOT FOUND OR v_revision_status NOT IN ('Validation','Approval') THEN
        RAISE EXCEPTION 'Only a revision in Validation or Approval can be returned to Draft';
    END IF;
    IF v_revision_creator=auth.uid() THEN RAISE EXCEPTION 'The revision creator cannot review their own revision' USING ERRCODE = '42501'; END IF;

    UPDATE public.sop_revisions SET status='Draft',released_at=NULL WHERE id=v_source_revision_id;
    UPDATE public.workflow_tasks SET status='cancelled',completed_at=pg_catalog.now(),
        result=pg_catalog.jsonb_build_object('action','returned_to_draft','reason',pg_catalog.btrim(p_reason))
    WHERE id=p_task_id;
    UPDATE public.workflow_instances SET status='cancelled',completed_at=pg_catalog.now()
    WHERE id=v_instance_id;
    UPDATE public.sop_documents SET updated_at=pg_catalog.now() WHERE id=v_source_document_id;

    INSERT INTO public.workflow_history(instance_id,task_id,event_type,from_status,to_status,actor_id,details)
    VALUES (v_instance_id,p_task_id,'sop_returned_to_draft',v_task_status,'cancelled',auth.uid(),
        pg_catalog.jsonb_build_object('revision_id',v_source_revision_id,'revision_code','R'||pg_catalog.lpad(v_revision_number::text,2,'0'),'from_status',v_revision_status,'to_status','Draft','reason',pg_catalog.btrim(p_reason)));
    INSERT INTO public.workflow_history(instance_id,event_type,from_status,to_status,actor_id,details)
    VALUES (v_instance_id,'workflow_cancelled','in_progress','cancelled',auth.uid(),
        pg_catalog.jsonb_build_object('reason','Returned to Draft','revision_id',v_source_revision_id));
    INSERT INTO public.sop_workflow_history(sop_id,revision_id,previous_status,new_status,action,comments,performed_by)
    VALUES (v_source_document_id,v_source_revision_id,v_revision_status,'Draft','Return to Draft',pg_catalog.btrim(p_reason),auth.uid());
    RETURN pg_catalog.jsonb_build_object('instance_id',v_instance_id,'task_id',p_task_id,'revision_id',v_source_revision_id,'status','Draft');
END;
$function$;

CREATE OR REPLACE FUNCTION public.discard_sop_revision(p_sop_id bigint,p_revision_id bigint,p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_revision_number integer;
    v_revision_code text;
    v_revision_status text;
    v_revision_creator uuid;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
    IF NOT (public.has_permission('documents.sop.create') OR public.has_permission('documents.sop.edit')) THEN
        RAISE EXCEPTION 'Missing permission to discard SOP revisions' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.sop_documents d WHERE d.id=p_sop_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SOP document not found'; END IF;
    SELECT r.revision_number,r.revision_code,r.status,r.created_by
    INTO v_revision_number,v_revision_code,v_revision_status,v_revision_creator
    FROM public.sop_revisions r WHERE r.id=p_revision_id AND r.sop_id=p_sop_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Revision does not belong to this SOP'; END IF;
    IF v_revision_status<>'Draft' THEN RAISE EXCEPTION 'Only a Draft revision can be discarded'; END IF;
    IF v_revision_creator IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the revision creator may discard this revision' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sop_revisions r WHERE r.sop_id=p_sop_id AND r.status='Released' AND r.revision_number<v_revision_number) THEN
        RAISE EXCEPTION 'The initial Draft cannot be discarded as a revision; use Delete Draft instead';
    END IF;
    IF EXISTS (SELECT 1 FROM public.workflow_instances wi WHERE wi.source_document_id=p_sop_id AND wi.source_revision_id=p_revision_id AND wi.status IN ('pending','in_progress')) THEN
        RAISE EXCEPTION 'Cancel or return the active workflow before discarding this revision';
    END IF;
    UPDATE public.sop_revisions SET status='Discarded',released_at=NULL WHERE id=p_revision_id;
    UPDATE public.sop_documents SET updated_at=pg_catalog.now() WHERE id=p_sop_id;
    INSERT INTO public.sop_workflow_history(sop_id,revision_id,previous_status,new_status,action,comments,performed_by)
    VALUES (p_sop_id,p_revision_id,'Draft','Discarded','Discard Revision',COALESCE(NULLIF(pg_catalog.btrim(p_reason),''),'Discarded by revision creator'),auth.uid());
    RETURN pg_catalog.jsonb_build_object('sop_id',p_sop_id,'revision_id',p_revision_id,'revision_code',v_revision_code,'status','Discarded');
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sop_revision(p_sop_id bigint, p_change_summary text, p_created_by uuid DEFAULT auth.uid())
RETURNS TABLE(sop_id bigint, sop_code text, previous_revision text, revision_code text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_actor_id uuid;
    v_sop_code text;
    v_current_revision integer;
    v_previous_revision_code text;
    v_current_revision_status text;
    v_new_revision integer;
    v_revision_code text;
    v_revision_id bigint;
BEGIN
    v_actor_id:=auth.uid();
    IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    IF p_created_by IS DISTINCT FROM v_actor_id THEN RAISE EXCEPTION 'Actor identity mismatch'; END IF;
    IF NOT public.has_permission('documents.sop.create') THEN RAISE EXCEPTION 'Insufficient permission to create SOP revisions'; END IF;
    SELECT d.sop_code INTO v_sop_code FROM public.sop_documents d WHERE d.id=p_sop_id FOR UPDATE;
    IF NOT FOUND OR v_sop_code IS NULL THEN RAISE EXCEPTION 'SOP does not exist or has no official code'; END IF;
    IF pg_catalog.btrim(COALESCE(p_change_summary,''))='' THEN RAISE EXCEPTION 'Change Summary cannot be empty'; END IF;
    SELECT max(r.revision_number) INTO v_current_revision FROM public.sop_revisions r WHERE r.sop_id=p_sop_id;
    IF v_current_revision IS NULL THEN RAISE EXCEPTION 'SOP does not have a revision'; END IF;
    SELECT r.revision_code,r.status INTO v_previous_revision_code,v_current_revision_status
    FROM public.sop_revisions r WHERE r.sop_id=p_sop_id AND r.revision_number=v_current_revision;
    IF v_current_revision_status IN ('Rejected','Discarded') THEN
        SELECT r.revision_code INTO v_previous_revision_code FROM public.sop_revisions r
        WHERE r.sop_id=p_sop_id AND r.status='Released' ORDER BY r.revision_number DESC LIMIT 1;
        IF v_previous_revision_code IS NULL THEN RAISE EXCEPTION 'No released revision exists to base the next revision on'; END IF;
    END IF;
    IF v_current_revision_status NOT IN ('Released','Rejected','Discarded') THEN
        RAISE EXCEPTION 'Cannot create a new revision while the latest revision is still in workflow or Draft';
    END IF;
    v_new_revision:=v_current_revision+1;
    v_revision_code:='R'||pg_catalog.lpad(v_new_revision::text,2,'0');
    INSERT INTO public.sop_revisions(sop_id,revision_number,description,status,created_by)
    VALUES(p_sop_id,v_new_revision,pg_catalog.btrim(p_change_summary),'Draft',v_actor_id)
    RETURNING id,sop_revisions.revision_code INTO v_revision_id,v_revision_code;
    INSERT INTO public.sop_workflow_history(sop_id,revision_id,previous_status,new_status,action,comments,performed_by)
    VALUES(p_sop_id,v_revision_id,'Released','Draft','Create Revision',pg_catalog.btrim(p_change_summary),v_actor_id);
    RETURN QUERY SELECT p_sop_id,v_sop_code,v_previous_revision_code,v_revision_code,'Draft'::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.workflow_return_task_to_draft(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_sop_revision(bigint,bigint,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_return_task_to_draft(bigint,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.discard_sop_revision(bigint,bigint,text) FROM anon;
