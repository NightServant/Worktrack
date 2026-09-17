# 🤝 Contributing to Job Search Tracker

Thanks for your interest in contributing! This guide will help you set up your local environment and understand the development workflow.

## 🎯 What We're Looking For

- **Bug fixes**: Issues reported or found during testing
- **Feature enhancements**: Improvements to existing features (analytics, UI, performance)
- **Documentation**: Clarifying setup, deployment, or architecture
- **Tests**: Improving test coverage
- **Performance**: Optimizations for bundle size, query performance, or rendering

## 🏗️ Local Setup (10 minutes)

### Prerequisites
```bash
# Install Node.js 18+ and npm from nodejs.org
node --version  # Should be v18.0.0+
npm --version   # Should be 9.0.0+
```

### 1. Clone & Install
```bash
git clone https://github.com/NightServant/Worktrack.git
cd Worktrack
npm install
```

### 2. Create `.env.local`
```bash
cp .env.example .env.local
```

Edit `.env.local` with your Supabase credentials:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Need Supabase credentials? Create a free account at [supabase.com](https://supabase.com)

### 3. Apply Database Migrations

Follow the step-by-step checklist in [**texts/database_migrations.md**](texts/database_migrations.md) to set up your database schema in Supabase.

### 4. (Optional) Run the extractor

There are no edge functions to deploy — every one of them was deleted in
September 2026 without ever having been deployed, and the work moved to
Next.js routes that ship with the app.

PDF, `.docx` and `.tex` export therefore work as soon as `npm run dev` is up.
**Auto-fill does not**: `/api/autofill` hands the URL to the Python extractor
in `scraper/`, which is a separate process that `npm run dev` does not start.
Without it the button reports the posting as unreadable, which looks like a bad
posting rather than a missing service.

## 🚀 Development Workflow

### Start Dev Server
```bash
npm run dev
# Opens at http://localhost:5173 (or next available port)
```

### Code Changes
- React components live in `src/components/`
- Business logic in `src/services/`, `src/hooks/`
- Styles with Tailwind CSS (no separate CSS files)
- TypeScript strict mode enforced

### Before Committing

```bash
# Lint your code
npm run lint

# Run all tests
npm test

# Build for production (catches build errors)
npm run build

# All should pass before submitting PR
```

## ✅ Testing

### Run Tests
```bash
# Run once
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# Check coverage
npm run test:coverage
```

### Write Tests
- Test files: `src/**/__tests__/*.test.ts(x)`
- Framework: Vitest + React Testing Library
- Example: See `src/components/jobs/__tests__/JobCard.test.tsx`
- **For UI changes**: Update corresponding `.test.tsx` file
- **For logic changes**: Add tests to `services/__tests__/` or `hooks/`

## 📝 PR Checklist

Before opening a PR:

- [ ] Fork the repo and create a feature branch: `git checkout -b feature/my-feature`
- [ ] Make focused, atomic commits with clear messages
- [ ] Run `npm test` — all tests pass
- [ ] Run `npm run build` — production build succeeds
- [ ] Run `npm run lint` — no linting errors
- [ ] Update docs if behavior/setup/deployment changes
- [ ] Push and open a PR with clear description

### Example PR Title & Description
```
Title: Fix analytics cache not updating on new job

Description:
- Clears analytics cache when job is added/deleted
- Adds test case for cache invalidation
- Fixes issue #42
```

## 🗂️ Project Structure Quick Reference

```
src/
  components/        # React UI components
    dashboard/       # Analytics charts (lazy-loaded)
    jobs/            # Kanban, job card, form
  hooks/            # Custom React hooks (data fetching)
  services/         # API layer (Supabase queries)
  contexts/         # React context providers (Auth, Theme)
  lib/              # Utilities (Supabase client, CSV parser)
  types/            # TypeScript type definitions

supabase/
  migrations/       # SQL migration files

texts/              # Non-code documentation
  database_migrations.md    # DB setup steps
  component_architecture.txt
```

## 🔍 Common Tasks

### Add a New Analytics Metric
1. Add the computation to `src/services/analyticsService.ts` — every metric is
   computed per request from the user's own rows; there is no server-side cache
2. Add hook in `src/hooks/useAnalytics.ts`
3. Render in `src/components/dashboard/AnalyticsSections.tsx`
4. Add test case to verify computation

### Add a New Job Field
1. Update Supabase table schema
2. Update TypeScript type in `src/types/index.ts`
3. Add input to `src/components/jobs/JobForm.tsx`
4. Update `src/services/jobService.ts` (select/insert/update)
5. Update CSV export in `src/lib/jobCsv.ts`

### Fix a UI Bug
1. Locate the component in `src/components/`
2. Reproduce the bug locally
3. Fix the bug
4. Add or update corresponding test file
5. Run `npm test` to verify

## 📚 Key Documentation

- **Setup**: [README.md](README.md) — Start here
- **Database**: [texts/database_migrations.md](texts/database_migrations.md) — DB schema and RLS policies
- **Deployment**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — Production deployment
- **Architecture**: [texts/component_architecture.txt](texts/component_architecture.txt) — Component patterns
- **Monitoring**: [texts/technical_appendix.txt](texts/technical_appendix.txt) — Error tracking, observability

## 💬 Questions?

- Open an [issue](https://github.com/NightServant/Worktrack/issues) with questions
- Check [texts/](texts/) for architecture and design docs
- Start a discussion for design feedback before major PRs

## 🙏 Code of Conduct

- Be respectful and inclusive
- Assume good intent
- Ask questions before dismissing ideas
- Give credit where it's due

---

**Happy coding!** 🎉