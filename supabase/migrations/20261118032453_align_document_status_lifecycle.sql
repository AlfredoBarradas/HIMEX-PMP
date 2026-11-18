
alter table public.documents drop constraint if exists documents_status_fkey;
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check
check (status is null or status in ('Draft','Validation','Approval','Released','Obsolete','Rejected','Discarded','Cancelled'));

do $$
declare
    v_definition text;
begin
    v_definition := pg_get_functiondef('public.workflow_start_instance(bigint,bigint,bigint,jsonb)'::regprocedure);
    v_definition := replace(
        v_definition,
        'UPDATE public.documents SET updated_at=pg_catalog.now() WHERE id=p_source_document_id;',
        'UPDATE public.documents SET status=''Validation'',updated_at=pg_catalog.now() WHERE id=p_source_document_id;'
    );
    execute v_definition;

    v_definition := pg_get_functiondef('public.workflow_complete_task(bigint,text,jsonb)'::regprocedure);
    v_definition := replace(
        v_definition,
        'IF v_target_type = ''end'' THEN
        SELECT d.document_workshop_code_id, d.document_code',
        'IF v_target_type = ''end'' THEN
        UPDATE public.documents SET status=''Released'',updated_at=pg_catalog.now() WHERE id=v_source_document_id;
        SELECT d.document_workshop_code_id, d.document_code'
    );
    execute v_definition;

    v_definition := pg_get_functiondef('public.workflow_reject_task(bigint,text)'::regprocedure);
    v_definition := replace(
        v_definition,
        'UPDATE public.documents SET updated_at=pg_catalog.now() WHERE id=v_source_document_id;',
        'UPDATE public.documents SET status=''Rejected'',updated_at=pg_catalog.now() WHERE id=v_source_document_id;'
    );
    execute v_definition;

    v_definition := pg_get_functiondef('public.workflow_return_task_to_draft(bigint,text)'::regprocedure);
    v_definition := replace(
        v_definition,
        'UPDATE public.documents SET updated_at=pg_catalog.now() WHERE id=v_source_document_id;',
        'UPDATE public.documents SET status=''Draft'',updated_at=pg_catalog.now() WHERE id=v_source_document_id;'
    );
    execute v_definition;
end;
$$;
