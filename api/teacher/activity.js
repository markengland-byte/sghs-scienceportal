/* ================================================================
   GET /api/teacher/activity
   Powers the Activity tab + Live Pulse dashboard.

   Headers: Authorization: Bearer <supabase access token>
   Query:
     class_id (optional) — restrict to one class
     since    (optional, ISO timestamp) — only events after this time;
                                          Live Pulse passes ~today 4am
     event    (optional, exact match)   — e.g. event=heartbeat
     limit    (optional, default 5000, max 20000)

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
  const event = req.query.event ? String(req.query.event) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 5000, 1), 20000);

  const filters = [
    `class_id=in.(${ctx.classIds.join(',')})`
  ];
  if (since) filters.push(`created_at=gte.${encodeURIComponent(since)}`);
  if (event) filters.push(`event=eq.${encodeURIComponent(event)}`);

  try {
    const rows = await serviceQuery(
      `/rest/v1/activity?select=id,class_id,student_id,student_name,module,lesson,event,duration,metadata,created_at&${filters.join('&')}&order=created_at.desc&limit=${limit}`
    );
    return res.status(200).json({ rows, teacher: ctx.teacher });
  } catch (e) {
    console.error('teacher/activity error:', e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};
