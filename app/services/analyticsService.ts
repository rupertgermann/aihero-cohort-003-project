import { and, avg, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courseRatings,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  users,
  LessonProgressStatus,
  UserRole,
} from "~/db/schema";

// ─── Warning Flag Thresholds (v1 fixed constants) ───

export const WARNING_THRESHOLDS = {
  LOW_ENROLLMENTS: 5,
  LOW_COMPLETION_RATE: 20,
  LOW_RATING: 3.5,
  MIN_RATINGS_FOR_LOW_RATING: 3,
} as const;

// ─── Types ───

export interface RollupMetrics {
  grossRevenue: number;
  newEnrollments: number;
  activeLearners: number;
  completionRate: number; // 0–100 integer
}

export interface CourseWarnings {
  lowEnrollments: boolean;
  lowCompletion: boolean;
  lowRating: boolean;
}

export interface CourseRow {
  courseId: number;
  courseTitle: string;
  revenue: number;
  newEnrollments: number;
  activeLearners: number;
  completionRate: number;
  avgRating: number | null; // null if no ratings
  ratingCount: number;
  warnings: CourseWarnings;
}

// ─── Internal Helpers ───

function getCutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Returns course IDs in scope:
 * - if instructorId is provided, returns only that instructor's courses
 * - if null, returns all course IDs (admin "see everything" case)
 */
function getScopedCourseIds(instructorId: number | null): number[] {
  const rows =
    instructorId !== null
      ? db
          .select({ id: courses.id })
          .from(courses)
          .where(eq(courses.instructorId, instructorId))
          .all()
      : db.select({ id: courses.id }).from(courses).all();
  return rows.map((r) => r.id);
}

function assertRollupAccess(
  instructorId: number | null,
  viewerId: number,
  viewerRole: UserRole
) {
  if (viewerRole !== UserRole.Admin && viewerRole !== UserRole.Instructor) {
    throw new Error("Unauthorized: only instructors and admins may access analytics");
  }

  if (viewerRole === UserRole.Instructor) {
    if (instructorId === null || instructorId !== viewerId) {
      throw new Error("Forbidden: instructors may only access their own analytics");
    }
  }
}

// ─── Completion Rate Helper ───

