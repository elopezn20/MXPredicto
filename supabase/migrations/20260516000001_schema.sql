-- =============================================================================
-- Polla Mundial 2026 — Core Schema
-- Apply via: Supabase Dashboard → SQL Editor → paste & run
-- =============================================================================

-- Note on match counts: the real 2026 World Cup has 104 matches:
--   72 group (12 groups × 6 matches each, split into 3 prediction fechas of 24)
--   32 knockout (16 + 8 + 4 + 2 + 1 final + 1 third-place)
-- The spec's "16 per fecha × 3 = 48" is a typo from the old 32-team format.
-- Scoring rules are unchanged.

-- ── Profiles ──────────────────────────────────────────────────────────────────
-- Extends auth.users; one row per registered user.
CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name     text        NOT NULL,
  preferred_locale text        NOT NULL DEFAULT 'es'
                     CHECK (preferred_locale IN ('en', 'es', 'ko')),
  timezone         text        NOT NULL DEFAULT 'America/Santiago',
  is_admin         boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS
  'One row per user; extends auth.users. is_admin set manually for Santiago/Tomás.';

-- ── Invitations ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL UNIQUE,
  token        text        NOT NULL UNIQUE,
  invited_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_at  timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Teams ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id           uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text  NOT NULL UNIQUE,   -- FIFA 3-letter code, e.g. 'BRA'
  name_en      text  NOT NULL,
  name_es      text  NOT NULL,
  name_ko      text  NOT NULL,
  flag_url     text,
  group_letter text  CHECK (group_letter IN ('A','B','C','D','E','F','G','H','I','J','K','L'))
);

-- ── Rounds ────────────────────────────────────────────────────────────────────
-- 9 rounds total:
--   stage='group'    → 3 fechas (order 1-3)
--   stage='podio'    → Bonus Podio (order 4; locks at same time as R32)
--   stage='knockout' → R32, R16, QF, SF, Final (order 5-9)
CREATE TABLE IF NOT EXISTS public.rounds (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage       text        NOT NULL CHECK (stage IN ('group', 'knockout', 'podio')),
  name_key    text        NOT NULL UNIQUE,   -- i18n key, e.g. 'rounds.group_1'
  order_index int         NOT NULL UNIQUE,
  lock_time   timestamptz NOT NULL           -- earliest kickoff in this round
);

-- ── Matches ───────────────────────────────────────────────────────────────────
-- 104 matches total. home/away may be NULL for knockout slots until qualified.
CREATE TABLE IF NOT EXISTS public.matches (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id               uuid        NOT NULL REFERENCES public.rounds(id),
  home_team_id           uuid        REFERENCES public.teams(id),
  away_team_id           uuid        REFERENCES public.teams(id),
  kickoff_at             timestamptz NOT NULL,
  venue                  text,
  external_id            text        UNIQUE,   -- football-data.org match ID
  status                 text        NOT NULL DEFAULT 'scheduled'
                           CHECK (status IN ('scheduled', 'in_progress', 'finished')),
  home_score             int         CHECK (home_score >= 0),
  away_score             int         CHECK (away_score >= 0),
  penalty_winner_team_id uuid        REFERENCES public.teams(id),
  advancing_team_id      uuid        REFERENCES public.teams(id),
  CONSTRAINT home_away_different CHECK (
    home_team_id IS NULL OR away_team_id IS NULL OR home_team_id != away_team_id
  )
);

-- ── Predictions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.predictions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id               uuid        NOT NULL REFERENCES public.matches(id),
  home_score_pred        int         NOT NULL CHECK (home_score_pred >= 0),
  away_score_pred        int         NOT NULL CHECK (away_score_pred >= 0),
  penalty_winner_team_id uuid        REFERENCES public.teams(id),
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  points_awarded         int,                -- NULL until match is scored
  UNIQUE (user_id, match_id)
);

-- ── Podio Predictions ─────────────────────────────────────────────────────────
-- One-shot; no UPDATE allowed (enforced by RLS — no UPDATE policy).
CREATE TABLE IF NOT EXISTS public.podio_predictions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  champion_team_id    uuid        REFERENCES public.teams(id),
  runner_up_team_id   uuid        REFERENCES public.teams(id),
  third_place_team_id uuid        REFERENCES public.teams(id),
  submitted_at        timestamptz,
  points_awarded      int,
  CONSTRAINT podio_teams_distinct CHECK (
    champion_team_id   != runner_up_team_id   AND
    champion_team_id   != third_place_team_id AND
    runner_up_team_id  != third_place_team_id
  )
);

-- ── Match Audit Log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid        NOT NULL REFERENCES public.matches(id),
  changed_by  uuid        NOT NULL REFERENCES public.profiles(id),
  old_value   jsonb,
  new_value   jsonb,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_predictions_user    ON public.predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match   ON public.predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_matches_round       ON public.matches(round_id);
CREATE INDEX IF NOT EXISTS idx_matches_kickoff     ON public.matches(kickoff_at);
CREATE INDEX IF NOT EXISTS idx_match_audit_match   ON public.match_audit(match_id);

-- ── Trigger: auto-create profile on auth.users insert ─────────────────────────
-- display_name is taken from metadata passed during signUp().
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    new.id,
    COALESCE(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
