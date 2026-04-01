import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lesson: { id: number; title: string; moduleId: number };

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  createLessonComment,
  getLessonCommentById,
  getLessonCommentsForCourse,
  getLessonCommentsForLesson,
  hideLessonComment,
  restoreLessonComment,
} from "./lessonCommentService";

describe("lessonCommentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);

    const mod = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module 1", position: 1 })
      .returning()
      .get();

    lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: "Lesson 1", position: 1 })
      .returning()
      .get();
  });

  describe("createLessonComment", () => {
    it("creates a visible comment for a lesson", () => {
      const comment = createLessonComment(
        base.user.id,
        lesson.id,
        " Helpful lesson. "
      );

      expect(comment.userId).toBe(base.user.id);
      expect(comment.lessonId).toBe(lesson.id);
      expect(comment.body).toBe("Helpful lesson.");
      expect(comment.status).toBe(schema.LessonCommentStatus.Visible);
    });
  });

  describe("getLessonCommentById", () => {
    it("returns the stored comment", () => {
      const comment = createLessonComment(
        base.user.id,
        lesson.id,
        "Nice explanation"
      );

      expect(getLessonCommentById(comment.id)?.body).toBe("Nice explanation");
    });

    it("returns undefined for a missing comment", () => {
      expect(getLessonCommentById(9999)).toBeUndefined();
    });
  });

  describe("getLessonCommentsForLesson", () => {
    it("returns visible comments oldest first", () => {
      createLessonComment(base.user.id, lesson.id, "First comment");

      const secondStudent = testDb
        .insert(schema.users)
        .values({
          name: "Student Two",
          email: "lesson-comment-student@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      createLessonComment(secondStudent.id, lesson.id, "Second comment");

      const comments = getLessonCommentsForLesson(lesson.id, false);

      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe("First comment");
      expect(comments[1].body).toBe("Second comment");
    });

    it("excludes hidden comments for student view", () => {
      const visibleComment = createLessonComment(
        base.user.id,
        lesson.id,
        "Visible comment"
      );
      const hiddenComment = createLessonComment(
        base.instructor.id,
        lesson.id,
        "Hidden comment"
      );

      hideLessonComment(hiddenComment.id, base.instructor.id);

      const comments = getLessonCommentsForLesson(lesson.id, false);

      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(visibleComment.id);
    });

    it("includes hidden comments for moderator view", () => {
      const hiddenComment = createLessonComment(
        base.user.id,
        lesson.id,
        "Needs review"
      );
      hideLessonComment(hiddenComment.id, base.instructor.id);

      const comments = getLessonCommentsForLesson(lesson.id, true);

      expect(comments).toHaveLength(1);
      expect(comments[0].status).toBe(schema.LessonCommentStatus.Hidden);
      expect(comments[0].body).toBe("Needs review");
    });
  });

  describe("getLessonCommentsForCourse", () => {
    it("returns comments for lessons in the course with lesson titles", () => {
      createLessonComment(base.user.id, lesson.id, "Course comment");

      const otherCategory = testDb
        .insert(schema.categories)
        .values({ name: "Design", slug: "design" })
        .returning()
        .get();
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: otherCategory.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      const otherModule = testDb
        .insert(schema.modules)
        .values({
          courseId: otherCourse.id,
          title: "Other Module",
          position: 1,
        })
        .returning()
        .get();
      const otherLesson = testDb
        .insert(schema.lessons)
        .values({
          moduleId: otherModule.id,
          title: "Other Lesson",
          position: 1,
        })
        .returning()
        .get();
      createLessonComment(base.user.id, otherLesson.id, "Other course comment");

      const comments = getLessonCommentsForCourse(base.course.id);

      expect(comments).toHaveLength(1);
      expect(comments[0].lessonTitle).toBe("Lesson 1");
      expect(comments[0].authorName).toBe("Test User");
    });
  });

  describe("moderation", () => {
    it("hides a comment and records moderation details", () => {
      const comment = createLessonComment(
        base.user.id,
        lesson.id,
        "Please moderate"
      );

      const hidden = hideLessonComment(comment.id, base.instructor.id);

      expect(hidden?.status).toBe(schema.LessonCommentStatus.Hidden);
      expect(hidden?.moderatedByUserId).toBe(base.instructor.id);
      expect(hidden?.moderatedAt).toBeTruthy();
    });

    it("restores a hidden comment", () => {
      const comment = createLessonComment(
        base.user.id,
        lesson.id,
        "Restore me"
      );
      hideLessonComment(comment.id, base.instructor.id);

      const restored = restoreLessonComment(comment.id, base.instructor.id);

      expect(restored?.status).toBe(schema.LessonCommentStatus.Visible);
      expect(restored?.moderatedByUserId).toBe(base.instructor.id);
      expect(restored?.moderatedAt).toBeTruthy();
    });
  });

  describe("database constraints", () => {
    it("rejects comments longer than 1000 characters", () => {
      expect(() =>
        testDb
          .insert(schema.lessonComments)
          .values({
            lessonId: lesson.id,
            userId: base.user.id,
            body: "a".repeat(1001),
          })
          .run()
      ).toThrowError();
    });
  });
});
