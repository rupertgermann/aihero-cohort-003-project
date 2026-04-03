import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  getRollupMetrics as rawGetRollupMetrics,
  getCourseRows as rawGetCourseRows,
  getCourseDetailMetrics,
  getStudentProgressRows,
} from "./analyticsService";

function getRollupMetrics(
  instructorId: number | null,
  days: number,
  viewerIdOrRole: number | schema.UserRole,
  maybeViewerRole?: schema.UserRole
) {
  if (typeof viewerIdOrRole === "number") {
    return rawGetRollupMetrics(instructorId, days, viewerIdOrRole, maybeViewerRole);
  }

  const inferredViewerId =
    viewerIdOrRole === schema.UserRole.Instructor ? instructorId ?? -1 : -1;
  return rawGetRollupMetrics(instructorId, days, inferredViewerId, viewerIdOrRole);
}

function getCourseRows(
  instructorId: number | null,
  days: number,
  viewerIdOrRole: number | schema.UserRole,
  maybeViewerRole?: schema.UserRole
) {
  if (typeof viewerIdOrRole === "number") {
    return rawGetCourseRows(instructorId, days, viewerIdOrRole, maybeViewerRole);
  }

  const inferredViewerId =
    viewerIdOrRole === schema.UserRole.Instructor ? instructorId ?? -1 : -1;
  return rawGetCourseRows(instructorId, days, inferredViewerId, viewerIdOrRole);
}

// ─── Test Helpers ───

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function createPurchase(userId: number, courseId: number, pricePaid: number, createdAt: string) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, pricePaid, country: null, createdAt })
    .returning()
    .get();
}

function createEnrollment(userId: number, courseId: number, enrolledAt: string) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, enrolledAt })
    .returning()
    .get();
}

function createUser(email: string, role: schema.UserRole = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role })
    .returning()
    .get();
}

function createCourse(instructorId: number, slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: "Test",
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function createModuleWithLessons(courseId: number, lessonCount: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  const lessons: (typeof schema.lessons.$inferSelect)[] = [];
  for (let i = 0; i < lessonCount; i++) {
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get();
    lessons.push(lesson);
  }
  return { module: mod, lessons };
}

function completeLessonAt(userId: number, lessonId: number, completedAt: string) {
  return testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt,
      updatedAt: completedAt,
    })
    .returning()
    .get();
}

function startLessonAt(userId: number, lessonId: number, updatedAt: string) {
  return testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.InProgress,
      updatedAt,
    })
    .returning()
    .get();
}

