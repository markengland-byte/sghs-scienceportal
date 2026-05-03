-- ================================================================
-- FERPA Phase 2.5b — Schema additions for teacher tables
-- ================================================================
-- Denormalize auth_user_id onto classes / dsm_modules / dsm_questions
-- / student_classes so RLS can use direct `auth.uid() = <col>`
-- checks instead of cross-table SECURITY DEFINER subqueries.
--
-- Companion migration 013 rewrites the RLS to use these columns
-- and drops the get_teacher_id / get_student_id / get_my_class_ids
-- helper functions that are no longer needed.
-- ================================================================

ALTER TABLE classes         ADD COLUMN IF NOT EXISTS teacher_auth_user_id    UUID;
ALTER TABLE dsm_modules     ADD COLUMN IF NOT EXISTS created_by_auth_user_id UUID;
ALTER TABLE dsm_questions   ADD COLUMN IF NOT EXISTS created_by_auth_user_id UUID;
ALTER TABLE student_classes ADD COLUMN IF NOT EXISTS auth_user_id            UUID;

CREATE INDEX IF NOT EXISTS idx_classes_teacher_auth          ON classes(teacher_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_dsm_modules_created_by_auth   ON dsm_modules(created_by_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_dsm_questions_created_by_auth ON dsm_questions(created_by_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_student_classes_auth          ON student_classes(auth_user_id);

-- Backfill: classes ← teachers.auth_user_id via teacher_id
UPDATE classes c SET teacher_auth_user_id = t.auth_user_id
FROM teachers t WHERE c.teacher_id = t.id AND c.teacher_auth_user_id IS NULL;

-- Backfill: dsm_modules ← teachers.auth_user_id via created_by
UPDATE dsm_modules m SET created_by_auth_user_id = t.auth_user_id
FROM teachers t WHERE m.created_by = t.id AND m.created_by_auth_user_id IS NULL;

-- Backfill: dsm_questions ← dsm_modules.created_by_auth_user_id
UPDATE dsm_questions q SET created_by_auth_user_id = m.created_by_auth_user_id
FROM dsm_modules m WHERE q.module_id = m.id AND q.created_by_auth_user_id IS NULL;

-- Backfill: student_classes ← students.auth_user_id via student_id
UPDATE student_classes sc SET auth_user_id = s.auth_user_id
FROM students s WHERE sc.student_id = s.id AND sc.auth_user_id IS NULL;

-- BEFORE INSERT trigger on student_classes auto-fills auth_user_id
-- from the student'"'"'s record. Saves callers from passing it explicitly.
-- A malicious caller passing another student'"'"'s student_id gets THAT
-- student'"'"'s auth_user_id, which fails the WITH CHECK against the
-- caller'"'"'s auth.uid() — so this is safe.
CREATE OR REPLACE FUNCTION student_classes_set_auth_user_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    NEW.auth_user_id := (SELECT auth_user_id FROM public.students WHERE id = NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger functions don't need to be RPC-callable.
REVOKE EXECUTE ON FUNCTION public.student_classes_set_auth_user_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_student_classes_auth_user_id ON student_classes;
CREATE TRIGGER trg_student_classes_auth_user_id
  BEFORE INSERT ON student_classes
  FOR EACH ROW EXECUTE FUNCTION student_classes_set_auth_user_id();

NOTIFY pgrst, 'reload schema';
