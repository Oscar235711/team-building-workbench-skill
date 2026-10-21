CREATE TRIGGER immutable_submission_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT,'immutable_submission'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_submission_delete BEFORE DELETE ON submissions BEGIN SELECT RAISE(ABORT,'immutable_submission'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_version_update BEFORE UPDATE ON term_versions BEGIN SELECT RAISE(ABORT,'immutable_version'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_version_delete BEFORE DELETE ON term_versions BEGIN SELECT RAISE(ABORT,'immutable_version'); END;
--> statement-breakpoint
CREATE TRIGGER quarter_config_lock BEFORE UPDATE ON quarters WHEN EXISTS(SELECT 1 FROM submissions WHERE quarter_id=OLD.id) AND (NEW.budget_cents<>OLD.budget_cents OR NEW.people<>OLD.people OR NEW.deadline IS NOT OLD.deadline OR NEW.name<>OLD.name) BEGIN SELECT RAISE(ABORT,'quarter_locked'); END;
--> statement-breakpoint
CREATE TRIGGER submission_guard BEFORE INSERT ON submissions BEGIN
 SELECT CASE WHEN NEW.slot NOT IN (1,2) THEN RAISE(ABORT,'invalid_slot') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quarters WHERE id=NEW.quarter_id AND open=1 AND (deadline IS NULL OR julianday(deadline)>julianday('now')) AND budget_cents=json_extract(NEW.snapshot,'$.budgetCents') AND people=json_extract(NEW.snapshot,'$.people')) THEN RAISE(ABORT,'quarter_closed_or_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.events') e,json_each(e.value,'$.items') i LEFT JOIN terms t ON t.id=json_extract(i.value,'$.termId') WHERE t.id IS NULL OR t.active=0 OR t.version<>json_extract(i.value,'$.version')) THEN RAISE(ABORT,'term_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.events') e LEFT JOIN terms t ON t.id=json_extract(e.value,'$.time.id') WHERE t.id IS NULL OR t.active=0 OR t.attrs<>json_extract(e.value,'$.time.attrs')) THEN RAISE(ABORT,'time_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.events') e,json_each(e.value,'$.plays') p LEFT JOIN terms t ON t.id=json_extract(p.value,'$.id') WHERE t.id IS NULL OR t.active=0 OR t.attrs<>json_extract(p.value,'$.attrs')) THEN RAISE(ABORT,'play_changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER draft_slot_guard BEFORE INSERT ON drafts WHEN NEW.slot NOT IN(1,2) OR EXISTS(SELECT 1 FROM submissions WHERE quarter_id=NEW.quarter_id AND participant_id=NEW.participant_id AND slot=NEW.slot) BEGIN SELECT RAISE(ABORT,'draft_locked'); END;
--> statement-breakpoint
CREATE TRIGGER draft_update_guard BEFORE UPDATE ON drafts WHEN EXISTS(SELECT 1 FROM submissions WHERE quarter_id=NEW.quarter_id AND participant_id=NEW.participant_id AND slot=NEW.slot) BEGIN SELECT RAISE(ABORT,'draft_locked'); END;
--> statement-breakpoint
CREATE TRIGGER participant_code_guard BEFORE INSERT ON participants WHEN length(NEW.code)<>3 OR NEW.code GLOB '*[^0-9]*' BEGIN SELECT RAISE(ABORT,'invalid_code'); END;
