-- Add platform_super_admin tier
ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'platform_super_admin';