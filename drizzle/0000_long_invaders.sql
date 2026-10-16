CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`n` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `limits_until` ON `limits` (`until`);--> statement-breakpoint
CREATE TABLE `presence` (
	`code` text NOT NULL,
	`member_id` text NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`code`, `member_id`),
	FOREIGN KEY (`code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `presence_seen` ON `presence` (`last_seen`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`sessions` text NOT NULL,
	`expires_at` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_expiry` ON `rooms` (`expires_at`);