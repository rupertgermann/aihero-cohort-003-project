import { UserRole } from "~/db/schema";
import { getUserById } from "~/services/userService";

export function parseAdminInstructorId(
  url: URL,
  viewerRole: UserRole
): number | null {
  if (viewerRole !== UserRole.Admin) return null;

  const instructorIdParam = url.searchParams.get("instructorId");
  if (!instructorIdParam) return null;

  const instructorId = Number(instructorIdParam);
  if (!Number.isInteger(instructorId) || instructorId <= 0) {
    return null;
  }

  const user = getUserById(instructorId);
  if (!user || user.role !== UserRole.Instructor) {
    return null;
  }

  return instructorId;
}
