/* ================================================================
   GET /api/teacher/checkpoints
   Powers the Checkpoint Review surface in the dashboard.

   Headers: Authorization: Bearer <supabase access token>
   Query:
     class_id (optional) — restrict to one class
     module   (optional substring) — `module=ilike.*<value>*`
     since    (optional, ISO timestamp)
     limit    (optional, default 2000, max 10000)

   Returns: { rows: [...] }
   ================================================================ */

const { verifyTeacher, serviceQuery } = require('../../lib/teacher-auth.js');

module.exports = async (req, res) => {
  const requestedClassId = req.query && req.query.class_id ? String(req.query.class_id) : null;
  const ctx = await verifyTeacher(req, res, requestedClassId);
  if (!ctx) return;

  if (ctx.classIds.length === 0) {
    return res.status(200).json({ rows: [], teacher: ctx.teacher });
  }

  const since = req.query.since ? String(req.query.since) : null;
  const moduleFilter = req.query.module ? String(req.query.module) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 2000, 1), 10000);

  const filters = [
    `class_id=in.(${ctx.classIds.join(',')})`
  ];
  if (since) filters.push(`created_at=gte.${encodeURIComponent(since)}`);
  if (moduleFilter) filters.push(`module=ilike.*${encodeURIComponent(moduleFilter)}*`);

  try {
    const rows = await serviceQuery(
      `/rest/v1/checkpoints?select=id,class_id,student_id,student_name,module,lesson,response_text,score,created_at&${filters.join('&')}&order=created_at.desc&limit=${limit}`
    );
    return res.status(200).json({ rows, teacher: ctx.teacher });
  } catch (e) {
    console.error('teacher/checkpoints error:', e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};
