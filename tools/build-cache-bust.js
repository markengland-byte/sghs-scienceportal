#!/usr/bin/env node
/* ================================================================
   Cache-bust build step (Vercel) — replaces ?v=__HASH__ placeholders
   in HTML <script> and <link> tags with the SHA-10 of the referenced
   asset's content.

   Source HTML (committed to git):
     <script src="unit-engine.js?v=__HASH__"></script>
     <link href="dsm-player.css?v=__HASH__" rel="stylesheet">

   After build (served by Vercel):
     <script src="unit-engine.js?v=a3f9c2d1b4"></script>
     <link href="dsm-player.css?v=7e2f4a91c0" rel="stylesheet">

   When the asset's content changes, the hash changes, the URL changes,
   the browser fetches fresh. No manual version bumping ever again.

   Idempotent: only matches `?v=__HASH__` — files that already have
   real hashes are left alone. Safe to run multiple times.

   Skips external URLs (https://...) — only resolves relative paths.
   No npm dependencies — uses only Node built-ins.
   ================================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const HASH_LEN = 10;
// Audit #16: accept both " and ' as the attribute quote (HTML5 allows
// either). Capture the actual quote char and rebuild with the same.
const PLACEHOLDER_RE = /(<(?:script|link)[^>]*?(?:src|href)=)(["'])([^"':]+?)\?v=__HASH__\2([^>]*?>)/g;

function sha10(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, HASH_LEN);
}

function processHtml(htmlPath) {
  const dir = path.dirname(htmlPath);
  let text;
  try {
    text = fs.readFileSync(htmlPath, 'utf-8');
  } catch (e) {
    console.warn(`  skip ${htmlPath}: ${e.message}`);
    return { count: 0, missing: [] };
  }
  if (!text.includes('?v=__HASH__')) {
    return { count: 0, missing: [] };
  }

  let count = 0;
  const missing = [];
  text = text.replace(PLACEHOLDER_RE, (match, prefix, quote, src, suffix) => {
    // Skip external URLs.
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      return match;
    }
    const filePath = path.resolve(dir, src);
    if (!fs.existsSync(filePath)) {
      missing.push(src);
      return match; // leave placeholder as-is so Vercel build still succeeds
    }
    const hash = sha10(filePath);
    count++;
    return `${prefix}${quote}${src}?v=${hash}${quote}${suffix}`;
  });

  if (count > 0 || missing.length > 0) {
    if (count > 0) fs.writeFileSync(htmlPath, text);
    const rel = path.relative(ROOT, htmlPath);
    console.log(`  ${rel}: hashed ${count} reference(s)${missing.length ? ', MISSING: ' + missing.join(', ') : ''}`);
  }
  return { count, missing };
}

function* walkHtml(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'tools') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) yield full;
  }
}

console.log('[cache-bust] building from', ROOT);
let total = 0, missing = 0;
for (const htmlPath of walkHtml(ROOT)) {
  const r = processHtml(htmlPath);
  total += r.count;
  missing += r.missing.length;
}
console.log(`[cache-bust] done — hashed ${total} reference(s) total${missing ? `, ${missing} missing path(s) skipped` : ''}`);
