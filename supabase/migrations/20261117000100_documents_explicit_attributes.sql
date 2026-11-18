-- Replace documents.metadata with explicit document attributes.
-- Safe for both databases that still have metadata and databases where this
-- change has already been applied manually.

BEGIN;

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS model text,
    ADD COLUMN IF NOT EXISTS workshop text,
    ADD COLUMN IF NOT EXISTS part_name text,
    ADD COLUMN IF NOT EXISTS part_number text,
    ADD COLUMN IF NOT EXISTS source_type text,
    ADD COLUMN IF NOT EXISTS process_area text,
    ADD COLUMN IF NOT EXISTS document_name text;

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documents'
          AND column_name = 'metadata'
    ) THEN
        EXECUTE $sql$
            UPDATE public.documents d
               SET model = d.metadata->>'model',
                   workshop = COALESCE(d.metadata->>'workshop', w.name),
                   part_name = d.metadata->>'part_name',
                   part_number = d.metadata->>'part_number',
                   source_type = d.metadata->>'source_type',
                   process_area = d.metadata->>'process_area',
                   document_name = d.metadata->>'operation_name'
              FROM public.workshops w
             WHERE w.id = d.workshop_id
               AND d.document_type_code = 'sop'
        $sql$;

        -- Also migrate rows without a valid workshop relationship.
        EXECUTE $sql$
            UPDATE public.documents d
               SET model = d.metadata->>'model',
                   workshop = d.metadata->>'workshop',
                   part_name = d.metadata->>'part_name',
                   part_number = d.metadata->>'part_number',
                   source_type = d.metadata->>'source_type',
                   process_area = d.metadata->>'process_area',
                   document_name = d.metadata->>'operation_name'
             WHERE d.document_type_code = 'sop'
               AND d.workshop_id IS NULL
        $sql$;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.sync_sop_document_to_documents()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_workshop_id bigint;
    v_config_id bigint;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    SELECT w.id INTO v_workshop_id
      FROM public.workshops w
     WHERE w.name = NEW.workshop;

    SELECT c.id INTO v_config_id
      FROM public.document_workshop_codes c
     WHERE c.document_type_code = 'sop'
       AND c.workshop_id = v_workshop_id;

    INSERT INTO public.documents
        (id, document_type_code, document_number, document_code,
         document_workshop_code_id, workshop_id, created_by, created_at,
         updated_at, model, workshop, part_name, part_number, source_type,
         process_area, document_name)
    VALUES
        (NEW.id, 'sop', NEW.sop_number, NEW.sop_code, v_config_id,
         COALESCE(NEW.workshop_id, v_workshop_id), NEW.created_by, NEW.created_at,
         NEW.updated_at, NEW.model, NEW.workshop, NEW.part_name, NEW.part_number,
         NEW.source_type, NEW.process_area, NEW.operation_name)
    ON CONFLICT (id) DO UPDATE SET
        document_number = EXCLUDED.document_number,
        document_code = EXCLUDED.document_code,
        document_workshop_code_id = EXCLUDED.document_workshop_code_id,
        workshop_id = EXCLUDED.workshop_id,
        created_by = EXCLUDED.created_by,
        updated_at = EXCLUDED.updated_at,
        model = EXCLUDED.model,
        workshop = EXCLUDED.workshop,
        part_name = EXCLUDED.part_name,
        part_number = EXCLUDED.part_number,
        source_type = EXCLUDED.source_type,
        process_area = EXCLUDED.process_area,
        document_name = EXCLUDED.document_name;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_document_to_sop_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_workshop_name text;
BEGIN
    IF pg_trigger_depth() > 1 OR NEW.document_type_code <> 'sop' THEN
        RETURN NEW;
    END IF;

    SELECT w.name INTO v_workshop_name
      FROM public.workshops w
     WHERE w.id = NEW.workshop_id;

    INSERT INTO public.sop_documents
        (id, sop_number, sop_code, operation_name, source_type, created_at,
         created_by, updated_at, part_number, workshop, model, part_name,
         process_area, workshop_id)
    VALUES
        (NEW.id, NEW.document_number, NEW.document_code,
         COALESCE(NEW.document_name, ''), COALESCE(NEW.source_type, 'Created'),
         NEW.created_at, NEW.created_by, NEW.updated_at, NEW.part_number,
         COALESCE(NEW.workshop, v_workshop_name), NEW.model, NEW.part_name,
         NEW.process_area, NEW.workshop_id)
    ON CONFLICT (id) DO UPDATE SET
        sop_number = EXCLUDED.sop_number,
        sop_code = EXCLUDED.sop_code,
        updated_at = EXCLUDED.updated_at,
        operation_name = EXCLUDED.operation_name,
        source_type = EXCLUDED.source_type,
        part_number = EXCLUDED.part_number,
        workshop = EXCLUDED.workshop,
        model = EXCLUDED.model,
        part_name = EXCLUDED.part_name,
        process_area = EXCLUDED.process_area,
        workshop_id = EXCLUDED.workshop_id;

    PERFORM pg_catalog.setval(
        pg_catalog.pg_get_serial_sequence('public.sop_documents','id'),
        GREATEST(COALESCE((SELECT max(id) FROM public.sop_documents),1),1),
        true
    );

    RETURN NEW;
END;
$function$;

ALTER TABLE public.documents DROP COLUMN IF EXISTS metadata;

COMMIT;
