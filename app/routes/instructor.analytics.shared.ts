import { formatPrice } from "~/lib/utils";
import type { CourseRow, CourseWarnings } from "~/services/analyticsService";

export const VALID_ANALYTICS_DAYS = [7, 30, 90] as const;
export type AnalyticsDays = (typeof VALID_ANALYTICS_DAYS)[number];

export const ALL_INSTRUCTORS_VALUE = "all";

export function parseAnalyticsDays(url: URL): AnalyticsDays {
  const daysParam = Number(url.searchParams.get("days") ?? "30");
  return (VALID_ANALYTICS_DAYS as readonly number[]).includes(daysParam)
    ? (daysParam as AnalyticsDays)
    : 30;
}

export function buildAnalyticsSearch(
  days: AnalyticsDays,
  instructorId: number | null
): string {
  const params = new URLSearchParams({ days: String(days) });

  if (instructorId !== null) {
    params.set("instructorId", String(instructorId));
  }

  return `?${params.toString()}`;
}

export function formatCourseWarnings(warnings: CourseWarnings): string {
  const labels: string[] = [];

  if (warnings.lowEnrollments) labels.push("Low Enrollments");
  if (warnings.lowCompletion) labels.push("Low Completion");
  if (warnings.lowRating) labels.push("Low Rating");

  return labels.join("; ");
}

export function formatCourseRating(row: CourseRow): string {
  if (row.avgRating === null) return "";
  return `${row.avgRating.toFixed(1)} (${row.ratingCount})`;
}

export function serializeCourseRowsToCsv(courseRows: CourseRow[]): string {
  const headers = [
    "Course Title",
    "Revenue",
    "New Enrollments",
    "Active Learners",
    "Completion Rate",
    "Rating",
    "Warning Flags",
  ];

  const rows = courseRows.map((row) => [
    row.courseTitle,
    formatPrice(row.revenue),
    String(row.newEnrollments),
    String(row.activeLearners),
    `${row.completionRate}%`,
    formatCourseRating(row),
    formatCourseWarnings(row.warnings),
  ]);

  return [headers, ...rows]
    .map((cells) => cells.map(escapeCsvCell).join(","))
    .join("\r\n");
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}
