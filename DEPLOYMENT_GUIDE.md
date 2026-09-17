# 🚀 Deployment Guide

> Complete step-by-step instructions for deploying the Job Search Tracker to production.

## 📋 Quick Checklist
- [ ] All tests passing: `npm test`
- [ ] Production build works: `npm run build`
- [ ] Supabase project created and credentials saved
- [ ] Database migrations applied (see [Database Migrations](#step-1-database-migrations))
- [ ] Environment variables set in Vercel
- [ ] Smoke tests passed on production URL

---

## Table of Contents
1. [Pre-Deployment Setup](#pre-deployment-setup)
2. [Step 1: Database Migrations](#step-1-database-migrations)
3. [Step 2: Deploy Edge Functions](#step-2-deploy-edge-functions)
4. [Step 3: Vercel Deployment](#step-3-vercel-deployment)
5. [Step 4: Post-Deployment Verification](#step-4-post-deployment-verification)
6. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Setup

### ✅ Requirements
- [ ] GitHub account with push access to repo
- [ ] Vercel account (free tier OK)
- [ ] Supabase account (free tier OK)
- [ ] Node.js 18+ and npm installed
- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Supabase project created at [supabase.com](https://supabase.com)

### Local Code Review

```bash
# Start dev server and spot-check features
npm run dev
# → Open http://localhost:5173
# → Create test job, verify Kanban drag-and-drop works
# → Check analytics dashboard loads

# Run all tests
npm test
# → Should show 200+ passing tests

# Build for production
npm run build
# → Should succeed with no TypeScript errors

# Optional: Check bundle size
ls -lh dist/assets/
# → Main bundle should be < 150KB gzipped
```

---

## Step 1: Database Migrations

### 📌 Important: Migrations Must Run First
Edge functions depend on database tables. **Run these before deploying functions.**

### Full Migration Guide
The complete, canonical database migration steps live in **[texts/database_migrations.md](texts/database_migrations.md)**.

**Key migrations to apply (in order):**

1. **Main schema** (jobs, job_status_history tables)
   - See: `texts/database_schema_v3_migration.txt`

2. **Resume feature** (resume_snapshots, resume_templates tables)
   - See: `texts/resumes_feature_migration.sql`

3. **RLS policies & constraints**
   - See: `texts/supabase_fix.sql`

4. **Analytics cache** (NEW - May 7, 2026)
   ```sql
   BEGIN;
   
   CREATE TABLE IF NOT EXISTS public.analytics_cache (
     user_id uuid NOT NULL,
     metric_name text NOT NULL,
     payload jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, metric_name)
   );
   
   CREATE INDEX IF NOT EXISTS analytics_cache_updated_at_idx 
     ON public.analytics_cache (updated_at);
   
   CREATE OR REPLACE FUNCTION public.upsert_analytics_cache(
     p_user uuid, p_metric text, p_payload jsonb
   )
   RETURNS void LANGUAGE plpgsql AS $$
   BEGIN
     INSERT INTO public.analytics_cache (user_id, metric_name, payload, updated_at)
     VALUES (p_user, p_metric, p_payload, now())
     ON CONFLICT (user_id, metric_name) DO UPDATE
     SET payload = EXCLUDED.payload,
         updated_at = now();
   END;
   $$;
   
   COMMIT;
   ```

### How to Apply Migrations

**Via Supabase Dashboard (Easiest):**
1. Open [app.supabase.com](https://app.supabase.com)
2. Select your project
3. Go to **SQL Editor**
4. Click **"New Query"**
5. Copy-paste each SQL migration above
6. Click **"Run"**
7. Verify success (no error messages)

**Via Supabase CLI:**
```bash
supabase db pull  # Download current schema
supabase db push  # Apply any pending migrations
```

---

## Step 2: Deploy Edge Functions

### 🔐 Authenticate Supabase CLI

```bash
# Interactive login (opens browser)
supabase login

# Link your local repo to Supabase project
supabase link --project-ref YOUR_PROJECT_REF
# → To find YOUR_PROJECT_REF: Open Supabase dashboard → Settings → General → Project Ref
```

### Deploy Functions

**There is nothing to deploy.** This project has no edge functions: all four
were deleted on 2026-09-15 and 2026-09-17, none of them having ever been
deployed. The work runs as Next.js routes — `/api/cv/pdf`, `/api/cv/docx`,
`/api/cv/latex`, `/api/autofill`, `/api/tailor` — which ship with the Vercel
deployment and need no separate step. See the README for why each one moved.

---

## Step 3: Vercel Deployment

### Option A: Automatic (Recommended)

```bash
# Just push to main — Vercel auto-deploys
git push origin main
```

Vercel will:
1. Trigger CI workflow
2. Run tests
3. Build for production
4. Deploy to vercel.app domain

### Option B: Manual Setup

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **"Add New...\" > \"Project\"**
3. **Import Git Repository**
   - Select your GitHub repo
   - Select `main` branch for production
   - (Optional) Select `develop` branch for preview deployments
4. **Configure Build Settings**
   - Framework: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. **Add Environment Variables**

   ```
   VITE_SUPABASE_URL = https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY = your-anon-key
   VITE_SENTRY_DSN = your-sentry-dsn (optional)
   VITE_SENTRY_ENVIRONMENT = production (optional)
   ```

6. Click **"Deploy"**

Vercel will build and deploy. Monitor the deployment in the **Deployments** tab.

---

## Step 4: Post-Deployment Verification

### 🧪 Smoke Tests (5-10 minutes)

#### 1. Site Is Live
```
Visit: https://your-project.vercel.app
✓ Page loads (no 404 or blank screen)
✓ No console errors (press F12 → Console)
✓ Dark/Light mode toggle works
```

#### 2. Authentication Flow
```
✓ Click "Sign In"
✓ Enter email and click sign-in link
✓ Redirected to dashboard
✓ User email shown in sidebar
✓ Page doesn't break when logged in
✓ Dark mode preference persists on refresh
```

#### 3. Job Management
```
✓ Click "Jobs" tab
✓ Add a new job (fill all fields)
✓ Verify job appears in list
✓ Drag job between Kanban columns
✓ Click a job to open details
✓ Edit job and save
✓ Delete job
```

#### 4. Analytics Dashboard
```
✓ Click "Dashboard" tab
✓ Charts load (may take 10-15s for compute on first request)
✓ No error messages
✓ Try different date ranges (if filter available)
```

#### 5. Resume Builder (Optional)
```
✓ Click "Resume" tab
✓ Enter resume content
✓ Click "Export PDF"
✓ PDF downloads successfully
```

### 📊 Verify Edge Functions Are Working

**Check Job Auto-fill:**
1. In dashboard, add a new job
2. Paste a LinkedIn or Indeed URL in the URL field
3. Click **"Auto-fill from URL"**
4. Job fields should populate automatically
5. If error: `/api/autofill` reaches the extractor over a Vercel service
   binding, so check that `EXTRACTOR_URL` is bound and the extractor is
   deployed — locally it is a separate process, and `npm run dev` does not
   start it

**Check the logs:** Vercel → the project → Logs, filtered to `/api/autofill`.
That is this app's whole logging story; see `lib/securityLog`.

### 🎯 Monitor Performance

**Optional: Set Up Sentry Alerts**
- If you configured `VITE_SENTRY_DSN` in Vercel:
  1. Go to [sentry.io/organizations/your-org/issues](https://sentry.io)
  2. You should see errors (if any) from the API routes and the browser
  3. Click an error to see stack trace and affected users

**Analytics are not cached server-side.** `analytics_cache` is still in the
schema and is empty: the function that filled it was never deployed, and it was
deleted rather than deployed on 2026-09-17 because its numbers no longer
matched the ones the charts read. Every metric is computed per request and held
in the browser by TanStack Query for 5–10 minutes.

---

## Troubleshooting

### Issue: "Cannot coerce the result to a single JSON object"
**Cause**: Using `.single()` when query returns no rows  
**Solution**: This should be fixed in code (use `.maybeSingle()`), but if you see it:
1. Check database has data for that user
2. Check RLS policies aren't blocking the query
3. Review `jobService.ts` for any `.single()` calls

### Issue: "Authentication required" on CSV export
**Cause**: Session expired  
**Solution**:
1. Sign out and sign back in
2. Try export again

### Issue: Resume PDF export fails
**Cause**: `/api/cv/pdf` returned an error, or the session token was missing  
**Solution**: read the toast. `Export failed (500)` means the route answered and
the Vercel log for `/api/cv/pdf` has the reason; `Failed to fetch` means the
request never completed at all, which is CORS, DNS or a dropped connection —
never a 500.

### Issue: Jobs from other accounts visible
**Cause**: RLS not enabled  
**Solution**: Run migration SQL again, verify policies exist

### Issue: Dark mode doesn't persist
**Cause**: LocalStorage disabled  
**Solution**: Check browser settings, try incognito mode

### Issue: Sidebar collapse doesn't persist
**Cause**: LocalStorage error  
**Solution**: Same as dark mode issue above

---

## Rollback Plan

If deployment breaks production:

### Immediate (< 5 min)
1. Go to Vercel Dashboard
2. Select project
3. Go to **Deployments**
4. Find last known-good deployment
5. Click **Redeploy**

### Database Rollback (< 10 min)
1. Go to Supabase console
2. Database → Backups
3. Restore from backup created before migration
4. Re-run any safe migrations

---

## Post-Launch Checklist

- [ ] Monitor Sentry for errors (24 hours)
- [ ] Confirm API route telemetry is flowing to logs/Sentry
- [ ] Verify database backups run daily
- [ ] Set up Vercel analytics alerts
- [ ] Update user documentation
- [ ] Announce deployment
- [ ] Collect user feedback
- [ ] Plan next sprint

---

## Support

**Deployment Issues**: Check Vercel logs and Supabase status page  
**Data Issues**: Check Supabase query performance  
**UI Issues**: Browser console for errors, Sentry for production errors

Last updated: May 6, 2026

---

## Renaming the repository (and the Vercel domain that follows it)

Written 2026-09-15, when the rename was planned. Renaming the GitHub repo
changes the Vercel project's default domain, and **most of the fallout is
silent** — the build stays green and the app keeps serving while auth breaks.
This is the order that avoids that.

### What does NOT need touching

The deployment origin is already derived, not written down:

| Thing | Where it comes from |
|---|---|
| `metadataBase`, `sitemap.xml`, `robots.txt` | `src/lib/siteUrl.ts` → `NEXT_PUBLIC_SITE_URL`, falling back to `VERCEL_URL` |
| Supabase `site_url` and the redirect allow-list in `config.toml` | `env(SUPABASE_AUTH_SITE_URL)` |

So the only code change is the handful of literals below.

### 1. In the repo — done on 2026-09-15 for the rename to `Worktrack`

| File | What | Status |
|---|---|---|
| `src/components/landing/content.ts` | `REPO_URL`. **User-visible**: the hero's "read the source" button, the navbar's "open source" link, and `COMMITS_URL` all derive from it. | ✅ done |
| `package.json` | `homepage`. Was **already stale** before any rename — it named a `github.io` Pages URL for an app deployed on Vercel. Now the repo URL, which stays true when the Vercel domain changes. | ✅ done |
| `supabase/config.toml` | `project_id`. A local CLI label only: the linked hosted project lives in the gitignored `supabase/.temp/project-ref` and is unaffected. | ✅ done |
| `CONTRIBUTING.md` | the `git clone` / `cd` lines and the issues link. Also replaced the `yourusername` placeholder, which was never right. | ✅ done |
| `README.md` | the **Live** link near the top. | ✅ done — `worktrack-jobs.vercel.app` |

**⚠️ DO NOT CHANGE THE LINEAGE LINK IN `README.md`.** The first blockquote
points at `github.com/Ensues/Job-Search-Tracker-Analytics-Dashboard`, which is
**Ensues' original repository — a different repo that is not being renamed**.
An earlier draft of this checklist listed it for updating, which would have
broken the attribution and pointed the credit at a repo that does not exist.
A `git grep Job-Search-Tracker-Analytics-Dashboard` should return exactly that
one line and nothing else.

GitHub keeps redirecting the old URL after a rename, so `REPO_URL` would not
have 404'd in the meantime — but it would have sent readers to a name that no
longer exists, which on a portfolio page is the wrong first impression.

### 2. Outside the repo — done on 2026-09-15, with one surprise

**`worktrack.vercel.app` WAS ALREADY TAKEN by another Vercel account**, which
is the thing this section did not anticipate. Renaming the project therefore
changed its NAME but not its DOMAIN: Vercel only auto-assigns
`<project>.vercel.app` when that subdomain is free, and when it is not it
silently leaves the existing one in place. The project was called `worktrack`
while still serving from `job-search-tracker-analytics-dashbo-one.vercel.app`,
and nothing reported a problem — the rename looked like it had worked.

The fix was to attach a free subdomain explicitly rather than hope for one.
**The old domain was kept**, not removed: it is in the Supabase redirect
allow-list, it is what any existing link points at, and a project may hold
several `.vercel.app` domains at no cost. Removing it would have been the only
genuinely breaking step in this whole rename.

### The steps, in this order

1. **Rename on GitHub.** Settings → General → Repository name → `Worktrack`.
   Or: `gh repo rename Worktrack`. Your local remote keeps working via
   GitHub's redirect; update it anyway so the redirect is not load-bearing:
   `git remote set-url origin git@github.com:NightServant/Worktrack.git`
2. **Rename the Vercel project.** This changes the production domain. Note the
   new origin — everything below needs it, and so does the README's Live link
   from step 1.
3. **Set `NEXT_PUBLIC_SITE_URL`** in Vercel → Settings → Environment Variables
   to the new origin, and redeploy. Without it `siteUrl` falls back to
   `VERCEL_URL`, which is the *deployment* hostname and differs per deployment —
   so the sitemap and `og:image` would point at a preview URL.
4. **⚠️ Supabase dashboard → Authentication → URL Configuration.** Add the new
   origin to the redirect allow-list. **This is the one that breaks silently:**
   `signInWithProvider` sends `redirectTo: ${window.location.origin}/dashboard`,
   and an origin that is not on the allow-list makes Google and Microsoft
   sign-in fail *after* the user has already authorised — with a provider error
   page, not one of ours. Nothing in this repo can detect it.
5. **`SUPABASE_AUTH_SITE_URL=https://<new-origin> npm run push:auth-config`.**
   This rewrites `site_url` and the allow-list from `config.toml`, which is
   what puts the new origin into the confirmation emails. Never
   `supabase config push` directly — see `docs/SECURITY.md`.

### 3. Verify, in this order

```bash
curl -sI https://<new-origin>/ | head -1          # 200
curl -s  https://<new-origin>/robots.txt          # Sitemap: names the NEW origin
curl -s  https://<new-origin>/sitemap.xml | head  # <loc> names the NEW origin
```

Then, by hand, because no command covers them:

- Sign in with **Google** and with **Microsoft**. This is step 4's check, and
  it is the only way to catch a stale allow-list.
- Request a signup code and confirm the link in the email points at the new
  origin. That is step 5's check.
