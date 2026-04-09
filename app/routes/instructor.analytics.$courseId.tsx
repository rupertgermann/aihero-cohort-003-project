import { Link, useLocation } from "react-router";
import type { Route } from "./+types/instructor.analytics.$courseId";
import { data, isRouteErrorResponse } from "react-router";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import {
  getCourseDetailMetrics,
  getStudentProgressRows,
} from "~/services/analyticsService";
import type { StudentProgressRow } from "~/services/analyticsService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";
import {
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Users,
  CheckCircle,
  ArrowLeft,
  BookOpen,
  GraduationCap,
} from "lucide-react";
import {
  parseAnalyticsDays,
  VALID_ANALYTICS_DAYS,
} from "./instructor.analytics.shared";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.metrics?.courseTitle ?? "Course Analytics";
  return [
    { title: `${title} — Analytics — Cadence` },
    { name: "description", content: `Analytics for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view analytics.", { status: 401 });
  }

  const user = getUserById(currentUserId);
  if (!user || (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)) {
    throw data("Only instructors and admins can access analytics.", { status: 403 });
  }

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const url = new URL(request.url);
  const days = parseAnalyticsDays(url);

  let metrics;
  let students;
  try {
    metrics = getCourseDetailMetrics(courseId, days, currentUserId, user.role);
    students = getStudentProgressRows(courseId, currentUserId, user.role);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Forbidden")) {
      throw data("You can only view analytics for your own courses.", { status: 403 });
    }
    if (message === "Course not found") {
      throw data("Course not found.", { status: 404 });
    }
    throw data("Failed to load analytics.", { status: 500 });
  }

  return { metrics, students, days, courseId };
}

export default function CourseAnalyticsDetail({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const { metrics, students, days, courseId } = loaderData;
  const analyticsIndexSearch = location.search || "?days=30";

  function buildDetailSearch(nextDays: number) {
    const params = new URLSearchParams(location.search);
    params.set("days", String(nextDays));
    return `?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">Home</Link>
        <span className="mx-2">/</span>
        <Link to="/instructor" className="hover:text-foreground">My Courses</Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/analytics${analyticsIndexSearch}`} className="hover:text-foreground">
          Analytics
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{metrics.courseTitle}</span>
      </nav>

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to={`/instructor/analytics${analyticsIndexSearch}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All Courses
          </Link>
          <h1 className="text-3xl font-bold">{metrics.courseTitle}</h1>
          <p className="mt-1 text-muted-foreground">Course analytics</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Action Links */}
          <Link
            to={`/instructor/${courseId}`}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <BookOpen className="size-4" />
            Edit Course
          </Link>
          <Link
            to={`/instructor/${courseId}/students`}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <GraduationCap className="size-4" />
            Student Roster
          </Link>

          {/* Time Range Selector */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
            {VALID_ANALYTICS_DAYS.map((d) => (
              <Link
                key={d}
                to={buildDetailSearch(d)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  days === d
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {d}d
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Warning Flags */}
      {(metrics.warnings.lowEnrollments ||
        metrics.warnings.lowCompletion ||
        metrics.warnings.lowRating) && (
        <div className="mb-6 flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="flex flex-wrap gap-2">
            {metrics.warnings.lowEnrollments && (
              <WarningBadge label="Low Enrollments" />
            )}
            {metrics.warnings.lowCompletion && (
              <WarningBadge label="Low Completion" />
            )}
            {metrics.warnings.lowRating && (
              <WarningBadge label="Low Rating" />
            )}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Gross Revenue"
          value={formatPrice(metrics.grossRevenue)}
          description={`Last ${days} days`}
          icon={<DollarSign className="size-5 text-muted-foreground" />}
        />
        <KpiCard
          title="New Enrollments"
          value={metrics.newEnrollments.toLocaleString()}
          description={`Last ${days} days`}
          icon={<TrendingUp className="size-5 text-muted-foreground" />}
        />
        <KpiCard
          title="Active Learners"
          value={metrics.activeLearners.toLocaleString()}
          description={`Last ${days} days`}
          icon={<Users className="size-5 text-muted-foreground" />}
        />
        <KpiCard
          title="Completion Rate"
          value={`${metrics.completionRate}%`}
          description={`${metrics.totalEnrolled} total enrolled`}
          icon={<CheckCircle className="size-5 text-muted-foreground" />}
        />
      </div>

      {/* Rating Summary */}
      {metrics.avgRating !== null && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border p-4">
          <span className="text-2xl font-bold tabular-nums">
            {metrics.avgRating.toFixed(1)}
          </span>
          <div>
            <p className="text-sm font-medium">Average Rating</p>
            <p className="text-xs text-muted-foreground">
              Based on {metrics.ratingCount} {metrics.ratingCount === 1 ? "review" : "reviews"}
            </p>
          </div>
        </div>
      )}

      {/* Metric Definitions */}
      <div className="mt-8 rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
        <p className="font-medium mb-1">Metric definitions</p>
        <ul className="space-y-0.5">
          <li><strong>Gross Revenue</strong> — Sum of all purchases in the selected period.</li>
          <li><strong>New Enrollments</strong> — Learners who enrolled in the selected period.</li>
          <li><strong>Active Learners</strong> — Distinct learners who made any lesson progress in the selected period.</li>
          <li><strong>Completion Rate</strong> — Learners who have completed all lessons ÷ all enrolled learners (not date-scoped).</li>
        </ul>
      </div>

      {/* Student Detail Table */}
      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">
          Enrolled Learners
          <span className="ml-2 text-base font-normal text-muted-foreground">
            ({students.length})
          </span>
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Enrolled</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Last Activity</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No enrolled learners yet.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <StudentRow key={student.userId} student={student} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StudentRow({ student }: { student: StudentProgressRow }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div>
          <p className="font-medium">{student.name}</p>
          <p className="text-xs text-muted-foreground">{student.email}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatDate(student.enrolledAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${student.progressPercent}%` }}
            />
          </div>
          <span className="tabular-nums text-xs">{student.progressPercent}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {student.lastActivityAt ? formatDate(student.lastActivityAt) : "—"}
      </td>
      <td className="px-4 py-3">
        <StatusBadge isCompleted={student.isCompleted} progressPercent={student.progressPercent} />
      </td>
    </tr>
  );
}

function StatusBadge({
  isCompleted,
  progressPercent,
}: {
  isCompleted: boolean;
  progressPercent: number;
}) {
  if (isCompleted) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        Completed
      </span>
    );
  }
  if (progressPercent > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Not Started
    </span>
  );
}

function KpiCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function WarningBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access analytics for this course.";
    } else if (error.status === 404) {
      title = "Course not found";
      message =
        typeof error.data === "string" ? error.data : "The requested course does not exist.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/instructor/analytics">
            <span className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Back to Analytics
            </span>
          </Link>
          <Link to="/instructor">
            <span className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              My Courses
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
