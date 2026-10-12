-- Expose only the fields needed to display SOP creator names to authenticated users.
-- The view intentionally allows name lookup without granting broad access to user_profiles.
CREATE OR REPLACE VIEW public.user_profile_names AS
SELECT id, full_name
FROM public.user_profiles;

GRANT SELECT ON public.user_profile_names TO authenticated;
