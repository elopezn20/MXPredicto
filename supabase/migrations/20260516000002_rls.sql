-- =============================================================================
-- Polla Mundial 2026 — Row Level Security Policies
-- Run AFTER 20260516000001_schema.sql
-- =============================================================================

-- ── Admin helper (SECURITY DEFINER bypasses RLS on profiles) ─────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- ── Enable RLS on every table ─────────────────────────────────────────────────
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.podio_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_audit       ENABLE ROW LEVEL SECURITY;

-- ── profiles ──────────────────────────────────────────────────────────────────
-- All authenticated users can read all profiles (needed for scoreboard)
CREATE POLICY "profiles: authenticated can view all"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can update their own profile (server actions must not expose is_admin)
CREATE POLICY "profiles: users can update own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admins can do anything (covers setting is_admin = true)
CREATE POLICY "profiles: admins full access"
  ON public.profiles FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── invitations ───────────────────────────────────────────────────────────────
CREATE POLICY "invitations: admins can manage"
  ON public.invitations FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Token validation during signup uses service-role client (bypasses RLS),
-- so no anon/public policy needed here.

-- ── teams ─────────────────────────────────────────────────────────────────────
CREATE POLICY "teams: authenticated can view"
  ON public.teams FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "teams: admins can write"
  ON public.teams FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── rounds ────────────────────────────────────────────────────────────────────
CREATE POLICY "rounds: authenticated can view"
  ON public.rounds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "rounds: admins can write"
  ON public.rounds FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── matches ───────────────────────────────────────────────────────────────────
CREATE POLICY "matches: authenticated can view"
  ON public.matches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "matches: admins can write"
  ON public.matches FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── predictions ───────────────────────────────────────────────────────────────
-- Own predictions: always visible to the owner
CREATE POLICY "predictions: view own"
  ON public.predictions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Others' predictions: visible only after the round has locked
CREATE POLICY "predictions: view others in locked rounds"
  ON public.predictions FOR SELECT
  TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.rounds  r ON r.id = m.round_id
      WHERE m.id = predictions.match_id
        AND r.lock_time <= now()
    )
  );

-- Insert own prediction while round is still open
CREATE POLICY "predictions: insert own before lock"
  ON public.predictions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.rounds  r ON r.id = m.round_id
      WHERE m.id = predictions.match_id
        AND r.lock_time > now()
    )
  );

-- Update own prediction while round is still open
CREATE POLICY "predictions: update own before lock"
  ON public.predictions FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.rounds  r ON r.id = m.round_id
      WHERE m.id = predictions.match_id
        AND r.lock_time > now()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.rounds  r ON r.id = m.round_id
      WHERE m.id = predictions.match_id
        AND r.lock_time > now()
    )
  );

-- Admins can manage all predictions (needed for rescoring)
CREATE POLICY "predictions: admins full access"
  ON public.predictions FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── podio_predictions ─────────────────────────────────────────────────────────
-- Own podio prediction: always visible
CREATE POLICY "podio: view own"
  ON public.podio_predictions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Others' podio predictions: visible only after the podio round locks
CREATE POLICY "podio: view others when locked"
  ON public.podio_predictions FOR SELECT
  TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rounds
      WHERE stage = 'podio' AND lock_time <= now()
    )
  );

-- Insert own podio prediction before lock
-- UNIQUE(user_id) on the table enforces the one-shot rule at DB level.
CREATE POLICY "podio: insert own before lock"
  ON public.podio_predictions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rounds
      WHERE stage = 'podio' AND lock_time > now()
    )
  );

-- NO UPDATE policy → podio is one-shot; no edits after submission.

-- Admins can manage all podio predictions
CREATE POLICY "podio: admins full access"
  ON public.podio_predictions FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── match_audit ───────────────────────────────────────────────────────────────
CREATE POLICY "audit: admins can view"
  ON public.match_audit FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "audit: admins can insert"
  ON public.match_audit FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
