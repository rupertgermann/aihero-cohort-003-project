ALTER TABLE `lesson_progress` ADD COLUMN `updated_at` text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
--> statement-breakpoint
UPDATE `lesson_progress`
SET `updated_at` = `completed_at`
WHERE `completed_at` IS NOT NULL;
