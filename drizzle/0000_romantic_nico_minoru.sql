CREATE TABLE `telegram_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`region` text NOT NULL,
	`operator` text NOT NULL,
	`queue` text NOT NULL,
	`language` text DEFAULT 'uk' NOT NULL,
	`notifications` integer DEFAULT 0 NOT NULL,
	`bot_started` integer DEFAULT 0 NOT NULL,
	`chat_id` text,
	`updated_at` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` real NOT NULL,
	`attempted_at` real NOT NULL,
	`error` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`checked_at` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` real NOT NULL
);
