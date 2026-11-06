CREATE OR REPLACE FUNCTION public.validate_project_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.mode NOT IN ('tabletop', 'wall', 'multipoint') THEN
    RAISE EXCEPTION 'Invalid mode: %. Must be tabletop, wall, or multipoint.', NEW.mode;
  END IF;
  RETURN NEW;
END;
$function$;