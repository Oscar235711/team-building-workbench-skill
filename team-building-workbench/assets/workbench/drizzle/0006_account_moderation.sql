ALTER TABLE `participants` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `status_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `previous_status` text;
--> statement-breakpoint
CREATE TRIGGER account_status_guard BEFORE UPDATE OF status,status_revision,previous_status ON participants WHEN NEW.status NOT IN('active','banned','deleted') OR typeof(NEW.status_revision)<>'integer' OR NEW.status_revision<>OLD.status_revision+1 OR (NEW.status='deleted' AND COALESCE(NEW.previous_status,'') NOT IN('active','banned')) OR (NEW.status<>'deleted' AND NEW.previous_status IS NOT NULL) BEGIN SELECT RAISE(ABORT,'invalid_account_status'); END;
--> statement-breakpoint
CREATE TRIGGER account_revoke_sessions AFTER UPDATE OF status ON participants WHEN NEW.status<>OLD.status AND NEW.status<>'active' BEGIN DELETE FROM sessions WHERE participant_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER inactive_profile_guard BEFORE UPDATE OF nickname ON participants WHEN OLD.status<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER inactive_session_guard BEFORE INSERT ON sessions WHEN NEW.participant_id IS NOT NULL AND (SELECT status FROM participants WHERE id=NEW.participant_id)<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER inactive_submission_guard BEFORE INSERT ON submissions WHEN (SELECT status FROM participants WHERE id=NEW.participant_id)<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER inactive_revision_guard BEFORE INSERT ON submission_versions WHEN (SELECT p.status FROM submissions s JOIN participants p ON p.id=s.participant_id WHERE s.id=NEW.submission_id)<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER inactive_draft_insert_guard BEFORE INSERT ON drafts WHEN (SELECT status FROM participants WHERE id=NEW.participant_id)<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER inactive_draft_update_guard BEFORE UPDATE ON drafts WHEN (SELECT status FROM participants WHERE id=NEW.participant_id)<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
--> statement-breakpoint
CREATE TRIGGER inactive_comment_guard BEFORE INSERT ON comments WHEN (SELECT status FROM participants WHERE id=NEW.participant_id)<>'active' BEGIN SELECT RAISE(ABORT,'account_inactive'); END;
