-- Admin-only API may rename time/play labels without changing semantic attrs.
DROP TRIGGER completed_term_fixed;
--> statement-breakpoint
CREATE TRIGGER completed_term_fixed BEFORE UPDATE OF name,normalized,parent_id,attrs,level ON terms WHEN OLD.level=3 AND (json_extract(OLD.attrs,'$.priceCents') IS NOT NULL AND COALESCE(json_extract(OLD.attrs,'$.location'),'')<>'') BEGIN SELECT RAISE(ABORT,'vocabulary_locked'); END;
