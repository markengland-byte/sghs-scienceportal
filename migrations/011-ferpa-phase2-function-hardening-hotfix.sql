-- ================================================================
-- Hotfix for migration 009 (function hardening)
-- ================================================================
-- Migration 009 applied `SET search_path = ''` to is_admin(),
-- get_student_id(), get_teacher_id(), get_my_class_ids() to satisfy
-- advisor lint 0011 (search-path injection class). But the function
-- bodies referenced `teachers`, `students`, `classes` without schema
-- qualification — fine with the default search_path of "$user, public",
-- broken with search_path=''.
--
-- Symptom in production: any RLS policy that calls is_admin()
-- (which is most of them post-Phase-2) raised:
--   { code: '42P01', message: 'relation "students" does not exist' }
-- This blocked the sign-in path during Phase D pilot — initAuth
-- couldn't read the students table, so applySSOSession never fired,
-- so users sat on the sign-in modal even after a successful Google
-- OAuth roundtrip.
--
-- Fix: recreate each function with `public.<table>` qualification
-- so resolution works even with search_path=''. Keeps the security
-- hardening from 009 while restoring correct behavior.
-- ================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.teachers WHERE auth_user_id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.get_student_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.students WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.teachers WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_class_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.classes
  WHERE teacher_id = (SELECT id FROM public.teachers WHERE auth_user_id = auth.uid());
$$;

NOTIFY pgrst, 'reload schema';
