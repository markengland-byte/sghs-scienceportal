/* ================================================================
   /api/teacher/student-override
   Headers: Authorization: Bearer <supabase access token>

   GET    ?class_id=...                   list overrides for one class
   POST   { student_id, module_key, unlocked, reason? }   upsert
   DELETE { student_id, module_key }                      clear

   Authorization scope: a teacher can only set/clear/list overrides
   for students in classes they teach (or any class if is_admin).

   Returns: { row } on POST, { ok: true } on DELETE,
            { rows: [...] } on GET.
   ================================================================ */

const { verifyTeacher, serviceQuery, serviceMutate } = require('../../lib/teacher-auth.js');

const VALID_MODULE_KEYS = new Set([
  'unit-1','unit-2','unit-3','unit-4',
  'unit-5','unit-6','unit-7','unit-8',
  'practice-test'
]);

async function studentInScope(studentId, classIds) {
  if (!classIds || classIds.length === 0) return false;
  const path = `/rest/v1/student_classes?select=student_id&student_id=eq.${encodeURIComponent(studentId)}&class_id=in.(${classIds.join(',')})&limit=1`;
  const rows = await serviceQuery(path);
  return Array.isArray(rows) && rows.length > 0;
}

module.exports = async (req, res) => {
  const requestedClassId = req.query && req.query.class_id ? String(req.query.class_id) : null;
  const ctx = await verifyTeacher(req, res, requestedClassId, ['GET','POST','DELETE']);
  if (!ctx) return;

  try {
    if (req.method === 'GET') {
      if (ctx.classIds.length === 0) return res.status(200).json({ rows: [] });
      // Pull all student_ids in scope, then their overrides.
      const studentLinks = await serviceQuery(
        `/rest/v1/student_classes?select=student_id&class_id=in.(${ctx.classIds.join(',')})`
      );
      const studentIds = Array.from(new Set(studentLinks.map(r => r.student_id)));
      if (studentIds.length === 0) return res.status(200).json({ rows: [] });
      const rows = await serviceQuery(
        `/rest/v1/student_module_overrides?select=id,student_id,module_key,unlocked,reason,created_at,updated_at&student_id=in.(${studentIds.join(',')})&order=updated_at.desc`
      );
      return res.status(200).json({ rows });
    }

    // For POST/DELETE we need a body. Vercel parses JSON automatically
    // when Content-Type: application/json is set; req.body is the obj.
    const body = req.body || {};
    const studentId = body.student_id ? String(body.student_id) : null;
    const moduleKey = body.module_key ? String(body.module_key) : null;
    if (!studentId || !moduleKey) {
      return res.status(400).json({ error: 'student_id and module_key are required' });
    }
    if (!VALID_MODULE_KEYS.has(moduleKey)) {
      return res.status(400).json({ error: 'invalid module_key' });
    }
    const inScope = await studentInScope(studentId, ctx.classIds);
    if (!inScope) {
      return res.status(403).json({ error: 'Student not in your class scope' });
    }

    if (req.method === 'POST') {
      if (typeof body.unlocked !== 'boolean') {
        return res.status(400).json({ error: 'unlocked must be a boolean' });
      }
      const reason = body.reason ? String(body.reason).slice(0, 500) : null;
      // Upsert via on_conflict on the unique constraint (student_id, module_key).
      const created = await serviceMutate(
        `/rest/v1/student_module_overrides?on_conflict=student_id,module_key`,
        {
          method: 'POST',
          body: {
            student_id: studentId,
            module_key: moduleKey,
            unlocked: body.unlocked,
            reason: reason,
            created_by: ctx.teacher.id
          },
          prefer: 'resolution=merge-duplicates,return=representation'
        }
      );
      const row = Array.isArray(created) ? created[0] : created;
      return res.status(200).json({ row });
    }

    if (req.method === 'DELETE') {
      await serviceMutate(
        `/rest/v1/student_module_overrides?student_id=eq.${encodeURIComponent(studentId)}&module_key=eq.${encodeURIComponent(moduleKey)}`,
        { method: 'DELETE' }
      );
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error('teacher/student-override error:', e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};
