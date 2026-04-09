import type { Route } from "./+types/instructor.analytics.export";
import { data } from "react-router";
import { UserRole } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { getCourseRows } from "~/services/analyticsService";
import { getUserById } from "~/services/userService";
import {
  parseAnalyticsDays,
  serializeCourseRowsToCsv,
} from "./instructor.analytics.shared";
import { parseAdminInstructorId } from "./instructor.analytics.server";

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to export analytics.", { status: 401 });
  }

  const user = getUserById(currentUserId);
  if (!user || user.role !== UserRole.Admin) {
    throw data("Only admins can export analytics.", { status: 403 });
  }

  const url = new URL(request.url);
  const days = parseAnalyticsDays(url);
  const instructorId = parseAdminInstructorId(url, user.role);

  const courseRows = getCourseRows(instructorId, days, currentUserId, user.role);
  const csv = serializeCourseRowsToCsv(courseRows);

  return new Response(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${buildFileName(
        days,
        instructorId
      )}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

function buildFileName(days: number, instructorId: number | null): string {
  const scope = instructorId === null ? "all-instructors" : `instructor-${instructorId}`;
  return `analytics-${scope}-${days}d.csv`;
}
