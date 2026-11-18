-- Allow imported released documents to use their imported baseline when no revision row exists.

CREATE OR REPLACE FUNCTION public.create_document_revision(p_document_id bigint, p_change_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_actor uuid := auth.uid();
    v_doc_code text;
    v_doc_status text;
    v_source_type text;
    v_current_number integer;
    v_previous_code text;
    v_latest_status text;
    v_new_number integer;
    v_revision_id bigint;
    v_revision_code text;
begin
    if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if not public.has_permission('documents.sop.create') then raise exception 'Insufficient permission to create document revisions' using errcode='42501'; end if;

    select d.document_code,d.status,d.source_type into v_doc_code,v_doc_status,v_source_type
    from public.documents d where d.id=p_document_id and d.document_type_code='sop' for update;
    if not found then raise exception 'Document does not exist'; end if;
    if pg_catalog.btrim(coalesce(p_change_summary,''))='' then raise exception 'Change Summary cannot be empty'; end if;

    select r.revision_number,r.revision_code,r.status
    into v_current_number,v_previous_code,v_latest_status
    from public.document_revisions r where r.document_id=p_document_id
    order by r.revision_number desc limit 1 for update;

    if v_current_number is null then
        if v_doc_status <> 'Released' then raise exception 'Only Released documents without revisions can start a revision'; end if;
        v_current_number:=0;
    elsif v_latest_status in ('Rejected','Discarded') then
        select r.revision_code into v_previous_code from public.document_revisions r
        where r.document_id=p_document_id and r.status='Released'
        order by r.revision_number desc limit 1;
        if v_previous_code is null and coalesce(v_source_type,'') <> 'Imported' then raise exception 'No released revision exists to base the next revision on'; end if;
    elsif v_latest_status <> 'Released' then
        raise exception 'Cannot create a new revision while the latest revision is still in workflow or Draft';
    end if;

    v_new_number:=v_current_number+1;
    insert into public.document_revisions(document_id,revision_number,description,status,created_by)
    values(p_document_id,v_new_number,pg_catalog.btrim(p_change_summary),'Draft',v_actor)
    returning id,revision_code into v_revision_id,v_revision_code;

    update public.documents set status='Draft',updated_at=pg_catalog.now() where id=p_document_id;
    insert into public.document_history(document_id,revision_id,previous_status,new_status,event_type,comments,performed_by)
    values(p_document_id,v_revision_id,'Released','Draft','revision_created',pg_catalog.btrim(p_change_summary),v_actor);

    return pg_catalog.jsonb_build_object('document_id',p_document_id,'revision_id',v_revision_id,
        'document_code',v_doc_code,'previous_revision',v_previous_code,'revision_code',v_revision_code,'status','Draft');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.discard_document_revision(p_document_id bigint, p_revision_id bigint, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_revision_number integer;
    v_revision_code text;
    v_revision_status text;
    v_revision_creator uuid;
begin
    if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if not (public.has_permission('documents.sop.create') or public.has_permission('documents.sop.edit')) then
        raise exception 'Missing permission to discard document revisions' using errcode='42501';
    end if;
    perform 1 from public.documents d where d.id=p_document_id and d.document_type_code='sop' for update;
    if not found then raise exception 'Document not found'; end if;

    select r.revision_number,r.revision_code,r.status,r.created_by
    into v_revision_number,v_revision_code,v_revision_status,v_revision_creator
    from public.document_revisions r where r.id=p_revision_id and r.document_id=p_document_id for update;
    if not found then raise exception 'Revision does not belong to this document'; end if;
    if v_revision_status<>'Draft' then raise exception 'Only a Draft revision can be discarded'; end if;
    if v_revision_creator is distinct from auth.uid() then raise exception 'Only the revision creator may discard this revision' using errcode='42501'; end if;
    if not exists(select 1 from public.document_revisions r where r.document_id=p_document_id and r.status='Released' and r.revision_number<v_revision_number)
       and not exists(select 1 from public.documents d where d.id=p_document_id and d.source_type='Imported') then
        raise exception 'The initial Draft cannot be discarded as a revision; use Delete Draft instead';
    end if;
    if exists(select 1 from public.workflow_instances wi where wi.source_document_id=p_document_id and wi.source_revision_id=p_revision_id and wi.status in ('pending','in_progress')) then
        raise exception 'Cancel or return the active workflow before discarding this revision';
    end if;

    update public.document_revisions set status='Discarded',released_at=null where id=p_revision_id;
    update public.documents set status='Released',updated_at=pg_catalog.now() where id=p_document_id;
    insert into public.document_history(document_id,revision_id,previous_status,new_status,event_type,comments,performed_by)
    values(p_document_id,p_revision_id,'Draft','Discarded','revision_discarded',
        coalesce(nullif(pg_catalog.btrim(p_reason),''),'Discarded by revision creator'),auth.uid());
    return pg_catalog.jsonb_build_object('document_id',p_document_id,'revision_id',p_revision_id,'revision_code',v_revision_code,'status','Discarded');
end;
$function$
;
