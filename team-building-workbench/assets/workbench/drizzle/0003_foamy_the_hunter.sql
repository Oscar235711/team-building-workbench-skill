CREATE TABLE `submission_heads` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`quarter_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`slot` integer NOT NULL,
	`revision` integer NOT NULL,
	`combo_key` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `current_combo` ON `submission_heads` (`quarter_id`,`participant_id`,`combo_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `current_slot` ON `submission_heads` (`quarter_id`,`participant_id`,`slot`);--> statement-breakpoint
CREATE TABLE `submission_versions` (
	`submission_id` text NOT NULL,
	`revision` integer NOT NULL,
	`combo_key` text NOT NULL,
	`snapshot` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`submission_id`, `revision`),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `version_retry` ON `submission_versions` (`submission_id`,`idempotency_key`);--> statement-breakpoint
DROP INDEX `submission_combo`;