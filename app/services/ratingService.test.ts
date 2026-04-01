import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getAverageRating,
  getUserRatingForCourse,
  upsertRating,
} from "./ratingService";

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("upsertRating", () => {
    it("creates a rating for a user and course", () => {
      const rating = upsertRating(base.user.id, base.course.id, 4);

      expect(rating.userId).toBe(base.user.id);
      expect(rating.courseId).toBe(base.course.id);
      expect(rating.rating).toBe(4);
    });

    it("updates the existing rating instead of inserting a duplicate", () => {
      upsertRating(base.user.id, base.course.id, 2);
      const updated = upsertRating(base.user.id, base.course.id, 5);

      const ratings = testDb.select().from(schema.courseRatings).all();

      expect(updated.rating).toBe(5);
      expect(ratings).toHaveLength(1);
      expect(ratings[0].rating).toBe(5);
    });
  });

  describe("database constraints", () => {
    it("enforces one rating per user and course", () => {
      testDb
        .insert(schema.courseRatings)
        .values({ userId: base.user.id, courseId: base.course.id, rating: 4 })
        .run();

      expect(() =>
        testDb
          .insert(schema.courseRatings)
          .values({ userId: base.user.id, courseId: base.course.id, rating: 5 })
          .run()
      ).toThrowError();
    });

    it("enforces the 1-5 rating range", () => {
      expect(() =>
        testDb
          .insert(schema.courseRatings)
          .values({ userId: base.user.id, courseId: base.course.id, rating: 6 })
          .run()
      ).toThrowError();
    });
  });

  describe("getAverageRating", () => {
    it("returns the average rating and count for a course", () => {
      const secondStudent = testDb
        .insert(schema.users)
        .values({
          name: "Second Student",
          email: "student2@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      upsertRating(base.user.id, base.course.id, 4);
      upsertRating(secondStudent.id, base.course.id, 5);

      expect(getAverageRating(base.course.id)).toEqual({
        average: 4.5,
        count: 2,
      });
    });

    it("returns null average and zero count when a course has no ratings", () => {
      expect(getAverageRating(base.course.id)).toEqual({
        average: null,
        count: 0,
      });
    });
  });

  describe("getUserRatingForCourse", () => {
    it("returns the saved rating for a user and course", () => {
      upsertRating(base.user.id, base.course.id, 3);

      expect(getUserRatingForCourse(base.user.id, base.course.id)?.rating).toBe(
        3
      );
    });

    it("returns undefined when the user has not rated the course", () => {
      expect(
        getUserRatingForCourse(base.user.id, base.course.id)
      ).toBeUndefined();
    });
  });
});
