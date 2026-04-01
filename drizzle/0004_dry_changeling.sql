PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_course_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`course_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "course_ratings_rating_check" CHECK("__new_course_ratings"."rating" >= 1 AND "__new_course_ratings"."rating" <= 5)
);
--> statement-breakpoint
INSERT INTO `__new_course_ratings`("id", "user_id", "course_id", "rating", "created_at", "updated_at")
SELECT
	"id",
	"user_id",
	"course_id",
	CASE
		WHEN "rating" < 1 THEN 1
		WHEN "rating" > 5 THEN 5
		ELSE "rating"
	END,
	"created_at",
	"updated_at"
FROM (
	SELECT
		"id",
		"user_id",
		"course_id",
		"rating",
		"created_at",
		"updated_at",
		ROW_NUMBER() OVER (
			PARTITION BY "user_id", "course_id"
			ORDER BY COALESCE("updated_at", "created_at") DESC, "id" DESC
		) AS "row_num"
	FROM `course_ratings`
) AS `deduped_course_ratings`
WHERE "row_num" = 1;--> statement-breakpoint
DROP TABLE `course_ratings`;--> statement-breakpoint
ALTER TABLE `__new_course_ratings` RENAME TO `course_ratings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `course_ratings_user_course_idx` ON `course_ratings` (`user_id`,`course_id`);--> statement-breakpoint
CREATE INDEX `course_ratings_course_id_idx` ON `course_ratings` (`course_id`);
