CREATE TABLE `drafts` (
	`quarter_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`slot` integer NOT NULL,
	`plan` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`quarter_id`, `participant_id`, `slot`),
	FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`nickname` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_code_unique` ON `participants` (`code`);--> statement-breakpoint
CREATE TABLE `quarters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`budget_cents` integer NOT NULL,
	`people` integer NOT NULL,
	`open` integer DEFAULT 1 NOT NULL,
	`deadline` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quarters_name_unique` ON `quarters` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`participant_id` text,
	`admin` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`quarter_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`slot` integer NOT NULL,
	`combo_key` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_slot` ON `submissions` (`quarter_id`,`participant_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_combo` ON `submissions` (`quarter_id`,`participant_id`,`combo_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_idempotency` ON `submissions` (`quarter_id`,`participant_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`parent_id` text,
	`attrs` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`identity_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_identity_key_unique` ON `terms` (`identity_key`);--> statement-breakpoint
CREATE TABLE `term_versions` (
	`term_id` text NOT NULL,
	`version` integer NOT NULL,
	`attrs` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`term_id`, `version`),
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE no action
);
