-- 002-chat-widget: extend user_sessions for widget channel + live voice rooms
ALTER TABLE public.user_sessions DROP CONSTRAINT IF EXISTS user_sessions_channel_check;

ALTER TABLE public.user_sessions
  ADD CONSTRAINT user_sessions_channel_check
  CHECK (channel IN ('whatsapp', 'voice', 'widget'));

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS live_room_name TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_widget
  ON public.user_sessions (user_id)
  WHERE channel = 'widget';

-- Widget sessions: customer owns their own session row (non-conflicting with agent policy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_sessions'
      AND policyname = 'widget_sessions_customer_select'
  ) THEN
    CREATE POLICY "widget_sessions_customer_select"
      ON public.user_sessions FOR SELECT
      USING (channel = 'widget' AND user_id = auth.uid());
  END IF;
END $$;
