# Phase-1 Workflow Walkthrough

## 1. Start the system

```bash
docker-compose down && docker-compose up --build
```

On first boot the backend will:
1. Run Alembic migrations (schema up-to-date)
2. Run `seed.py` — creates the admin account and default skills if they don't exist

---

## 2. Login

URL: `http://localhost`

| Field    | Value                        |
|----------|------------------------------|
| Email    | mounish.k@tektalis.com       |
| Password | Mouni@2003                   |

---

## 3. Configure a Job Role

Go to **Configure** in the sidebar.

### 3a. Create or select a role
- Click **New** to start a fresh role, or select an existing one from the dropdown.
- Set **Role Title** (e.g. "Senior ML Engineer") and **Min. Experience** (e.g. `3`).
- Use **Candidate Level Filter** pills to restrict evaluation to Junior / Mid / Senior / Executive candidates. Leave blank to allow all levels.

### 3b. Set scoring weights (sidebar)
The three sliders (Projects / Skills / Education) must sum to 100 %. Adjust one — the others auto-redistribute.

Example for an ML role:
| Dimension  | Weight |
|------------|--------|
| Projects   | 50 %   |
| Skills     | 30 %   |
| Education  | 20 %   |

### 3c. Add a Job Description
Paste the full JD into the **Full Job Description** textarea, or upload a PDF/DOCX.  
The AI uses this text for semantic alignment scoring of each resume section.

### 3d. Education filters (optional)
Set **Minimum Degree** (Bachelor / Master / PhD) and add **Preferred Majors**.

### 3e. Scoring Criteria (optional — replaces weights when saved)
Click **+ Add requirement** to define specific scored criteria, e.g.:
- "Python 3+ years" → type: Experience, min_years: 3, weight: 40 %
- "CS degree" → type: Education, weight: 30 %
- "ML frameworks" → type: Skill, weight: 30 %

Weights must sum to 100 % before saving. Click **Save requirements**.

### 3f. Auto-Pause (optional)
| Field            | Purpose                                              |
|------------------|------------------------------------------------------|
| Shortlist Target | Pause intake after N qualified candidates are found  |
| Min Fit Score %  | Score threshold that counts as "qualified" (e.g. 70) |

Click **Save Role** / **Update Role** to persist all settings.

---

## 4. Add skills to the taxonomy
Use the **Skill Taxonomy** panel at the bottom of Configure.  
Type a skill name, choose a category, press **Add**. Then click any skill pill to add it to the required-skills list for the active role.

---

## 5. Upload resumes

Go to **Upload** in the sidebar.

- Drag & drop or select PDF/DOCX files (up to 20 MB each).
- The parser extracts text, segments it into sections (Summary, Skills, Projects, Education, Experience, etc.), and stores a structured resume.

> **Tip:** Resumes emailed to `careers@tektalis.com` are also ingested automatically every 120 s via IMAP.

---

## 6. Run evaluation

Go to **Evaluate** in the sidebar.

1. Select the **Job Role** from the dropdown.
2. Leave "All resumes" selected (or pick specific ones).
3. Click **Run Evaluation**.

The system will:
- Skip resumes that don't meet `min_experience` or the experience-level filter.
- Score each remaining resume using TF-IDF skill match + semantic JD alignment + education check.
- Return a ranked leaderboard with fit scores and section breakdowns.

---

## 7. Leaderboard & Candidate Detail

Go to **Leaderboard** in the sidebar.

- Candidates are ranked by fit score (highest first).
- Each row shows score breakdown: Skills %, Projects %, Education %.
- Click a candidate to view the **Candidate Detail** page with per-section evidence, matched skills, and education info.

---

## 8. Critical Mass / Auto-Pause

When `shortlist_target` is set and enough qualified candidates accumulate:
- Intake is paused automatically (new uploads still parse but are not re-evaluated).
- An alert email is sent to the configured SMTP address.
- The role shows **(paused)** in the dropdown and an "Intake Paused" badge in Configure.
- To resume manually, click **Resume Intake** on the Configure page.

---

## 9. User Management (Admin only)

Go to **Users** in the sidebar.

- **Create** a new recruiter or admin — credentials are emailed automatically.
- **Reset PW** — sends a new password to the user's email.
- **Revoke / Restore** — disables or re-enables account access without deleting.
- **Delete** — permanently removes the account (cannot delete your own account or the last admin).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Save failed" on job role | Restart backend so `_apply_schema_patches` adds new columns |
| Projects score 0 % | Call `POST /upload/resegment-all` then re-run evaluation |
| IMAP not picking up emails | Verify `IMAP_*` vars in `backend/.env`; check spam folder |
| Pyrefly red underlines in VS Code | Set Python interpreter to `backend/venv/Scripts/python.exe` |
