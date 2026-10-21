CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`quarter_id` text NOT NULL,
	`combo_key` text NOT NULL,
	`participant_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
