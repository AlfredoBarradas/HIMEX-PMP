-- Generic document lifecycle operations used by the SOP interface.

CREATE OR REPLACE FUNCTION public.create_document_draft(p_document_type_code text, p_workshop_id bigint, p_process_area text, p_model text, p_part_name_id bigint, p_part_number text, p_document_name text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_actor uuid := auth.uid();
    v_workshop_name text;
    v_code_config_id bigint;
    v_part_name text;
    v_document_id bigint;
    v_revision_id bigint;
    v_revision_code text;
begin
    if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if p_document_type_code <> 'sop' then raise exception 'Unsupported document type for this operation'; end if;
    if not public.has_permission('documents.sop.create') then raise exception 'Insufficient permission to create document' using errcode='42501'; end if;

    select w.name into v_workshop_name from public.workshops w
    where w.id=p_workshop_id and w.active=true;
    if not found then raise exception 'Workshop does not exist or is inactive'; end if;

    select dwc.id into v_code_config_id from public.document_workshop_codes dwc
    where dwc.workshop_id=p_workshop_id and dwc.document_type_code=p_document_type_code and dwc.active=true;
    if not found then raise exception 'No active document code configuration exists for this workshop'; end if;

    if not exists (
        select 1 from public.workshop_process_areas wpa
        join public.process_areas pa on pa.id=wpa.process_area_id
        where wpa.workshop_id=p_workshop_id and pa.name=pg_catalog.btrim(p_process_area) and pa.active=true
    ) then raise exception 'Process Area does not belong to the selected Workshop or is inactive'; end if;

    if not exists(select 1 from public.models m where m.size_model=pg_catalog.btrim(p_model) and m.active=true) then
        raise exception 'Model does not exist or is inactive';
    end if;

    select pn.part_name into v_part_name
    from public.workshop_part_names wpn
    join public.part_names pn on pn.id=wpn.part_name_id
    where wpn.workshop_id=p_workshop_id and wpn.part_name_id=p_part_name_id and pn.active=true;
    if not found then raise exception 'Part Name does not belong to the selected Workshop or is inactive'; end if;

    if pg_catalog.btrim(coalesce(p_part_number,''))='' then raise exception 'Part Number cannot be empty'; end if;
    if pg_catalog.btrim(coalesce(p_document_name,''))='' then raise exception 'Document Name cannot be empty'; end if;
    if pg_catalog.btrim(coalesce(p_description,''))='' then raise exception 'Description cannot be empty'; end if;

    insert into public.documents(
        document_type_code,document_workshop_code_id,workshop_id,created_by,
        model,workshop,part_name,part_number,source_type,process_area,document_name,status
    ) values (
        p_document_type_code,v_code_config_id,p_workshop_id,v_actor,
        pg_catalog.btrim(p_model),v_workshop_name,v_part_name,pg_catalog.btrim(p_part_number),
        'Created',pg_catalog.btrim(p_process_area),pg_catalog.btrim(p_document_name),'Draft'
    ) returning id into v_document_id;

    insert into public.document_revisions(document_id,revision_number,description,status,created_by)
    values(v_document_id,0,pg_catalog.btrim(p_description),'Draft',v_actor)
    returning id,revision_code into v_revision_id,v_revision_code;

    insert into public.document_history(document_id,revision_id,previous_status,new_status,event_type,performed_by)
    values(v_document_id,v_revision_id,null,'Draft','document_created',v_actor);

    return pg_catalog.jsonb_build_object(
        'document_id',v_document_id,'revision_id',v_revision_id,
        'revision_code',v_revision_code,'document_code',null,'status','Draft'
    );
end;
$function$
;

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
    v_current_number integer;
    v_previous_code text;
    v_latest_status text;
    v_new_number integer;
    v_revision_id bigint;
    v_revision_code text;
begin
    if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if not public.has_permission('documents.sop.create') then raise exception 'Insufficient permission to create document revisions' using errcode='42501'; end if;

    select d.document_code,d.status into v_doc_code,v_doc_status
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
        if v_previous_code is null then raise exception 'No released revision exists to base the next revision on'; end if;
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

CREATE OR REPLACE FUNCTION public.delete_document_draft(p_document_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_actor uuid := auth.uid();
    v_owner uuid;
    v_revision_id bigint;
    v_revision_status text;
begin
    if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if not public.has_permission('documents.sop.edit') then raise exception 'Insufficient permission to delete document drafts' using errcode='42501'; end if;

    select d.created_by into v_owner from public.documents d
    where d.id=p_document_id and d.document_type_code='sop' for update;
    if not found or v_owner is distinct from v_actor then raise exception 'Document not found or user is not its creator'; end if;

    select r.id,r.status into v_revision_id,v_revision_status
    from public.document_revisions r where r.document_id=p_document_id
    order by r.revision_number desc limit 1 for update;
    if not found or v_revision_status<>'Draft' then raise exception 'Only documents whose latest revision is Draft can be deleted'; end if;

    if exists(select 1 from public.workflow_instances wi where wi.source_document_id=p_document_id and wi.status in ('pending','in_progress','active')) then
        raise exception 'This document has an active workflow and cannot be deleted';
    end if;

    delete from public.document_history where document_id=p_document_id;
    delete from public.document_revisions where document_id=p_document_id;
    delete from public.documents where id=p_document_id;
    return pg_catalog.jsonb_build_object('document_id',p_document_id,'deleted',true);
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
    if not exists(select 1 from public.document_revisions r where r.document_id=p_document_id and r.status='Released' and r.revision_number<v_revision_number) then
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

CREATE OR REPLACE FUNCTION public.update_document_draft(p_document_id bigint, p_revision_id bigint, p_workshop_id bigint, p_process_area text, p_model text, p_part_name_id bigint, p_part_number text, p_document_name text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_actor uuid := auth.uid();
    v_owner uuid;
    v_revision_owner uuid;
    v_revision_status text;
    v_workshop_name text;
    v_part_name text;
begin
    if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if not public.has_permission('documents.sop.edit') then raise exception 'Insufficient permission to edit document' using errcode='42501'; end if;
    if pg_catalog.btrim(coalesce(p_part_number,''))='' then raise exception 'Part Number cannot be empty'; end if;
    if pg_catalog.btrim(coalesce(p_document_name,''))='' then raise exception 'Document Name cannot be empty'; end if;
    if pg_catalog.btrim(coalesce(p_description,''))='' then raise exception 'Description cannot be empty'; end if;

    select d.created_by into v_owner from public.documents d where d.id=p_document_id and d.document_type_code='sop' for update;
    if not found or v_owner is distinct from v_actor then raise exception 'Document not found or user is not its creator'; end if;

    select r.status,r.created_by into v_revision_status,v_revision_owner from public.document_revisions r
    where r.id=p_revision_id and r.document_id=p_document_id for update;
    if not found then raise exception 'Document revision not found'; end if;
    if v_revision_status<>'Draft' then raise exception 'Only Draft revisions can be edited'; end if;
    if v_revision_owner is distinct from v_actor then raise exception 'User is not the creator of this Draft revision'; end if;

    select w.name into v_workshop_name from public.workshops w where w.id=p_workshop_id and w.active=true;
    if not found then raise exception 'Workshop does not exist or is inactive'; end if;
    if not exists (
        select 1 from public.workshop_process_areas wpa join public.process_areas pa on pa.id=wpa.process_area_id
        where wpa.workshop_id=p_workshop_id and pa.name=pg_catalog.btrim(p_process_area) and pa.active=true
    ) then raise exception 'Process Area does not belong to the selected Workshop or is inactive'; end if;
    if not exists(select 1 from public.models m where m.size_model=pg_catalog.btrim(p_model) and m.active=true) then
        raise exception 'Model does not exist or is inactive';
    end if;
    select pn.part_name into v_part_name from public.workshop_part_names wpn
    join public.part_names pn on pn.id=wpn.part_name_id
    where wpn.workshop_id=p_workshop_id and wpn.part_name_id=p_part_name_id and pn.active=true;
    if not found then raise exception 'Part Name does not belong to the selected Workshop or is inactive'; end if;

    update public.documents set workshop_id=p_workshop_id,workshop=v_workshop_name,
        process_area=pg_catalog.btrim(p_process_area),model=pg_catalog.btrim(p_model),
        part_name=v_part_name,part_number=pg_catalog.btrim(p_part_number),
        document_name=pg_catalog.btrim(p_document_name),updated_at=pg_catalog.now()
    where id=p_document_id;
    update public.document_revisions set description=pg_catalog.btrim(p_description)
    where id=p_revision_id and document_id=p_document_id;
    insert into public.document_history(document_id,revision_id,previous_status,new_status,event_type,performed_by)
    values(p_document_id,p_revision_id,'Draft','Draft','draft_updated',v_actor);
    return pg_catalog.jsonb_build_object('document_id',p_document_id,'revision_id',p_revision_id,'status','Draft','document_code',null);
end;
$function$
;
