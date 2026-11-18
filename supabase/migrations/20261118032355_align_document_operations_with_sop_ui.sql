-- Add the document-level lifecycle status used for imported documents and catalog views.
alter table public.documents add column if not exists status text;
