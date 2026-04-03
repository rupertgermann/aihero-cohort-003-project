import { beforeEach, describe, expect, it, vi } from "vitest";
import { data } from "react-router";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import type { CourseRow } from "~/services/analyticsService";
import { getCourseRows } from "~/services/analyticsService";
import { UserRole } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
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

function createEnrollment(userId: number, courseId: number, enrolledAt: string) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, enrolledAt })
    .returning()
    .get();
}

function createPurchase(userId: number, courseId: number, pricePaid: number, createdAt: string) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, pricePaid, country: null, createdAt })
    .returning()
    .get();
}

function createModuleWithLessons(courseId: number, lessonCount: number) {
  const module = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();

  const lessons: (typeof schema.lessons.$inferSelect)[] = [];
  for (let i = 0; i < lessonCount; i++) {
    lessons.push(
      testDb
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${i + 1}`, position: i + 1 })
        .returning()
        .get()
    );
  }

  return lessons;
}

function createRating(userId: number, courseId: number, rating: number) {
  return testDb
    .insert(schema.courseRatings)
    .values({ userId, courseId, rating })
    .returning()
    .get();
}

function serializeCourseRowsToCsv(rows: CourseRow[]) {
  const headers = [
    "courseId",
    "courseTitle",
    "revenue",
    "newEnrollments",
    "activeLearners",
    "completionRate",
    "avgRating",
    "ratingCount",
    "lowEnrollments",
    "lowCompletion",
    "lowRating",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.courseId,
        JSON.stringify(row.courseTitle),
        row.revenue,
        row.newEnrollments,
        row.activeLearners,
        row.completionRate,
        row.avgRating ?? "",
        row.ratingCount,
        row.warnings.lowEnrollments,
        row.warnings.lowCompletion,
        row.warnings.lowRating,
      ].join(",")
    ),
  ];

  return lines.join("\n");
}

function parseCsv(csv: string) {
  return csv.split("\n").filter(Boolean);
}

function exportAnalyticsCsvContract(viewerRole: schema.UserRole, rows: CourseRow[]) {
  if (viewerRole !== schema.UserRole.Admin) {
    throw data("Only admins can export analytics.", { status: 403 });
  }

  return serializeCourseRowsToCsv(rows);
}

describe("instructor analytics CSV contract", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("serializes the same columns as the comparison table and respects instructor scoping", () => {
    const otherInstructor = createUser("other-admin-filter@example.com", schema.UserRole.Instructor);
    const otherCourse = createCourse(otherInstructor.id, "other-course");

    createPurchase(base.user.id, base.course.id, 1000, daysAgo(5));
    createEnrollment(base.user.id, base.course.id, daysAgo(5));
    createRating(base.user.id, base.course.id, 4);

    createPurchase(base.user.id, otherCourse.id, 2000, daysAgo(5));
    createEnrollment(base.user.id, otherCourse.id, daysAgo(5));
    createRating(base.user.id, otherCourse.id, 5);

    const rows = getCourseRows(otherInstructor.id, 30, base.instructor.id, UserRole.Admin);
    const csv = serializeCourseRowsToCsv(rows);
    const lines = parseCsv(csv);

    expect(lines[0]).toBe(
      "courseId,courseTitle,revenue,newEnrollments,activeLearners,completionRate,avgRating,ratingCount,lowEnrollments,lowCompletion,lowRating"
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(String(otherCourse.id));
    expect(lines[1]).toContain(JSON.stringify(otherCourse.title));
    expect(lines[1]).toContain("2000");
    expect(lines[1]).toContain("1");
  });

  it("keeps the CSV row set aligned with the selected date range", () => {
    const course2 = createCourse(base.instructor.id, "csv-range-course");
    const student2 = createUser("csv-range-student@example.com");

    createPurchase(base.user.id, course2.id, 1500, daysAgo(40));
    createEnrollment(base.user.id, course2.id, daysAgo(40));

    createPurchase(student2.id, course2.id, 2500, daysAgo(5));
    createEnrollment(student2.id, course2.id, daysAgo(5));
    const [lesson] = createModuleWithLessons(course2.id, 1);
    const progress = testDb
      .insert(schema.lessonProgress)
      .values({
        userId: student2.id,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
        completedAt: daysAgo(3),
        updatedAt: daysAgo(3),
      })
      .returning()
      .get();
    expect(progress).toBeDefined();

    const rows = getCourseRows(base.instructor.id, 7, base.instructor.id, UserRole.Instructor);
    const row = rows.find((item) => item.courseId === course2.id);

    expect(row).toBeDefined();
    expect(row?.revenue).toBe(2500);
    expect(row?.newEnrollments).toBe(1);

    const csv = serializeCourseRowsToCsv(rows);
    expect(parseCsv(csv)).toHaveLength(rows.length + 1);
  });

  it("rejects non-admin export attempts", () => {
    try {
      exportAnalyticsCsvContract(schema.UserRole.Student, []);
      throw new Error("Expected export to reject students.");
    } catch (error) {
      expect(error).toMatchObject({
        type: "DataWithResponseInit",
        data: "Only admins can export analytics.",
        init: { status: 403 },
      });
    }

    try {
      exportAnalyticsCsvContract(schema.UserRole.Instructor, []);
      throw new Error("Expected export to reject instructors.");
    } catch (error) {
      expect(error).toMatchObject({
        type: "DataWithResponseInit",
        data: "Only admins can export analytics.",
        init: { status: 403 },
      });
    }
  });

  it("allows admins to export rows", () => {
    const rows = getCourseRows(base.instructor.id, 30, base.instructor.id, UserRole.Instructor);
    const csv = exportAnalyticsCsvContract(schema.UserRole.Admin, rows);

    expect(parseCsv(csv)).toHaveLength(rows.length + 1);
  });
});
