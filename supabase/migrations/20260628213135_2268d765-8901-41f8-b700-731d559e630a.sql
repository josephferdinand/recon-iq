
ALTER TABLE public.slack_workspaces
  ALTER COLUMN encrypted_bot_token TYPE text USING encode(encrypted_bot_token,'escape');
