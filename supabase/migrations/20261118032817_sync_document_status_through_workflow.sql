
do $$
declare v_definition text;
begin
    v_definition := pg_get_functiondef('public.workflow_complete_task(bigint,text,jsonb)'::regprocedure);

    v_definition := replace(
        v_definition,
        $old$UPDATE public.document_revisions
               SET status = v_target_config->>'document_status',
                   released_at = CASE WHEN v_target_config->>'document_status' = 'Released' THEN pg_catalog.now() ELSE NULL END
             WHERE id = v_source_revision_id;$old$,
        $new$UPDATE public.document_revisions
               SET status = v_target_config->>'document_status',
                   released_at = CASE WHEN v_target_config->>'document_status' = 'Released' THEN pg_catalog.now() ELSE NULL END
             WHERE id = v_source_revision_id;
            UPDATE public.documents
               SET status = v_target_config->>'document_status', updated_at = pg_catalog.now()
             WHERE id = v_source_document_id;$new$
    );

    v_definition := replace(
        v_definition,
        $old$UPDATE public.document_revisions SET status = 'Approval', released_at = NULL
             WHERE id = v_source_revision_id;$old$,
        $new$UPDATE public.document_revisions SET status = 'Approval', released_at = NULL
             WHERE id = v_source_revision_id;
            UPDATE public.documents SET status = 'Approval', updated_at = pg_catalog.now()
             WHERE id = v_source_document_id;$new$
    );

    execute v_definition;
end;
$$;
