DROP TRIGGER draft_slot_guard;
--> statement-breakpoint
DROP TRIGGER draft_update_guard;
--> statement-breakpoint
CREATE TRIGGER draft_slot_guard BEFORE INSERT ON drafts WHEN NEW.slot NOT IN(1,2) BEGIN SELECT RAISE(ABORT,'invalid_slot'); END;
--> statement-breakpoint
CREATE TRIGGER initialize_submission_head AFTER INSERT ON submissions BEGIN
 INSERT INTO submission_versions(submission_id,revision,combo_key,snapshot,idempotency_key,created_at) VALUES(NEW.id,1,NEW.combo_key,NEW.snapshot,NEW.idempotency_key,NEW.created_at);
 INSERT INTO submission_heads(submission_id,quarter_id,participant_id,slot,revision,combo_key) VALUES(NEW.id,NEW.quarter_id,NEW.participant_id,NEW.slot,1,NEW.combo_key);
END;
--> statement-breakpoint
CREATE TRIGGER version_immutable_update BEFORE UPDATE ON submission_versions BEGIN SELECT RAISE(ABORT,'immutable_version'); END;
--> statement-breakpoint
CREATE TRIGGER version_immutable_delete BEFORE DELETE ON submission_versions BEGIN SELECT RAISE(ABORT,'immutable_version'); END;
--> statement-breakpoint
CREATE TRIGGER head_no_delete BEFORE DELETE ON submission_heads BEGIN SELECT RAISE(ABORT,'immutable_submission'); END;
--> statement-breakpoint
CREATE TRIGGER head_guard BEFORE UPDATE ON submission_heads BEGIN
 SELECT CASE WHEN NEW.submission_id<>OLD.submission_id OR NEW.quarter_id<>OLD.quarter_id OR NEW.participant_id<>OLD.participant_id OR NEW.slot<>OLD.slot OR NEW.revision<>OLD.revision+1 THEN RAISE(ABORT,'invalid_revision') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM submission_versions WHERE submission_id=NEW.submission_id AND revision=NEW.revision AND combo_key=NEW.combo_key) THEN RAISE(ABORT,'missing_version') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quarters WHERE id=NEW.quarter_id AND open=1 AND (deadline IS NULL OR julianday(deadline)>julianday('now'))) THEN RAISE(ABORT,'quarter_closed') END;
END;
--> statement-breakpoint
CREATE TRIGGER revision_snapshot_guard BEFORE INSERT ON submission_versions WHEN NEW.revision>1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM submission_heads h JOIN quarters q ON q.id=h.quarter_id WHERE h.submission_id=NEW.submission_id AND h.revision=NEW.revision-1 AND q.open=1 AND (q.deadline IS NULL OR julianday(q.deadline)>julianday('now')) AND q.budget_cents=json_extract(NEW.snapshot,'$.budgetCents') AND q.people=json_extract(NEW.snapshot,'$.people')) THEN RAISE(ABORT,'quarter_closed_or_revision_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.events') e,json_each(e.value,'$.items') i LEFT JOIN terms t ON t.id=json_extract(i.value,'$.termId') WHERE t.id IS NULL OR t.active=0 OR t.version<>json_extract(i.value,'$.version')) THEN RAISE(ABORT,'term_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.events') e LEFT JOIN terms t ON t.id=json_extract(e.value,'$.time.id') WHERE t.id IS NULL OR t.active=0 OR t.attrs<>json_extract(e.value,'$.time.attrs')) THEN RAISE(ABORT,'time_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.events') e,json_each(e.value,'$.plays') p LEFT JOIN terms t ON t.id=json_extract(p.value,'$.id') WHERE t.id IS NULL OR t.active=0 OR t.attrs<>json_extract(p.value,'$.attrs')) THEN RAISE(ABORT,'play_changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER completed_term_fixed BEFORE UPDATE OF name,normalized,parent_id,attrs,level ON terms WHEN OLD.level<3 OR (json_extract(OLD.attrs,'$.priceCents') IS NOT NULL AND COALESCE(json_extract(OLD.attrs,'$.location'),'')<>'') BEGIN SELECT RAISE(ABORT,'vocabulary_locked'); END;
