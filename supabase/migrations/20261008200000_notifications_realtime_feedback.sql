-- PRESS-CMS: realtime notifications + feedback notification
-- 1. Extend notifications.type allowed values (adds feedback_added)
-- 2. Notify the article author when a desk member leaves feedback
-- 3. Publish notifications table to Supabase Realtime

-- 1. Replace the type CHECK constraint (drop any existing check that mentions "type")
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'review_requested',
      'changes_requested',
      'review_resubmitted',
      'article_approved',
      'article_published',
      'article_assigned',
      'deadline_changed',
      'feedback_added'
    )
  );

-- 2. Feedback notification trigger
CREATE OR REPLACE FUNCTION public.notify_feedback_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_article RECORD;
  v_actor_name TEXT;
BEGIN
  -- Change-request reasons already create their own notification
  IF NEW.content LIKE '[수정 요청 사유]%' THEN
    RETURN NEW;
  END IF;

  SELECT a.id, a.title, a.author_id
    INTO v_article
    FROM public.articles a
   WHERE a.id = NEW.article_id;

  IF v_article.id IS NULL OR v_article.author_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.name INTO v_actor_name FROM public.profiles p WHERE p.id = NEW.author_id;

  INSERT INTO public.notifications (
    recipient_id, actor_id, article_id, type, title, message, is_read, created_at
  ) VALUES (
    v_article.author_id,
    NEW.author_id,
    v_article.id,
    'feedback_added',
    '새 피드백',
    COALESCE(v_actor_name, '데스크') || '님이 "' || v_article.title || '" 기사에 피드백을 남겼습니다.',
    false,
    timezone('utc'::text, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_feedback_added ON public.article_feedbacks;
CREATE TRIGGER trg_notify_feedback_added
  AFTER INSERT ON public.article_feedbacks
  FOR EACH ROW EXECUTE FUNCTION public.notify_feedback_added();

-- 3. Realtime publication (skip if already a member)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
