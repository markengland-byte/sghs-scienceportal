/* ================================================================
   GET /api/teacher/students
   Headers: Authorization: Bearer <supabase access token>
   Query:
     class_id   (optional) — restrict to one class. Required to be in
                              the caller's scope; 403 otherwise.

   Returns: { rows: [{ id, email, display_name, enrolled_at, class_id }] }
   Used by the dashboard Overrides tab to list students enrolled in
   a class (including students who have not yet submitted any work).
   ================================================================ */

const { verifyTeacher, serviceQuery } = require('../../lib/teacher-auth.js');

module.exports = async (req, res) => {
  const requestedClassId = req.query && req.query.class_id ? String(req.query.class_id) : null;
  const ctx = await verifyTeacher(req, res, requestedClassId);
  if (!ctx) return;

  if (ctx.classIds.length === 0) {
    return res.status(200).json({ rows: [] });
  }

  try {
    // Join via student_classes -> students. PostgREST embeds with comma-prefixed table.
    const rows = await serviceQuery(
      `/rest/v1/student_classes?select=class_id,enrolled_at,students(id,email,display_name)&class_id=in.(${ctx.classIds.join(',')})&order=enrolled_at.asc`
    );
    const flat = rows
      .filter(r => r.students)
      .map(r => ({
        id: r.students.id,
        email: r.students.email,
        display_name: r.students.display_name,
        enrolled_at: r.enrolled_at,
        class_id: r.class_id
      }));
    return res.status(200).json({ rows: flat });
  } catch (e) {
    console.error('teacher/students error:', e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};
