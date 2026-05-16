# Polla Mundial 2026 — Build Progress

_Last updated: 2026-05-16. Spec: `docs/polla-prompt.md`. Launch deadline: 2026-06-01._

---

## Phase 0 — Setup ✅ COMPLETE (2026-05-16)

- Next.js 16.2.6 (App Router, TS strict, Tailwind v4, Turbopack), `pnpm build` ✓
- All deps installed; shadcn/ui radix-nova + 11 primitives; next-intl v4 (es/en/ko)
- `proxy.ts` locale routing; `app/globals.css` with §7 palette; Vitest configured
- `pnpm test` ✓ (2/2), `pnpm lint` ✓ (0 warnings), `pnpm build` ✓, dev server ready
- Git: 1 commit on `main` (hash `6071d55`)
- Autonomous decisions: `tailwindcss-animate` → `tw-animate-css` (Tailwind v4 compat); `middleware.ts` → `proxy.ts` (Next.js 16 deprecation); `scripts/` excluded from tsconfig to avoid TS conflicts

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
