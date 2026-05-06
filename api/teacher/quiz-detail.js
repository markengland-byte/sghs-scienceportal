/* ================================================================
   GET /api/teacher/quiz-detail
   Powers per-question drill-down in the dashboard. Per-row data is
   high-cardinality; use the limit and filters aggressively.

   Headers: Authorization: Bearer <supabase access token>
   Query:
     class_id     (optional) — restrict to one class
     module       (optional substring) — `module=ilike.*<value>*`
     student_name (optional substring) — useful when joining to a
                                          specific student's row in the
                                          Gradebook
     since        (optional, ISO timestamp)
     limit        (optional, default 2000, max 10000)

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
  const studentNameFilter = req.query.student_name ? String(req.query.student_name) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 2000, 1), 10000);

  const filters = [
    `class_id=in.(${ctx.classIds.join(',')})`
  ];
  if (since) filters.push(`created_at=gte.${encodeURIComponent(since)}`);
  if (moduleFilter) filters.push(`module=ilike.*${encodeURIComponent(moduleFilter)}*`);
  if (studentNameFilter) filters.push(`student_name=ilike.*${encodeURIComponent(studentNameFilter)}*`);

  try {
    const rows = await serviceQuery(
      `/rest/v1/quiz_detail?select=id,class_id,student_id,student_name,module,lesson,q_num,question_text,student_answer,correct_answer,is_correct,standard,created_at&${filters.join('&')}&order=created_at.desc&limit=${limit}`
    );
    return res.status(200).json({ rows, teacher: ctx.teacher });
  } catch (e) {
    console.error('teacher/quiz-detail error:', e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};