function computeCompletionRate(courseIds: number[]): number {
  if (courseIds.length === 0) return 0;

  // Total lessons per course (used to determine whether a user has 100% completion)
  const lessonCountRows = db
    .select({
      courseId: modules.courseId,
      total: sql<number>`count(${lessons.id})`,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .groupBy(modules.courseId)
    .all();

  const lessonCountMap = new Map(lessonCountRows.map((r) => [r.courseId, r.total]));

  // All enrollments for these courses (not date-scoped — completion rate looks at the full enrolled base)
  const allEnrollments = db
    .select({ userId: enrollments.userId, courseId: enrollments.courseId })
    .from(enrollments)
    .where(inArray(enrollments.courseId, courseIds))
    .all();

  if (allEnrollments.length === 0) return 0;

  // Completed lessons per (user, course)
  const completedRows = db
    .select({
      userId: lessonProgress.userId,
      courseId: modules.courseId,
      completed: sql<number>`count(${lessonProgress.id})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        inArray(modules.courseId, courseIds),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .groupBy(lessonProgress.userId, modules.courseId)
    .all();

  const completedMap = new Map<string, number>(
    completedRows.map((r) => [`${r.userId}:${r.courseId}`, r.completed])
  );

  let numerator = 0;
  let denominator = 0;

  for (const e of allEnrollments) {
    const totalLessons = lessonCountMap.get(e.courseId) ?? 0;
    if (totalLessons === 0) continue; // courses with no lessons are excluded from rate calculation
    denominator++;
    const completedLessons = completedMap.get(`${e.userId}:${e.courseId}`) ?? 0;
    if (completedLessons >= totalLessons) numerator++;
  }

  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

// ─── Course Detail Types ───

export interface CourseDetailMetrics {
  courseTitle: string;
  grossRevenue: number;
  newEnrollments: number;
  activeLearners: number;
  completionRate: number;
  avgRating: number | null;
  ratingCount: number;
  totalEnrolled: number;
  warnings: CourseWarnings;
}

export interface StudentProgressRow {
  userId: number;
  name: string;
  email: string;
  enrolledAt: string;
  progressPercent: number; // 0–100
  lastActivityAt: string | null;
  isCompleted: boolean;
}

// ─── Course Access Helper ───

/**
 * Loads the course and verifies the viewer is allowed to access it.
 * Throws if the course does not exist, the role is insufficient, or the
 * instructor does not own the course.
 */
function assertCourseAccess(
  courseId: number,
  viewerId: number,
  viewerRole: UserRole
): { id: number; title: string; instructorId: number } {
  if (viewerRole !== UserRole.Admin && viewerRole !== UserRole.Instructor) {
    throw new Error("Unauthorized: only instructors and admins may access analytics");
  }

  const course = db
    .select({ id: courses.id, title: courses.title, instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();

  if (!course) throw new Error("Course not found");

  if (viewerRole === UserRole.Instructor && course.instructorId !== viewerId) {
    throw new Error("Forbidden: you do not own this course");
  }

  return course;
}

// ─── Public API ───

/**
 * Returns aggregate KPI metrics across a set of courses.
 *
 * @param instructorId - The instructor whose courses to aggregate.
 *   Pass null (admin only) to aggregate across all courses.
 * @param days - Time range: 7, 30, or 90 days.
 * @param viewerIdOrRole - The caller's ID when passing a 4-argument call signature,
 *   or the caller's role for legacy admin/student call sites.
 * @param maybeViewerRole - The caller's role when passing a 4-argument call signature.
 *
 * Metric definitions:
 * - grossRevenue: sum of purchases.pricePaid within the date range
 * - newEnrollments: count of enrollments created within the date range
 * - activeLearners: distinct users who made any lesson progress within the date range
 * - completionRate: (enrollments where learner completed all lessons) / (total enrollments), not date-scoped
 */
export function getRollupMetrics(
  instructorId: number | null,
  days: number,
  viewerIdOrRole: number | UserRole,
  maybeViewerRole?: UserRole
): RollupMetrics {
  const viewerId =
    typeof viewerIdOrRole === "number" ? viewerIdOrRole : null;
  const viewerRole =
    typeof viewerIdOrRole === "number" ? maybeViewerRole : viewerIdOrRole;

  if (!viewerRole) {
    throw new Error("Viewer role is required");
  }
  if (viewerRole === UserRole.Instructor && viewerId === null) {
    throw new Error("Viewer ID is required for instructor analytics access");
  }

  assertRollupAccess(instructorId, viewerId ?? -1, viewerRole);

  const cutoff = getCutoffDate(days);
  const courseIds = getScopedCourseIds(instructorId);

  if (courseIds.length === 0) {
    return { grossRevenue: 0, newEnrollments: 0, activeLearners: 0, completionRate: 0 };
  }

  // Gross Revenue (time-scoped)
  const revenueRow = db
    .select({ total: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)` })
    .from(purchases)
    .where(and(inArray(purchases.courseId, courseIds), gte(purchases.createdAt, cutoff)))
    .get();
  const grossRevenue = revenueRow?.total ?? 0;

  // New Enrollments (time-scoped)
  const enrollRow = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(and(inArray(enrollments.courseId, courseIds), gte(enrollments.enrolledAt, cutoff)))
    .get();
  const newEnrollments = enrollRow?.count ?? 0;

  // Active Learners (time-scoped)
  // Distinct users who made any lesson progress in these courses within the date range.
  const activeRow = db
    .select({ count: sql<number>`count(distinct ${lessonProgress.userId})` })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        inArray(modules.courseId, courseIds),
        gte(lessonProgress.updatedAt, cutoff)
      )
    )
    .get();
  const activeLearners = activeRow?.count ?? 0;

  // Completion Rate (not time-scoped)
  const completionRate = computeCompletionRate(courseIds);

  return { grossRevenue, newEnrollments, activeLearners, completionRate };
}

/**
 * Returns one CourseRow per course in scope, with per-course KPI metrics and warning flags.
 *
 * @param instructorId - The instructor whose courses to aggregate.
 *   Pass null (admin only) to aggregate across all courses.
 * @param days - Time range: 7, 30, or 90 days.
 * @param viewerIdOrRole - The caller's ID when passing a 4-argument call signature,
 *   or the caller's role for legacy admin/student call sites.
 * @param maybeViewerRole - The caller's role when passing a 4-argument call signature.
 */
