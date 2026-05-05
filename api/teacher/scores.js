/* ================================================================
   GET /api/teacher/scores
   Headers: Authorization: Bearer <supabase access token>
   Query:
     class_id    (optional) — restrict to one class. Required to be in
                              the caller's scope; 403 otherwise.
     since       (optional, ISO timestamp) — only rows after this time
     module      (optional substring) — `module=ilike.*<value>*`
     limit       (optional, default 5000, max 10000)

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
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 5000, 1), 10000);

  const filters = [
    `class_id=in.(${ctx.classIds.join(',')})`
  ];
  if (since) filters.push(`created_at=gte.${encodeURIComponent(since)}`);
  if (moduleFilter) filters.push(`module=ilike.*${encodeURIComponent(moduleFilter)}*`);

  try {
    const rows = await serviceQuery(
      `/rest/v1/scores?select=id,class_id,student_id,student_name,module,lesson,score,total,pct,time_on_quiz,assignment_id,created_at&${filters.join('&')}&order=created_at.desc&limit=${limit}`
    );
    return res.status(200).json({ rows, teacher: ctx.teacher });
  } catch (e) {
    console.error('teacher/scores error:', e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};
