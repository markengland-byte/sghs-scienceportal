/* ================================================================
   Teacher Auth Helper — used by /api/teacher/* serverless functions.

   Pattern (mirrors the fix in /api/generate-dsm.js from Phase A):

     1. Verify the Bearer JWT via Supabase /auth/v1/user. An invalid
        token returns 401 here, so we never fall through to the data
        query with a fake identity.
     2. Look up the teachers row by auth_user_id (matched against the
        verified user.id from step 1). Reject if not a teacher.
     3. Resolve the teacher's class scope:
          - admins: all classes
          - non-admins: only classes where teacher_id matches
     4. If the caller requested a specific class_id, validate it's
        inside their scope. Out-of-scope returns 403.

   All Supabase queries from steps 2-4 use the service-role key,
   bypassing RLS. This is the entire point of routing teacher reads
   through serverless functions: RLS scoping in Postgres + cross-table
   subqueries was the source of phantom-state. We do scoping here in
   JavaScript instead, where it's deterministic and debuggable.

   Required env vars on Vercel:
     SUPABASE_ANON_KEY         — used as apikey on /auth/v1/user calls
     SUPABASE_SERVICE_ROLE_KEY — used as Bearer + apikey for data reads
   ================================================================ */

const SUPABASE_URL = 'https://cogpsieldrgeqlemhosy.supabase.co';

function corsHeaders(res, allowedMethods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', (allowedMethods || ['GET']).concat('OPTIONS').join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Student data must never be cached — a teacher viewing the gradebook
  // should see fresh writes within seconds, not stale CDN snapshots.
  // Belt-and-suspenders: no-store prevents storage, no-cache forces
  // revalidation, must-revalidate disallows stale, max-age=0 sets TTL.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

async function _serviceFetch(path, opts) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY env var is not set');
    err.status = 500;
    throw err;
  }
  const o = opts || {};
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  if (o.prefer) headers['Prefer'] = o.prefer;
  const init = { method: o.method || 'GET', headers };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  const r = await fetch(`${SUPABASE_URL}${path}`, init);
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`Supabase ${path} returned ${r.status}: ${text.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
  // 204 No Content on DELETE returns empty body — don't try to JSON-parse.
  if (r.status === 204) return null;
  const text = await r.text();
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Verify the Bearer JWT and resolve the teacher's class scope.
 *
 * Returns { teacher, classIds } on success. On failure, sends an
 * error response and returns null — caller should `if (!ctx) return;`.
 *
 * Optional `requestedClassId` validates a query-param class_id is in
 * the teacher's scope and narrows the returned classIds to just that.
 */
async function verifyTeacher(req, res, requestedClassId, allowedMethods) {
  const methods = allowedMethods || ['GET'];
  corsHeaders(res, methods);
  if (req.method === 'OPTIONS') { res.status(200).end(); return null; }
  if (!methods.includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }
  const token = authHeader.split(' ')[1];

  // Step 1: Verify the JWT.
  let userRes;
  try {
    userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });
  } catch (e) {
    res.status(502).json({ error: 'Auth verification network error' });
    return null;
  }
  if (!userRes.ok) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
  const user = await userRes.json();
  if (!user || !user.id) {
    res.status(401).json({ error: 'Invalid token payload' });
    return null;
  }

  try {
    // Step 2: Look up the teacher row (using service-role key).
    const teachers = await _serviceFetch(
      `/rest/v1/teachers?select=id,is_admin,email,display_name&auth_user_id=eq.${encodeURIComponent(user.id)}`
    );
    if (!Array.isArray(teachers) || teachers.length === 0) {
      res.status(403).json({ error: 'Not a teacher' });
      return null;
    }
    const teacher = teachers[0];

    // Step 3: Resolve class scope.
    const classes = await _serviceFetch(
      teacher.is_admin
        ? `/rest/v1/classes?select=id,code,label,is_active&order=code.asc`
        : `/rest/v1/classes?select=id,code,label,is_active&teacher_id=eq.${teacher.id}&order=code.asc`
    );
    const classIds = classes.map(c => c.id);

    // Step 4: Validate optional class_id filter.
    if (requestedClassId) {
      if (!classIds.includes(requestedClassId)) {
        res.status(403).json({ error: 'Class not in your scope' });
        return null;
      }
      return { teacher, classIds: [requestedClassId], allClasses: classes };
    }

    return { teacher, classIds, allClasses: classes };
  } catch (e) {
    console.error('verifyTeacher error:', e);
    res.status(e.status || 500).json({ error: e.message });
    return null;
  }
}

/**
 * Run a service-role-key Supabase query. Used by endpoints after
 * verifyTeacher returns ok. Throws on non-2xx; caller should wrap.
 */
async function serviceQuery(path) {
  return _serviceFetch(path);
}

/**
 * Run a service-role-key Supabase mutation (POST/PATCH/DELETE).
 * `opts` mirrors the fetch init options: { method, body, prefer }.
 */
async function serviceMutate(path, opts) {
  return _serviceFetch(path, opts);
}

module.exports = {
  SUPABASE_URL,
  corsHeaders,
  verifyTeacher,
  serviceQuery,
  serviceMutate
};
