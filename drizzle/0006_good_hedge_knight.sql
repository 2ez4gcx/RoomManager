CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`due_date` text NOT NULL,
	`amount` integer NOT NULL,
	`message` text NOT NULL,
	`sent_at` integer,
	`channel` text,
	`sent_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_pending_idx` ON `reminders` (`sent_at`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_invoice_day_unq` ON `reminders` (`invoice_id`,`scheduled_for`);