function createRating(userId: number, courseId: number, rating: number) {
  return testDb
    .insert(schema.courseRatings)
    .values({ userId, courseId, rating })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  // ─── Authorization ───

  describe("authorization", () => {
    it("throws for student role", () => {
      expect(() =>
        getRollupMetrics(base.instructor.id, 30, schema.UserRole.Student)
      ).toThrow("Unauthorized");
    });

    it("does not throw for instructor role", () => {
      expect(() =>
        getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor)
      ).not.toThrow();
    });

    it("does not throw for admin role", () => {
      expect(() =>
        getRollupMetrics(null, 30, schema.UserRole.Admin)
      ).not.toThrow();
    });

    it("prevents instructors from requesting another instructor's rollup", () => {
      const otherInstructor = createUser("other-rollup@example.com", schema.UserRole.Instructor);

      expect(() =>
        rawGetRollupMetrics(otherInstructor.id, 30, base.instructor.id, schema.UserRole.Instructor)
      ).toThrow("Forbidden");
    });
  });

  // ─── Empty State ───

  describe("empty state", () => {
    it("returns zeros when instructor has no courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const metrics = getRollupMetrics(otherInstructor.id, 30, otherInstructor.id, schema.UserRole.Instructor);

      expect(metrics.grossRevenue).toBe(0);
      expect(metrics.newEnrollments).toBe(0);
      expect(metrics.activeLearners).toBe(0);
      expect(metrics.completionRate).toBe(0);
    });

    it("returns zeros when no activity exists for courses", () => {
      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);

      expect(metrics.grossRevenue).toBe(0);
      expect(metrics.newEnrollments).toBe(0);
      expect(metrics.activeLearners).toBe(0);
      expect(metrics.completionRate).toBe(0);
    });
  });

  // ─── Gross Revenue ───

  describe("grossRevenue", () => {
    it("sums purchases within the date range", () => {
      createPurchase(base.user.id, base.course.id, 1999, daysAgo(5));
      createPurchase(base.user.id, base.course.id, 999, daysAgo(3));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(2998);
    });

    it("excludes purchases outside the date range", () => {
      createPurchase(base.user.id, base.course.id, 1999, daysAgo(5));  // within 7d
      createPurchase(base.user.id, base.course.id, 999, daysAgo(10)); // outside 7d

      const metrics = getRollupMetrics(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(1999);
    });

    it("includes purchases from the boundary of the range", () => {
      createPurchase(base.user.id, base.course.id, 500, daysAgo(30));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBeGreaterThanOrEqual(500);
    });

    it("excludes purchases for courses owned by other instructors", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");
      createPurchase(base.user.id, otherCourse.id, 5000, daysAgo(1));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(0);
    });

    it("returns 0 when no purchases exist", () => {
      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(0);
    });
  });

  // ─── New Enrollments ───

  describe("newEnrollments", () => {
    it("counts enrollments within the date range", () => {
      const student2 = createUser("s2@example.com");
      createEnrollment(base.user.id, base.course.id, daysAgo(5));
      createEnrollment(student2.id, base.course.id, daysAgo(2));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.newEnrollments).toBe(2);
    });

    it("excludes enrollments outside the date range", () => {
      const student2 = createUser("s2@example.com");
      createEnrollment(base.user.id, base.course.id, daysAgo(5)); // within 7d
      createEnrollment(student2.id, base.course.id, daysAgo(10)); // outside 7d

      const metrics = getRollupMetrics(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.newEnrollments).toBe(1);
    });

    it("excludes enrollments for other instructors' courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");
      createEnrollment(base.user.id, otherCourse.id, daysAgo(1));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.newEnrollments).toBe(0);
    });

    it("returns 0 when no enrollments exist", () => {
      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.newEnrollments).toBe(0);
    });
  });

  // ─── Active Learners ───

  describe("activeLearners", () => {
    it("counts distinct users who made any lesson progress within the range", () => {
      const student2 = createUser("s2@example.com");
      createEnrollment(base.user.id, base.course.id, daysAgo(60));
      createEnrollment(student2.id, base.course.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(base.course.id, 2);

      startLessonAt(base.user.id, lessons[0].id, daysAgo(5));
      completeLessonAt(student2.id, lessons[0].id, daysAgo(3));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.activeLearners).toBe(2);
    });

    it("counts each user only once even if they have multiple progress records", () => {
      createEnrollment(base.user.id, base.course.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(base.course.id, 3);

      startLessonAt(base.user.id, lessons[0].id, daysAgo(5));
      completeLessonAt(base.user.id, lessons[1].id, daysAgo(4));
      completeLessonAt(base.user.id, lessons[2].id, daysAgo(3));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.activeLearners).toBe(1);
    });

    it("excludes progress outside the date range", () => {
      createEnrollment(base.user.id, base.course.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(base.course.id, 1);

      startLessonAt(base.user.id, lessons[0].id, daysAgo(10)); // outside 7d

      const metrics = getRollupMetrics(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.activeLearners).toBe(0);
    });

    it("excludes activity in other instructors' courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");
      createEnrollment(base.user.id, otherCourse.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(otherCourse.id, 1);
      completeLessonAt(base.user.id, lessons[0].id, daysAgo(2));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.activeLearners).toBe(0);
    });

    it("returns 0 when no lesson progress happened in range", () => {
      createEnrollment(base.user.id, base.course.id, daysAgo(5));
      createModuleWithLessons(base.course.id, 2);

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.activeLearners).toBe(0);
    });
  });

  // ─── Completion Rate ───

  describe("completionRate", () => {
    it("returns 100 when all enrolled learners have completed all lessons", () => {
      createEnrollment(base.user.id, base.course.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(base.course.id, 2);
      completeLessonAt(base.user.id, lessons[0].id, daysAgo(10));
      completeLessonAt(base.user.id, lessons[1].id, daysAgo(9));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.completionRate).toBe(100);
    });

    it("returns 0 when no enrolled learner has completed all lessons", () => {
      createEnrollment(base.user.id, base.course.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(base.course.id, 2);
      completeLessonAt(base.user.id, lessons[0].id, daysAgo(5)); // only 1 of 2

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.completionRate).toBe(0);
    });

    it("calculates correct rate when some but not all learners have completed", () => {
      const student2 = createUser("s2@example.com");
      const student3 = createUser("s3@example.com");
      createEnrollment(base.user.id, base.course.id, daysAgo(60));
      createEnrollment(student2.id, base.course.id, daysAgo(60));
      createEnrollment(student3.id, base.course.id, daysAgo(60));

      const { lessons } = createModuleWithLessons(base.course.id, 1);
      completeLessonAt(base.user.id, lessons[0].id, daysAgo(10)); // completed
      completeLessonAt(student2.id, lessons[0].id, daysAgo(5));   // completed
      // student3 has not completed

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.completionRate).toBe(67); // 2/3 = 66.7 → 67
    });

    it("is not time-scoped — includes learners enrolled before the selected range", () => {
      // Enrollment 90 days ago, completion 60 days ago, but we're filtering to 7 days
      createEnrollment(base.user.id, base.course.id, daysAgo(90));
      const { lessons } = createModuleWithLessons(base.course.id, 1);
      completeLessonAt(base.user.id, lessons[0].id, daysAgo(60));

      // Even though enrollment and completion are outside 7d range, completion rate should be 100
      const metrics = getRollupMetrics(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.completionRate).toBe(100);
    });

    it("returns 0 for a course with no lessons (excluded from denominator)", () => {
      createEnrollment(base.user.id, base.course.id, daysAgo(5));
      // No lessons created

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.completionRate).toBe(0);
    });

    it("excludes enrollments for other instructors' courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");
      createEnrollment(base.user.id, otherCourse.id, daysAgo(60));
      const { lessons } = createModuleWithLessons(otherCourse.id, 1);
      completeLessonAt(base.user.id, lessons[0].id, daysAgo(5));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.completionRate).toBe(0);
    });
  });

  // ─── Time Range Switching ───

  describe("time range filter", () => {
    it("7d range excludes activity older than 7 days", () => {
      createPurchase(base.user.id, base.course.id, 1000, daysAgo(8));
      createEnrollment(base.user.id, base.course.id, daysAgo(8));

      const metrics = getRollupMetrics(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(0);
      expect(metrics.newEnrollments).toBe(0);
    });

    it("30d range includes 8-day-old activity excluded by 7d range", () => {
      createPurchase(base.user.id, base.course.id, 1000, daysAgo(8));
      createEnrollment(base.user.id, base.course.id, daysAgo(8));

      const metrics30 = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics30.grossRevenue).toBe(1000);
      expect(metrics30.newEnrollments).toBe(1);
    });

    it("90d range includes activity excluded by 30d range", () => {
      createPurchase(base.user.id, base.course.id, 2500, daysAgo(45));
      createEnrollment(base.user.id, base.course.id, daysAgo(45));

      const metrics30 = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      const metrics90 = getRollupMetrics(base.instructor.id, 90, base.instructor.id, schema.UserRole.Instructor);

      expect(metrics30.grossRevenue).toBe(0);
      expect(metrics90.grossRevenue).toBe(2500);
      expect(metrics30.newEnrollments).toBe(0);
      expect(metrics90.newEnrollments).toBe(1);
    });
  });

  // ─── Instructor Scoping ───

  describe("instructor scoping", () => {
    it("instructor only sees metrics for their own courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");

      // Activity on other instructor's course
      createPurchase(base.user.id, otherCourse.id, 5000, daysAgo(1));
      createEnrollment(base.user.id, otherCourse.id, daysAgo(1));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(0);
      expect(metrics.newEnrollments).toBe(0);
    });

    it("aggregates across multiple courses owned by the same instructor", () => {
      const course2 = createCourse(base.instructor.id, "course-2");

      createPurchase(base.user.id, base.course.id, 1000, daysAgo(5));
      createPurchase(base.user.id, course2.id, 2000, daysAgo(3));
      createEnrollment(base.user.id, base.course.id, daysAgo(5));
      createEnrollment(base.user.id, course2.id, daysAgo(3));

      const metrics = getRollupMetrics(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
      expect(metrics.grossRevenue).toBe(3000);
      expect(metrics.newEnrollments).toBe(2);
    });
  });

  // ─── Admin Scoping ───

  describe("admin scoping", () => {
    it("admin with null instructorId sees all courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");

      createPurchase(base.user.id, base.course.id, 1000, daysAgo(5));
      createPurchase(base.user.id, otherCourse.id, 2000, daysAgo(5));

      const metrics = getRollupMetrics(null, 30, schema.UserRole.Admin);
      expect(metrics.grossRevenue).toBe(3000);
    });

    it("admin with a specific instructorId sees only that instructor's courses", () => {
      const otherInstructor = createUser("other@example.com", schema.UserRole.Instructor);
      const otherCourse = createCourse(otherInstructor.id, "other-course");

      createPurchase(base.user.id, base.course.id, 1000, daysAgo(5));
      createPurchase(base.user.id, otherCourse.id, 2000, daysAgo(5));

      const metricsBase = getRollupMetrics(base.instructor.id, 30, schema.UserRole.Admin);
      expect(metricsBase.grossRevenue).toBe(1000);

      const metricsOther = getRollupMetrics(otherInstructor.id, 30, schema.UserRole.Admin);
      expect(metricsOther.grossRevenue).toBe(2000);
    });
  });

  // ─── getCourseRows ───

  describe("getCourseRows", () => {
    // ── Authorization ────────────────────────────────────────────────────────

    describe("authorization", () => {
      it("throws for student role", () => {
        expect(() =>
          getCourseRows(base.instructor.id, 30, schema.UserRole.Student)
        ).toThrow("Unauthorized");
      });

      it("prevents instructors from requesting another instructor's course rows", () => {
        const otherInstructor = createUser("other-rows@example.com", schema.UserRole.Instructor);

        expect(() =>
          rawGetCourseRows(otherInstructor.id, 30, base.instructor.id, schema.UserRole.Instructor)
        ).toThrow("Forbidden");
      });
    });

    // ── Empty state ───────────────────────────────────────────────────────────

    describe("empty state", () => {
      it("returns empty array when instructor has no courses", () => {
        const otherInstructor = createUser("nobody@example.com", schema.UserRole.Instructor);
        const rows = getCourseRows(otherInstructor.id, 30, otherInstructor.id, schema.UserRole.Instructor);
        expect(rows).toEqual([]);
      });
    });

    // ── Per-course metrics ────────────────────────────────────────────────────

    describe("per-course metrics", () => {
      it("returns one row per course owned by the instructor", () => {
        const course2 = createCourse(base.instructor.id, "course-2");
        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const ids = rows.map((r) => r.courseId).sort();
        expect(ids).toEqual([base.course.id, course2.id].sort());
      });

      it("revenue is scoped to date range", () => {
        createPurchase(base.user.id, base.course.id, 1000, daysAgo(5));  // in range
        createPurchase(base.user.id, base.course.id, 500, daysAgo(40)); // out of range

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.revenue).toBe(1000);
      });

      it("newEnrollments is scoped to date range", () => {
        const student2 = createUser("s2@example.com");
        createEnrollment(base.user.id, base.course.id, daysAgo(5));   // in range
        createEnrollment(student2.id, base.course.id, daysAgo(40));  // out of range

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.newEnrollments).toBe(1);
      });

      it("activeLearners is scoped to date range using any progress activity", () => {
        const student2 = createUser("s2@example.com");
        createEnrollment(base.user.id, base.course.id, daysAgo(60));
        createEnrollment(student2.id, base.course.id, daysAgo(60));
        const { lessons } = createModuleWithLessons(base.course.id, 1);
        startLessonAt(base.user.id, lessons[0].id, daysAgo(5));      // in range
        completeLessonAt(student2.id, lessons[0].id, daysAgo(40));   // out of range

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.activeLearners).toBe(1);
      });

      it("completionRate is not date-scoped (includes learners enrolled before range)", () => {
        // Enrollment and completion both outside the 7-day range
        createEnrollment(base.user.id, base.course.id, daysAgo(90));
        const { lessons } = createModuleWithLessons(base.course.id, 1);
        completeLessonAt(base.user.id, lessons[0].id, daysAgo(60));

        const rows = getCourseRows(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.completionRate).toBe(100);
      });

      it("avgRating reflects current ratings (not date-scoped)", () => {
        createRating(base.user.id, base.course.id, 4);
        const student2 = createUser("s2@example.com");
        createRating(student2.id, base.course.id, 5);

        const rows = getCourseRows(base.instructor.id, 7, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.avgRating).toBeCloseTo(4.5, 1);
        expect(row.ratingCount).toBe(2);
      });
    });

    // ── Warning flags: lowEnrollments ─────────────────────────────────────────

    describe("warning: lowEnrollments", () => {
      it("course with 4 total enrollments shows lowEnrollments flag", () => {
        const students = Array.from({ length: 4 }, (_, i) =>
          createUser(`le-student${i}@example.com`)
        );
        for (const s of students) {
          createEnrollment(s.id, base.course.id, daysAgo(60));
        }

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.warnings.lowEnrollments).toBe(true);
      });

      it("course with 5 total enrollments does NOT show lowEnrollments flag", () => {
        const students = Array.from({ length: 5 }, (_, i) =>
          createUser(`le5-student${i}@example.com`)
        );
        for (const s of students) {
          createEnrollment(s.id, base.course.id, daysAgo(60));
        }

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.warnings.lowEnrollments).toBe(false);
      });

      it("course with 6 total enrollments shows no lowEnrollments flag", () => {
        const students = Array.from({ length: 6 }, (_, i) =>
          createUser(`le6-student${i}@example.com`)
        );
        for (const s of students) {
          createEnrollment(s.id, base.course.id, daysAgo(60));
        }

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.warnings.lowEnrollments).toBe(false);
      });
    });

    // ── Warning flags: lowCompletion ──────────────────────────────────────────

    describe("warning: lowCompletion", () => {
      it("course with 0% completion rate shows lowCompletion flag", () => {
        createEnrollment(base.user.id, base.course.id, daysAgo(60));
        createModuleWithLessons(base.course.id, 1);
        // No completions

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.warnings.lowCompletion).toBe(true);
      });

      it("course with 16% completion rate (< 20) shows lowCompletion flag", () => {
        // 1 of 6 enrolled completed = ~16%
        const students = Array.from({ length: 6 }, (_, i) =>
          createUser(`lc-student${i}@example.com`)
        );
        for (const s of students) {
          createEnrollment(s.id, base.course.id, daysAgo(60));
        }
        const { lessons } = createModuleWithLessons(base.course.id, 1);
        completeLessonAt(students[0].id, lessons[0].id, daysAgo(10));

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.completionRate).toBeLessThan(20);
        expect(row.warnings.lowCompletion).toBe(true);
      });

      it("course with 20% completion rate does NOT show lowCompletion flag", () => {
        // 1 of 5 enrolled completed = 20%
        const students = Array.from({ length: 5 }, (_, i) =>
          createUser(`lc20-student${i}@example.com`)
        );
        for (const s of students) {
          createEnrollment(s.id, base.course.id, daysAgo(60));
        }
        const { lessons } = createModuleWithLessons(base.course.id, 1);
        completeLessonAt(students[0].id, lessons[0].id, daysAgo(10));

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.completionRate).toBe(20);
        expect(row.warnings.lowCompletion).toBe(false);
      });

      it("course with 50% completion rate shows no lowCompletion flag", () => {
        const student2 = createUser("lc50-s2@example.com");
        createEnrollment(base.user.id, base.course.id, daysAgo(60));
        createEnrollment(student2.id, base.course.id, daysAgo(60));
        const { lessons } = createModuleWithLessons(base.course.id, 1);
        completeLessonAt(base.user.id, lessons[0].id, daysAgo(10));

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.completionRate).toBe(50);
        expect(row.warnings.lowCompletion).toBe(false);
      });
    });

    // ── Warning flags: lowRating ──────────────────────────────────────────────

    describe("warning: lowRating", () => {
      it("course with avg rating 3.4 and 3 ratings shows lowRating flag", () => {
        const s2 = createUser("lr-s2@example.com");
        const s3 = createUser("lr-s3@example.com");
        createRating(base.user.id, base.course.id, 4);
        createRating(s2.id, base.course.id, 3);
        createRating(s3.id, base.course.id, 3); // avg = 10/3 = 3.33...

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.avgRating!).toBeLessThan(3.5);
        expect(row.warnings.lowRating).toBe(true);
      });

      it("course with avg rating 3.67 (> 3.5) and 3 ratings does NOT show lowRating flag", () => {
        // Use a fresh course to avoid interference with other tests
        const course2 = createCourse(base.instructor.id, "lr35-course-a");
        const s2 = createUser("lr35-s2@example.com");
        const s3 = createUser("lr35-s3@example.com");
        createRating(base.user.id, course2.id, 4);
        createRating(s2.id, course2.id, 3);
        createRating(s3.id, course2.id, 4); // avg = 11/3 ≈ 3.67 ≥ 3.5

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === course2.id)!;
        expect(row.avgRating!).toBeGreaterThanOrEqual(3.5);
        expect(row.warnings.lowRating).toBe(false);
      });

      it("course with avg rating >= 3.5 (exactly 3.5) and 4 ratings does NOT show lowRating flag", () => {
        const course2 = createCourse(base.instructor.id, "lr35-course");
        const s2 = createUser("lr35b-s2@example.com");
        const s3 = createUser("lr35b-s3@example.com");
        const s4 = createUser("lr35b-s4@example.com");
        createRating(base.user.id, course2.id, 3);
        createRating(s2.id, course2.id, 3);
        createRating(s3.id, course2.id, 4);
        createRating(s4.id, course2.id, 4); // avg = 14/4 = 3.5

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === course2.id)!;
        expect(row.avgRating).toBeCloseTo(3.5, 5);
        expect(row.warnings.lowRating).toBe(false);
      });

      it("course with avg rating 2.0 but only 2 ratings does NOT show lowRating (insufficient count)", () => {
        const s2 = createUser("lr2-s2@example.com");
        createRating(base.user.id, base.course.id, 2);
        createRating(s2.id, base.course.id, 2); // avg = 2.0, count = 2 < MIN_RATINGS_FOR_LOW_RATING

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.avgRating).toBeCloseTo(2.0, 1);
        expect(row.ratingCount).toBe(2);
        expect(row.warnings.lowRating).toBe(false);
      });

      it("course with 0 ratings does NOT show lowRating", () => {
        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.avgRating).toBeNull();
        expect(row.ratingCount).toBe(0);
        expect(row.warnings.lowRating).toBe(false);
      });
    });

    // ── Multiple flags ─────────────────────────────────────────────────────────

    describe("multiple flags", () => {
      it("course can have multiple warning flags simultaneously", () => {
        // 0 enrollments → lowEnrollments; 0% completion → lowCompletion; low rating → lowRating
        const s2 = createUser("mf-s2@example.com");
        const s3 = createUser("mf-s3@example.com");
        // 2 enrollments (< 5) → lowEnrollments = true
        createEnrollment(base.user.id, base.course.id, daysAgo(60));
        createEnrollment(s2.id, base.course.id, daysAgo(60));
        // 1 lesson, nobody completed → lowCompletion = true (0%)
        createModuleWithLessons(base.course.id, 1);
        // 3 ratings averaging < 3.5 → lowRating = true
        createRating(base.user.id, base.course.id, 2);
        createRating(s2.id, base.course.id, 2);
        createRating(s3.id, base.course.id, 3); // avg = 7/3 = 2.33

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const row = rows.find((r) => r.courseId === base.course.id)!;
        expect(row.warnings.lowEnrollments).toBe(true);
        expect(row.warnings.lowCompletion).toBe(true);
        expect(row.warnings.lowRating).toBe(true);
      });
    });

    // ── Course isolation ───────────────────────────────────────────────────────

    describe("course isolation", () => {
      it("metrics for course A are unaffected by data from course B", () => {
        const course2 = createCourse(base.instructor.id, "isolation-course-2");
        const student2 = createUser("iso-s2@example.com");

        // Activity only on course2
        createPurchase(student2.id, course2.id, 9999, daysAgo(5));
        createEnrollment(student2.id, course2.id, daysAgo(5));
        const { lessons: c2lessons } = createModuleWithLessons(course2.id, 1);
        completeLessonAt(student2.id, c2lessons[0].id, daysAgo(3));
        createRating(student2.id, course2.id, 5);

        const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, schema.UserRole.Instructor);
        const rowA = rows.find((r) => r.courseId === base.course.id)!;

        expect(rowA.revenue).toBe(0);
        expect(rowA.newEnrollments).toBe(0);
        expect(rowA.activeLearners).toBe(0);
        expect(rowA.avgRating).toBeNull();
        expect(rowA.ratingCount).toBe(0);
      });
    });

    // ─── Phase 3: single-course detail view ───────────────────────────────────

    describe("getCourseDetailMetrics", () => {
      it("returns metrics scoped to one course and ignores other course data", () => {
        const course2 = createCourse(base.instructor.id, "detail-course-2");
        const student2 = createUser("detail-s2@example.com");

        createPurchase(base.user.id, base.course.id, 1111, daysAgo(5));
        createEnrollment(base.user.id, base.course.id, daysAgo(5));
        const { lessons } = createModuleWithLessons(base.course.id, 1);
        completeLessonAt(base.user.id, lessons[0].id, daysAgo(4));
        createRating(base.user.id, base.course.id, 4);

        createPurchase(student2.id, course2.id, 9999, daysAgo(3));
        createEnrollment(student2.id, course2.id, daysAgo(3));
        const { lessons: course2Lessons } = createModuleWithLessons(course2.id, 2);
        completeLessonAt(student2.id, course2Lessons[0].id, daysAgo(2));
        completeLessonAt(student2.id, course2Lessons[1].id, daysAgo(1));
        createRating(student2.id, course2.id, 1);

        const metrics = getCourseDetailMetrics(
          base.course.id,
          30,
          base.instructor.id,
          schema.UserRole.Instructor
        );

        expect(metrics.courseTitle).toBe(base.course.title);
        expect(metrics.grossRevenue).toBe(1111);
        expect(metrics.newEnrollments).toBe(1);
        expect(metrics.activeLearners).toBe(1);
        expect(metrics.completionRate).toBe(100);
        expect(metrics.avgRating).toBe(4);
        expect(metrics.ratingCount).toBe(1);
        expect(metrics.totalEnrolled).toBe(1);
      });

      it("blocks non-owners and allows admins", () => {
        const otherInstructor = createUser("detail-owner@example.com", schema.UserRole.Instructor);
        const otherCourse = createCourse(otherInstructor.id, "detail-owner-course");
        const admin = createUser("detail-admin@example.com", schema.UserRole.Admin);

        expect(() =>
          getCourseDetailMetrics(
            otherCourse.id,
            30,
            base.instructor.id,
            schema.UserRole.Instructor
          )
        ).toThrow("Forbidden");

        expect(() =>
          getCourseDetailMetrics(otherCourse.id, 30, admin.id, schema.UserRole.Admin)
        ).not.toThrow();
      });
    });

    describe("getStudentProgressRows", () => {
      it("returns each enrolled learner with progress, last activity, and completion state", () => {
        const student2 = createUser("progress-s2@example.com");
        const student3 = createUser("progress-s3@example.com");
        createEnrollment(base.user.id, base.course.id, daysAgo(60));
        createEnrollment(student2.id, base.course.id, daysAgo(60));
        createEnrollment(student3.id, base.course.id, daysAgo(60));

        const { lessons } = createModuleWithLessons(base.course.id, 3);
        const firstCompletionAt = daysAgo(5);
        const latestCompletionAt = daysAgo(2);
        const student2CompletionAt = daysAgo(3);

        completeLessonAt(base.user.id, lessons[0].id, firstCompletionAt);
        completeLessonAt(base.user.id, lessons[1].id, latestCompletionAt);
        completeLessonAt(base.user.id, lessons[2].id, latestCompletionAt);
        completeLessonAt(student2.id, lessons[0].id, student2CompletionAt);

        const rows = getStudentProgressRows(
          base.course.id,
          base.instructor.id,
          schema.UserRole.Instructor
        );

        const row1 = rows.find((row) => row.userId === base.user.id)!;
        const row2 = rows.find((row) => row.userId === student2.id)!;
        const row3 = rows.find((row) => row.userId === student3.id)!;

        expect(rows).toHaveLength(3);
        expect(row1.progressPercent).toBe(100);
        expect(row1.lastActivityAt).toBe(latestCompletionAt);
        expect(row1.isCompleted).toBe(true);

        expect(row2.progressPercent).toBe(33);
        expect(row2.lastActivityAt).toBe(student2CompletionAt);
        expect(row2.isCompleted).toBe(false);

        expect(row3.progressPercent).toBe(0);
        expect(row3.lastActivityAt).toBeNull();
        expect(row3.isCompleted).toBe(false);
      });

      it("blocks instructors from viewing another instructor's course", () => {
        const otherInstructor = createUser(
          "progress-owner@example.com",
          schema.UserRole.Instructor
        );
        const otherCourse = createCourse(otherInstructor.id, "progress-owner-course");

        expect(() =>
          getStudentProgressRows(otherCourse.id, base.instructor.id, schema.UserRole.Instructor)
        ).toThrow("Forbidden");
      });
    });

    // ── Admin scoping ──────────────────────────────────────────────────────────

    describe("admin scoping", () => {
      it("admin with null instructorId sees rows for all courses", () => {
        const otherInstructor = createUser("admin-other@example.com", schema.UserRole.Instructor);
        const otherCourse = createCourse(otherInstructor.id, "admin-other-course");

        createPurchase(base.user.id, base.course.id, 1000, daysAgo(5));
        createPurchase(base.user.id, otherCourse.id, 2000, daysAgo(5));

        const rows = getCourseRows(null, 30, schema.UserRole.Admin);
        const ids = rows.map((r) => r.courseId);
        expect(ids).toContain(base.course.id);
        expect(ids).toContain(otherCourse.id);

        const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
        expect(totalRevenue).toBe(3000);
      });
    });
  });
});
