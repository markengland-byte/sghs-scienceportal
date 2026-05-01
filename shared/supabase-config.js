/* ================================================================
   Supabase project config — single source of truth
   ================================================================

   Sets two globals that other client modules read at IIFE init:
     window.SUPABASE_URL
     window.SUPABASE_ANON_KEY  (the publishable key — safe to ship
                                 client-side; security comes from RLS)

   To rotate: change the values here AND in sol-prep/sol-api.js +
   shared/portal-api.js (the latter two carry hardcoded fallbacks
   because most of the bio/AP/physics HTML files don't yet load
   this script — full centralization is a future task).

   Service-role key is never embedded client-side. It lives only in
   Vercel env vars (`SUPABASE_SERVICE_ROLE_KEY`) and is read by the
   teacher endpoints under api/teacher/.
   ================================================================ */
window.SUPABASE_URL = 'https://cogpsieldrgeqlemhosy.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_Wn4L2S2gMPq2cLoiLt2tIQ_z4e7IUZU';
