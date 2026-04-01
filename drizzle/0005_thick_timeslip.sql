CREATE TABLE `lesson_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`moderated_by_user_id` integer,
	`moderated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moderated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lesson_comments_body_length_check" CHECK(length("lesson_comments"."body") >= 1 AND length("lesson_comments"."body") <= 1000)
);
--> statement-breakpoint
CREATE INDEX `lesson_comments_lesson_status_idx` ON `lesson_comments` (`lesson_id`,`status`);