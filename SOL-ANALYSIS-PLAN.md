# SOL Score Analysis — Feature Plan

**Status:** Planning (waiting for SOL results, expected late May / early June 2026)
**Goal:** Determine whether platform usage predicts SOL performance, identify which metrics matter most, and generate per-standard accuracy comparisons.

---

## Research Questions

1. **Does the platform predict passing?** Logistic regression: platform metrics vs. pass/fail.
2. **Which platform metric is the best predictor?** Practice test pct, mastery attempts needed, time spent, number of retakes.
3. **Per-standard accuracy transfer.** Does scoring well on BIO.3 in practice predict scoring well on BIO.3 on the SOL?
4. **Dose-response.** Do students who spend more time / do more retakes perform better, or is there a plateau?
5. **Intervention targeting.** Which students were flagged "danger zone" on the platform and actually failed?

---

## Data Sources

### Platform Data (already in Supabase)

| Table | Key Fields | Granularity |
|-------|-----------|-------------|
| `scores` | `student_name`, `module`, `lesson`, `score`, `total`, `pct`, `time_on_quiz` | Per student, per quiz attempt |
| `quiz_detail` | `student_name`, `q_num`, `is_correct`, `standard` | Per student, per question, tagged by SOL standard |
| `dsm_attempts` | `student_name`, `module_id`, `rounds_completed`, `completed`, `questions_missed` | Per student, per mastery module |
| `activity` | `student_name`, `event`, `duration`, `metadata` | Per student, per event (includes `submit_score` with `stdBreakdown`) |
| `quiz_progress` | `student_name`, `module`, `progress_data` | Saved progress snapshots |

### SOL Results (to be imported)

Virginia SOL score reports include:
- Scaled score (0-600, pass = 400+)
- Pass / fail
- Per-standard breakdown (BIO.1 through BIO.8)
- Per-sub-standard scores

**Format TBD:** Could be CSV export, PDF report, or manual entry depending on how VDOE delivers results.

---

## New Supabase Table: `sol_results`

```sql
CREATE TABLE sol_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  student_name TEXT NOT NULL,
  class_id UUID REFERENCES classes(id),
  scaled_score INTEGER NOT NULL,
  passed BOOLEAN NOT NULL,
  -- Per-standard breakdown (Virginia BIO standards)
  bio1_score INTEGER,  -- Scientific Investigation
  bio2_score INTEGER,  -- Biochemistry & Energy
  bio3_score INTEGER,  -- Cell Structure & Function
  bio4_score INTEGER,  -- Bacteria & Viruses
  bio5_score INTEGER,  -- Genetics & Inheritance
  bio6_score INTEGER,  -- Classification & Diversity
  bio7_score INTEGER,  -- Evolution
  bio8_score INTEGER,  -- Ecology & Ecosystems
  school_year TEXT DEFAULT '2025-2026',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sol_results ENABLE ROW LEVEL SECURITY;
```

**Note:** Per-standard scores may need to be percentages or raw correct counts depending on how VDOE reports them. Adjust column types after seeing the actual report format.

---

## Student Matching

SOL results use legal names from the school roster. Platform uses self-entered `student_name` (canonicalized by `solAPI.canonicalizeName()`). Matching options:

1. **SSO students** — match via `students.auth_user_id` or `students.email` to a roster lookup. Most reliable.
2. **Legacy students** — fuzzy match on `student_name`. May need a manual mapping table for edge cases (nicknames, typos).
3. **Hybrid** — auto-match SSO students, flag non-matches for manual review.

---

## Analysis Methods

### Correlation & Regression
- **Pearson r:** Platform practice test pct vs. SOL scaled score
- **Logistic regression:** Platform metrics (practice pct, mastery attempts, time spent, retakes) vs. SOL pass/fail
- **Per-standard Pearson r:** Platform BIO.N accuracy (from `quiz_detail`) vs. SOL BIO.N score

### Derived Platform Metrics (computed from existing data)

| Metric | Source | Computation |
|--------|--------|-------------|
| Best practice test % | `scores` | `MAX(pct) WHERE lesson = 'Practice Test'` per student |
| Average practice test % | `scores` | `AVG(pct) WHERE lesson = 'Practice Test'` per student |
| Mastery attempts needed | `dsm_attempts` | `rounds_completed` per unit per student |
| Total time on quizzes | `scores` | `SUM(time_on_quiz)` per student |
| Per-standard accuracy | `quiz_detail` | `AVG(is_correct) WHERE standard = 'BIO.N'` per student |
| Danger zone count | `activity` | Count of practice tests with `pct < 60` |
| Platform engagement | `activity` | Total events / total duration per student |

### Visualizations
- Scatter plot: platform best practice pct vs. SOL scaled score
- Per-standard heatmap: platform accuracy vs. SOL accuracy (8x8 grid)
- ROI chart: time invested on platform vs. SOL score gain
- Confusion matrix: platform "danger zone" prediction vs. actual SOL fail

---

## Sample Size & Statistical Power

- **Current cohort:** ~20 students across 7 classes
- With N=20, correlations are directional but not statistically robust. Pearson r needs ~30+ for meaningful p-values.
- **If combining across classes/years:** pool data across all classes for stronger N. Year-over-year comparison becomes possible in 2026-2027.
- **Control group:** Did any students NOT use the platform? If so, compare their SOL scores to platform users. This is the strongest evidence for "does it help."

---

## Implementation Plan

### Phase 1: Schema & Import (when SOL scores arrive)
1. Create `sol_results` table in Supabase
2. Build a simple import tool (CSV upload or SQL paste)
3. Match students between SOL results and platform data
4. Validate: every SOL student has a platform record, flag mismatches

### Phase 2: Analysis Dashboard
1. Add an "SOL Analysis" tab to the teacher dashboard
2. Summary stats: N, pass rate, mean scaled score
3. Correlation table: each platform metric vs. SOL score
4. Per-standard comparison chart
5. Exportable data table for further analysis

### Phase 3: Predictive Model (optional, if N is large enough)
1. Logistic regression: which platform metrics best predict passing?
2. Decision boundary: "students above X% on practice tests passed Y% of the time"
3. Could feed back into the platform as an early-warning indicator for future cohorts

---

## Open Questions

- [ ] What format do SOL results come in? (CSV, PDF, online portal?)
- [ ] Are per-sub-standard scores available, or only per-standard?
- [ ] Any students who took the SOL but didn't use the platform? (control group)
- [ ] Should analysis be done in-dashboard (JS/Chart.js) or externally (Python/Jupyter)?
- [ ] Privacy considerations for storing SOL scores alongside platform data?
