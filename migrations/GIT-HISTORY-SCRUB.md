# Git History Scrub Instructions

The password `sghs2026` and Apps Script URLs were committed to git history. 
Even though they've been removed from the current code, they're still visible in old commits.

## When to Do This

Run this AFTER all code changes are committed and pushed. This rewrites history 
and requires a force push, so do it as the very last step.

## Option A: BFG Repo Cleaner (Recommended — Simpler)

```bash
# 1. Install BFG (requires Java)
#    Download from: https://rtyley.github.io/bfg-repo-cleaner/
#    Or: brew install bfg (macOS)

# 2. Create a file listing strings to replace
echo "sghs2026" > passwords.txt

# 3. Clone a fresh mirror
cd ~/Desktop
git clone --mirror https://github.com/markengland-byte/sghs-scienceportal.git

# 4. Run BFG to replace passwords in history
java -jar bfg.jar --replace-text passwords.txt sghs-scienceportal.git

# 5. Also remove the deleted apps-script-tracking.js from history
java -jar bfg.jar --delete-files apps-script-tracking.js sghs-scienceportal.git

# 6. Clean up
cd sghs-scienceportal.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 7. Force push (WARNING: rewrites all history)
git push --force

# 8. Clean up
rm passwords.txt
```

## Option B: git filter-repo (Alternative)

```bash
# 1. Install
pip install git-filter-repo

# 2. Clone fresh
cd ~/Desktop
git clone https://github.com/markengland-byte/sghs-scienceportal.git scrub-temp
cd scrub-temp

# 3. Replace password in all history
git filter-repo --replace-text <(echo "sghs2026==>***REMOVED***")

# 4. Force push
git remote add origin https://github.com/markengland-byte/sghs-scienceportal.git
git push --force --all
git push --force --tags
```

## After the Scrub

1. Delete any local clones and re-clone fresh
2. The old `apps-script-tracking.js` file will be removed from history
3. The password `sghs2026` will be replaced with `***REMOVED***` in all old commits
4. Vercel will auto-deploy from the new history (no action needed)

## What Gets Scrubbed

| Item | Current Status | In History? |
|------|---------------|-------------|
| `sghs2026` password | REMOVED from code | YES — needs scrub |
| Apps Script URLs | REMOVED from 85+ files | YES — but not sensitive (public URLs) |
| `apps-script-tracking.js` | DELETED | YES — contains password |
| Supabase anon key | Still in code (by design) | N/A — designed to be public |
