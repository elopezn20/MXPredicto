# Polla Mundial 2026 — Build Progress

_Last updated: 2026-05-16. Spec: `docs/polla-prompt.md`. Launch deadline: 2026-06-01._

---

## Phase 0 — Setup

### Done
- [x] Node 24.15.0 + pnpm 11.1.2 confirmed on PATH
- [x] Next.js 16.2.6 scaffolded (App Router, TypeScript strict, Tailwind v4, ESLint flat config)
- [x] `docs/polla-prompt.md` moved from root
- [x] All runtime deps installed: `@supabase/supabase-js`, `@supabase/ssr`, `next-intl`, `react-hook-form`, `zod`, `@hookform/resolvers`, `date-fns`, `date-fns-tz`, `resend`, shadcn peers (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss-animate`)
- [x] All dev deps installed: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `prettier`, `prettier-plugin-tailwindcss`
- [x] `pnpm-workspace.yaml` — build-script approvals for `sharp`, `unrs-resolver`, `@parcel/watcher`, `@swc/core`

### Remaining (picking up here)
- [ ] Create folder structure (`app/[locale]/...`, `lib/`, `messages/`, `supabase/`, `scripts/`, `tests/`, `public/flags/`)
- [ ] Config files: `next.config.ts` (next-intl plugin), `tsconfig.json` (`noUncheckedIndexedAccess`), `vitest.config.ts`, `.prettierrc`, `.env.example`, `.env.local`, ESLint no-console rule
- [ ] shadcn/ui init + install primitives (button, input, form, label, card, dialog, dropdown-menu, sonner, tabs, table, sheet)
- [ ] i18n bootstrap: `lib/i18n/routing.ts`, `lib/i18n/request.ts`, `middleware.ts`, `messages/{es,en,ko}.json`
- [ ] Lib stubs: `lib/utils.ts`, `lib/supabase/{client,server,middleware}.ts`, `lib/email/resend.ts`
- [ ] Page stubs: `app/[locale]/layout.tsx` (fonts, NextIntlClientProvider), `app/[locale]/page.tsx` (smoke page), route group stubs
- [ ] `package.json` scripts: add `format`, `test`, `test:watch`
- [ ] README rewrite (project-specific content)
- [ ] `git init` + first commit on `main`
- [ ] Verification: `pnpm dev` (smoke page at /es), `pnpm test`, `pnpm lint`, `pnpm build`

---

## Phase 1 — Database & Supabase Setup
_Not started_

## Phase 2 — Scoring Engine
_Not started_

## Phase 3 — Auth & Invitations
_Not started_

## Phase 4 — Predictions UI
_Not started_

## Phase 5 — Scoreboard
_Not started_

## Phase 6 — Admin Panel
_Not started_

## Phase 7 — i18n Polish
_Not started_

## Phase 8 — Deploy
_Not started_

---

## Key Decisions Made (autonomous per §10)
- Scaffold in-place (current dir), flat layout (no `src/`)
- Tailwind v4 (installed by create-next-app); shadcn will configure via CSS vars
- `app/[locale]/layout.tsx` provides `<html lang={locale}>`; root layout is a pass-through
- Locale routing prefix: `always` (URLs always include locale)
- Default branch: `main`, no remote until Phase 8
- Build-script approvals stored in `pnpm-workspace.yaml` (pnpm v11 requirement)