export function getCourseRows(
  instructorId: number | null,
  days: number,
  viewerIdOrRole: number | UserRole,
  maybeViewerRole?: UserRole
): CourseRow[] {
  const viewerId =
    typeof viewerIdOrRole === "number" ? viewerIdOrRole : null;
  const viewerRole =
    typeof viewerIdOrRole === "number" ? maybeViewerRole : viewerIdOrRole;

  if (!viewerRole) {
    throw new Error("Viewer role is required");
  }
  if (viewerRole === UserRole.Instructor && viewerId === null) {
    throw new Error("Viewer ID is required for instructor analytics access");
  }

  assertRollupAccess(instructorId, viewerId ?? -1, viewerRole);

  const cutoff = getCutoffDate(days);
  const courseIds = getScopedCourseIds(instructorId);

  if (courseIds.length === 0) return [];

  // ── Course titles ──────────────────────────────────────────────────────────
  const courseRows = db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(inArray(courses.id, courseIds))
    .all();

  // ── Revenue per course (time-scoped) ──────────────────────────────────────
  const revenueRows = db
    .select({
      courseId: purchases.courseId,
      total: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)`,
    })
    .from(purchases)
    .where(and(inArray(purchases.courseId, courseIds), gte(purchases.createdAt, cutoff)))
    .groupBy(purchases.courseId)
    .all();
  const revenueMap = new Map(revenueRows.map((r) => [r.courseId, r.total]));

  // ── New enrollments per course (time-scoped) ───────────────────────────────
  const newEnrollRows = db
    .select({
      courseId: enrollments.courseId,
      count: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(and(inArray(enrollments.courseId, courseIds), gte(enrollments.enrolledAt, cutoff)))
    .groupBy(enrollments.courseId)
    .all();
  const newEnrollMap = new Map(newEnrollRows.map((r) => [r.courseId, r.count]));

  // ── Active learners per course (time-scoped) ───────────────────────────────
  const activeRows = db
    .select({
      courseId: modules.courseId,
      count: sql<number>`count(distinct ${lessonProgress.userId})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        inArray(modules.courseId, courseIds),
        gte(lessonProgress.updatedAt, cutoff)
      )
    )
    .groupBy(modules.courseId)
    .all();
  const activeMap = new Map(activeRows.map((r) => [r.courseId, r.count]));

  // ── Completion rate per course (not time-scoped) ───────────────────────────
  // Reuse existing helper per course (one call per course is acceptable given
  // courseIds is typically small; a bulk version would mirror computeCompletionRate).
  const completionRateMap = new Map<number, number>();
  for (const id of courseIds) {
    completionRateMap.set(id, computeCompletionRate([id]));
  }

  // ── Ratings per course (not time-scoped) ──────────────────────────────────
  const ratingRows = db
    .select({
      courseId: courseRatings.courseId,
      avgRating: avg(courseRatings.rating),
      ratingCount: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();
  const ratingMap = new Map(
    ratingRows.map((r) => [
      r.courseId,
      {
        avgRating: r.avgRating !== null ? Number(r.avgRating) : null,
        ratingCount: r.ratingCount,
      },
    ])
  );

  // ── Total enrollments per course (all-time, for lowEnrollments flag) ───────
  const totalEnrollRows = db
    .select({
      courseId: enrollments.courseId,
      count: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(inArray(enrollments.courseId, courseIds))
    .groupBy(enrollments.courseId)
    .all();
  const totalEnrollMap = new Map(totalEnrollRows.map((r) => [r.courseId, r.count]));

  // ── Assemble rows ──────────────────────────────────────────────────────────
  return courseRows.map((course) => {
    const revenue = revenueMap.get(course.id) ?? 0;
    const newEnrollments = newEnrollMap.get(course.id) ?? 0;
    const activeLearners = activeMap.get(course.id) ?? 0;
    const completionRate = completionRateMap.get(course.id) ?? 0;
    const ratingInfo = ratingMap.get(course.id) ?? { avgRating: null, ratingCount: 0 };
    const totalEnrolled = totalEnrollMap.get(course.id) ?? 0;

    const warnings: CourseWarnings = {
      lowEnrollments: totalEnrolled < WARNING_THRESHOLDS.LOW_ENROLLMENTS,
      lowCompletion: completionRate < WARNING_THRESHOLDS.LOW_COMPLETION_RATE,
      lowRating:
        ratingInfo.avgRating !== null &&
        ratingInfo.ratingCount >= WARNING_THRESHOLDS.MIN_RATINGS_FOR_LOW_RATING &&
        ratingInfo.avgRating < WARNING_THRESHOLDS.LOW_RATING,
    };

    return {
      courseId: course.id,
      courseTitle: course.title,
      revenue,
      newEnrollments,
      activeLearners,
      completionRate,
      avgRating: ratingInfo.avgRating,
      ratingCount: ratingInfo.ratingCount,
      warnings,
    };
  });
}

/**
 * Returns KPI metrics scoped to a single course.
 *
 * @param courseId - The course to inspect.
 * @param days - Time range: 7, 30, or 90 days (applies to revenue, enrollments, active learners).
 * @param viewerId - The ID of the requesting user.
 * @param viewerRole - The role of the requesting user.
 *
 * Authorization: instructors may only query courses they own; admins may query any course.
 */
export function getCourseDetailMetrics(
  courseId: number,
  days: number,
  viewerId: number,
  viewerRole: UserRole
): CourseDetailMetrics {
  const course = assertCourseAccess(courseId, viewerId, viewerRole);
  const cutoff = getCutoffDate(days);

  // Gross revenue (time-scoped)
  const revenueRow = db
    .select({ total: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)` })
    .from(purchases)
    .where(and(eq(purchases.courseId, courseId), gte(purchases.createdAt, cutoff)))
    .get();
  const grossRevenue = revenueRow?.total ?? 0;

  // New enrollments (time-scoped)
  const enrollRow = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), gte(enrollments.enrolledAt, cutoff)))
    .get();
  const newEnrollments = enrollRow?.count ?? 0;

  // Active learners (time-scoped)
  const activeRow = db
    .select({ count: sql<number>`count(distinct ${lessonProgress.userId})` })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(modules.courseId, courseId),
        gte(lessonProgress.updatedAt, cutoff)
      )
    )
    .get();
  const activeLearners = activeRow?.count ?? 0;

  // Completion rate (not time-scoped)
  const completionRate = computeCompletionRate([courseId]);

  // Rating (not time-scoped)
  const ratingRow = db
    .select({
      avgRating: avg(courseRatings.rating),
      ratingCount: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();
  const avgRating =
    ratingRow?.avgRating !== null && ratingRow?.avgRating !== undefined
      ? Number(ratingRow.avgRating)
      : null;
  const ratingCount = ratingRow?.ratingCount ?? 0;

  // Total enrolled all-time (for lowEnrollments flag)
  const totalEnrollRow = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();
  const totalEnrolled = totalEnrollRow?.count ?? 0;

  const warnings: CourseWarnings = {
    lowEnrollments: totalEnrolled < WARNING_THRESHOLDS.LOW_ENROLLMENTS,
    lowCompletion: completionRate < WARNING_THRESHOLDS.LOW_COMPLETION_RATE,
    lowRating:
      avgRating !== null &&
      ratingCount >= WARNING_THRESHOLDS.MIN_RATINGS_FOR_LOW_RATING &&
      avgRating < WARNING_THRESHOLDS.LOW_RATING,
  };

  return {
    courseTitle: course.title,
    grossRevenue,
    newEnrollments,
    activeLearners,
    completionRate,
    avgRating,
    ratingCount,
    totalEnrolled,
    warnings,
  };
}

/**
 * Returns one row per enrolled learner for the given course, including
 * progress percentage, last activity date, and completion status.
 *
 * @param courseId - The course to inspect.
 * @param viewerId - The ID of the requesting user.
 * @param viewerRole - The role of the requesting user.
 *
 * Authorization: instructors may only query courses they own; admins may query any course.
 */
export function getStudentProgressRows(
  courseId: number,
  viewerId: number,
  viewerRole: UserRole
): StudentProgressRow[] {
  assertCourseAccess(courseId, viewerId, viewerRole);

  // Total lessons in course (denominator for progress %)
  const lessonCountRow = db
    .select({ total: sql<number>`count(${lessons.id})` })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .get();
  const totalLessons = lessonCountRow?.total ?? 0;

  // All enrolled students with user info
  const enrollmentRows = db
    .select({
      userId: enrollments.userId,
      enrolledAt: enrollments.enrolledAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(eq(enrollments.courseId, courseId))
    .all();

  if (enrollmentRows.length === 0) return [];

  const userIds = enrollmentRows.map((r) => r.userId);

  const progressRows = db
    .select({
      userId: lessonProgress.userId,
      completed: sql<number>`sum(case when ${lessonProgress.status} = ${LessonProgressStatus.Completed} then 1 else 0 end)`,
      lastActivityAt: sql<string | null>`max(${lessonProgress.updatedAt})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(modules.courseId, courseId),
        inArray(lessonProgress.userId, userIds)
      )
    )
    .groupBy(lessonProgress.userId)
    .all();

  const progressMap = new Map(
    progressRows.map((r) => [r.userId, { completed: r.completed, lastActivityAt: r.lastActivityAt }])
  );

  return enrollmentRows.map((e) => {
    const prog = progressMap.get(e.userId) ?? { completed: 0, lastActivityAt: null };
    const progressPercent =
      totalLessons === 0 ? 0 : Math.round((prog.completed / totalLessons) * 100);
    const isCompleted = totalLessons > 0 && prog.completed >= totalLessons;

    return {
      userId: e.userId,
      name: e.userName ?? "Unknown",
      email: e.userEmail ?? "",
      enrolledAt: e.enrolledAt,
      progressPercent,
      lastActivityAt: prog.lastActivityAt,
      isCompleted,
    };
  });
}
