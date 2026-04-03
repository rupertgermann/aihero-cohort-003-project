import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { data, isRouteErrorResponse } from "react-router";
import { getCurrentUserId } from "~/lib/session";
import { getUserById, getUsersByRole } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { getRollupMetrics, getCourseRows } from "~/services/analyticsService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  AlertTriangle,
  Download,
  DollarSign,
  TrendingUp,
  Users,
  CheckCircle,
} from "lucide-react";
import {
  ALL_INSTRUCTORS_VALUE,
  buildAnalyticsSearch,
  parseAnalyticsDays,
  VALID_ANALYTICS_DAYS,
} from "./instructor.analytics.shared";
import { parseAdminInstructorId } from "./instructor.analytics.server";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Instructor analytics dashboard" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view analytics.", { status: 401 });
  }

  const user = getUserById(currentUserId);
  if (!user || (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)) {
    throw data("Only instructors and admins can access analytics.", { status: 403 });
  }

  const url = new URL(request.url);
  const days = parseAnalyticsDays(url);
  const adminInstructorId = parseAdminInstructorId(url, user.role);

  const instructorId =
    user.role === UserRole.Instructor ? currentUserId : adminInstructorId;

  const metrics = getRollupMetrics(instructorId, days, currentUserId, user.role);
  const courseRows = getCourseRows(instructorId, days, currentUserId, user.role);
  const instructors =
    user.role === UserRole.Admin
      ? getUsersByRole(UserRole.Instructor).sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return {
    metrics,
    days,
    userRole: user.role,
    courseRows,
    instructors,
    selectedInstructorId: adminInstructorId,
  };
}

export default function InstructorAnalytics({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const {
    metrics,
    days,
    userRole,
    courseRows,
    instructors,
    selectedInstructorId,
  } = loaderData;
  const selectedInstructor = instructors.find((instructor) => instructor.id === selectedInstructorId);
  const currentSearch = buildAnalyticsSearch(days, selectedInstructorId);

  function handleInstructorChange(value: string) {
    navigate(
      buildAnalyticsSearch(
        days,
        value === ALL_INSTRUCTORS_VALUE ? null : Number(value)
      )
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">Home</Link>
        <span className="mx-2">/</span>
        <Link to="/instructor" className="hover:text-foreground">My Courses</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            {userRole === UserRole.Admin
              ? selectedInstructor
                ? `Performance across ${selectedInstructor.name}'s course catalog`
                : "Platform-wide performance across all instructors"
              : "Performance across your courses"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {userRole === UserRole.Admin && (
            <>
              <Select
                value={
                  selectedInstructorId === null
                    ? ALL_INSTRUCTORS_VALUE
                    : String(selectedInstructorId)
                }
                onValueChange={handleInstructorChange}
              >
                <SelectTrigger className="w-[240px] bg-background">
                  <SelectValue placeholder="Filter by instructor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_INSTRUCTORS_VALUE}>All instructors</SelectItem>
                  {instructors.map((instructor) => (
                    <SelectItem key={instructor.id} value={String(instructor.id)}>
                      {instructor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button asChild variant="outline" size="sm">
                <Link reloadDocument to={`/instructor/analytics/export${currentSearch}`}>
                  <Download className="size-4" />
                  Download CSV
                </Link>
              </Button>
            </>
          )}

          {/* Time Range Selector */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
            {VALID_ANALYTICS_DAYS.map((d) => (
              <Link
                key={d}
                to={buildAnalyticsSearch(d, selectedInstructorId)}
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
          description="All enrolled learners"
          icon={<CheckCircle className="size-5 text-muted-foreground" />}
        />
      </div>

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

      {/* Course Comparison */}
      <div className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Course Comparison</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <caption className="mb-2 px-4 pt-3 text-left text-xs text-muted-foreground">
              Revenue, New Enrollments, and Active Learners are scoped to the selected {days}-day period.
              Completion Rate and Rating reflect all-time data.
            </caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3">Course</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">New Enrollments</th>
                <th className="px-4 py-3 text-right">Active Learners</th>
                <th className="px-4 py-3 text-right">Completion Rate</th>
                <th className="px-4 py-3 text-right">Rating</th>
                <th className="px-4 py-3">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {courseRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No courses found.
                  </td>
                </tr>
              ) : (
                courseRows.map((row) => (
                  <tr key={row.courseId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to={{
                          pathname: `/instructor/analytics/${row.courseId}`,
                          search: currentSearch,
                        }}
                        className="text-foreground hover:underline"
                      >
                        {row.courseTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPrice(row.revenue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.newEnrollments.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.activeLearners.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.completionRate}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.avgRating != null
                        ? `${row.avgRating} (${row.ratingCount})`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.warnings.lowEnrollments && (
                          <WarningBadge label="Low Enrollments" />
                        )}
                        {row.warnings.lowCompletion && (
                          <WarningBadge label="Low Completion" />
                        )}
                        {row.warnings.lowRating && (
                          <WarningBadge label="Low Rating" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "You don't have permission to access analytics.";
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
          <Link to="/instructor">
            <span className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              My Courses
            </span>
          </Link>
          <Link to="/">
            <span className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Go Home
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
