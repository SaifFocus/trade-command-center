CREATE OR REPLACE FUNCTION public.block_signup_after_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_owner) THEN
    RAISE EXCEPTION 'Sign-ups are closed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.block_signup_after_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS block_signup_after_owner ON auth.users;
CREATE TRIGGER block_signup_after_owner BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_signup_after_owner();