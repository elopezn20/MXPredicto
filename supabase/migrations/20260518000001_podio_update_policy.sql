-- Allow users to update their own podio prediction before the deadline.
CREATE POLICY "podio: update own before lock"
  ON public.podio_predictions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.rounds
      WHERE stage = 'podio' AND lock_time > now()
    )
  );
