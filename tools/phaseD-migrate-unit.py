#!/usr/bin/env python3
"""Phase D pilot migration — replace inline JS with UnitEngine boot
and rewrite onclick handlers across the lesson HTML.

Usage:  python phaseD-migrate-unit.py unit-1
        python phaseD-migrate-unit.py unit-2  (after pilot proven)

Idempotent: detects already-migrated pages and exits without changes.
"""
import re
import sys
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")

# Per-unit chart-helper templates. unit-1 has graph-question Panel 3
# helpers + Chart.js setup. Other units have nothing unit-specific
# (we'll add to this dict as we migrate them).
UNIT_INLINE_HELPERS = {
    "unit-1": '''<!-- Unit-1 specific: chart questions on Panel 3 (BIO.1c) -->
<script>
function graphPick(opt, correct) {
  if (opt.classList.contains('correct-ans') || opt.classList.contains('wrong-ans')) return;
  opt.parentElement.querySelectorAll('.graph-q-opt').forEach(function(s) { s.classList.add('neutral'); });
  if (correct) {
    opt.classList.remove('neutral'); opt.classList.add('correct-ans');
    var fb = document.getElementById('graph-feedback'); if (fb) fb.style.display = 'block';
  } else {
    opt.classList.remove('neutral'); opt.classList.add('wrong-ans');
    var fbw = document.getElementById('graph-feedback-w'); if (fbw) fbw.style.display = 'block';
  }
  UnitEngine.markAnswered('graph1', !!correct);
}
function graphPick2(opt, correct) {
  if (opt.classList.contains('correct-ans') || opt.classList.contains('wrong-ans')) return;
  opt.parentElement.querySelectorAll('.graph-q-opt').forEach(function(s) { s.classList.add('neutral'); });
  if (correct) {
    opt.classList.remove('neutral'); opt.classList.add('correct-ans');
    var fb = document.getElementById('graph2-feedback'); if (fb) fb.style.display = 'block';
  } else {
    opt.classList.remove('neutral'); opt.classList.add('wrong-ans');
    var fbw = document.getElementById('graph2-feedback-w'); if (fbw) fbw.style.display = 'block';
  }
  UnitEngine.markAnswered('graph2', !!correct);
}
function initCharts() {
  if (typeof Chart === 'undefined') return;
  var enzymeEl = document.getElementById('chartEnzyme');
  if (enzymeEl) {
    new Chart(enzymeEl, {
      type: 'line',
      data: { labels: ['0','10','20','30','37','45','55','65','70'],
        datasets: [{ label: 'Reaction Rate', data: [0,8,20,45,80,55,20,5,0],
          borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,.1)',
          fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#dc2626' }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: 'Temperature (°C)' } },
          y: { title: { display: true, text: 'Relative Reaction Rate' }, min: 0, max: 100 } } }
    });
  }
  var popEl = document.getElementById('chartPop');
  if (popEl) {
    new Chart(popEl, {
      type: 'line',
      data: { labels: ['Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7'],
        datasets: [
          { label: 'Species A', data: [10,20,35,55,80,110,145], borderColor: '#dc2626', tension: 0.3, pointRadius: 4 },
          { label: 'Species B', data: [60,65,60,55,50,40,30], borderColor: '#0f2240', tension: 0.3, pointRadius: 4 }
        ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { title: { display: true, text: 'Population Size' }, min: 0, max: 160 } } }
    });
  }
}
document.addEventListener('DOMContentLoaded', function() { initCharts(); });
</script>'''
}

# onclick handler rewrites: { old_function_name: new_dotted_call }
ONCLICK_REWRITES = {
    'gateAnswer':       'UnitEngine.onGateAnswer',
    'vqPick':           'UnitEngine.onVqPick',
    'flipCard':         'UnitEngine.onFlipCard',
    'solPick':          'UnitEngine.onSolPick',
    'goTo':             'UnitEngine.goTo',
    'retryVocab':       'UnitEngine.retryVocab',
    'retakePractice':   'UnitEngine.retakePractice',
    'submitFinalScore': 'UnitEngine.submitFinalScore',
    'showDangerZone':   'UnitEngine.showDangerZone',
    'startUnit':        'UnitEngine.startUnit',
    'signInWithGoogle': 'UnitEngine.signInWithGoogle',
    'startFresh':       'UnitEngine.startFresh',
    # graphPick / graphPick2 stay as inline helpers — unit-1-specific
}

CACHE_BUST = '2026-05-03-phaseD'


def boot_block(unit_key, unit_slug):
    """The replacement <script> tags for the inline JS block."""
    helpers = UNIT_INLINE_HELPERS.get(unit_slug, '')
    return f'''<script src="sol-api.js?v={CACHE_BUST}"></script>
<script src="dsm-player.js?v={CACHE_BUST}"></script>
<script src="unit-engine.js?v={CACHE_BUST}"></script>
<script src="config/{unit_slug}.js?v={CACHE_BUST}"></script>
{helpers}
<script>UnitEngine.boot(window.UNIT_CONFIG);</script>'''


def migrate(unit_slug):
    """unit_slug is like 'unit-1'."""
    path = BASE / f"{unit_slug}.html"
    text = path.read_text(encoding="utf-8", errors="surrogatepass")

    # Idempotency check
    if 'UnitEngine.boot' in text:
        print(f"  {unit_slug}.html: already migrated; skipping")
        return

    # Find the script block to replace.
    # Anchor: existing `<script src="../shared/error-reporter.js"></script>`
    # then sol-api.js + dsm-player.js + the big inline <script>...</script>
    # We replace from the sol-api.js script tag through the closing </script>.
    #
    # Two-step regex: find sol-api.js script tag (one line) and the final
    # </script> that closes the BIG inline block. The big inline block is
    # the longest <script>...</script> on the page (>1000 lines).
    script_block_re = re.compile(
        r'<script src="sol-api\.js[^"]*"></script>\s*'
        r'<script src="dsm-player\.js[^"]*"></script>\s*'
        r'<script>[\s\S]*?</script>',
        re.MULTILINE
    )
    match = script_block_re.search(text)
    if not match:
        print(f"  {unit_slug}.html: script-block anchor not found; aborting")
        sys.exit(1)
    new_block = boot_block(unit_slug, unit_slug)
    text = text[:match.start()] + new_block + text[match.end():]

    # Rewrite onclick handlers. Match `<name>(` (function call shape) but
    # ONLY inside onclick="" attributes to avoid false-matching anywhere
    # else (e.g. the inline helpers we just inserted).
    def rewrite_onclick(match):
        attr_value = match.group(1)
        for old, new in ONCLICK_REWRITES.items():
            # Only replace whole-token function calls, not substrings.
            attr_value = re.sub(r'\b' + re.escape(old) + r'\(', new + '(', attr_value)
        return f'onclick="{attr_value}"'

    text = re.sub(r'onclick="([^"]+)"', rewrite_onclick, text)

    path.write_text(text, encoding="utf-8", errors="surrogatepass")
    print(f"  {unit_slug}.html: migrated")


if __name__ == "__main__":
    targets = sys.argv[1:] if len(sys.argv) > 1 else ['unit-1']
    for t in targets:
        migrate(t)
    print("done.")
