-- Add mode and tabletop-specific columns to projects
ALTER TABLE public.projects
  ADD COLUMN mode text NOT NULL DEFAULT 'multipoint',
  ADD COLUMN scale text DEFAULT '1:1',
  ADD COLUMN qr_size text DEFAULT 'medium',
  ADD COLUMN initial_rotation integer DEFAULT 0;

-- Add a check-like validation trigger for mode values
CREATE OR REPLACE FUNCTION public.validate_project_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.mode NOT IN ('tabletop', 'multipoint') THEN
    RAISE EXCEPTION 'Invalid mode: %. Must be tabletop or multipoint.', NEW.mode;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_project_mode_trigger
BEFORE INSERT OR UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.validate_project_mode();