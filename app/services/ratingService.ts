import { and, avg, count, eq } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings } from "~/db/schema";

export function upsertRating(userId: number, courseId: number, rating: number) {
  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseRatings.userId, courseRatings.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}

export function getAverageRating(courseId: number): {
  average: number | null;
  count: number;
} {
  const result = db
    .select({
      average: avg(courseRatings.rating),
      count: count(courseRatings.id),
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();

  return {
    average:
      result?.average != null
        ? parseFloat(result.average as unknown as string)
        : null,
    count: result?.count ?? 0,
  };
}

export function getUserRatingForCourse(userId: number, courseId: number) {
  return db
    .select()
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, userId),
        eq(courseRatings.courseId, courseId)
      )
    )
    .get();
}
