import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "~/db/schema";

const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  getUserById: vi.fn(),
  getCourseRows: vi.fn(),
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
}));

vi.mock("~/services/userService", () => ({
  getUserById: mocks.getUserById,
}));

vi.mock("~/services/analyticsService", () => ({
  getCourseRows: mocks.getCourseRows,
}));

import { loader } from "./instructor.analytics.export";

function makeArgs(url: string) {
  return {
    request: new Request(url),
    params: {},
    context: {},
  } as Parameters<typeof loader>[0];
}

describe("instructor analytics export loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCourseRows.mockReturnValue([]);
  });

  it("rejects non-admin users", async () => {
    mocks.getCurrentUserId.mockResolvedValue(10);
    mocks.getUserById.mockReturnValue({
      id: 10,
      name: "Instructor",
      email: "instructor@example.com",
      role: UserRole.Instructor,
    });

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics/export"))
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("returns an admin-only CSV export scoped by time range and instructor", async () => {
    mocks.getCurrentUserId.mockResolvedValue(1);
    mocks.getUserById.mockImplementation((id: number) => {
      if (id === 1) {
        return {
          id: 1,
          name: "Admin",
          email: "admin@example.com",
          role: UserRole.Admin,
        };
      }

      if (id === 22) {
        return {
          id: 22,
          name: "Ada Instructor",
          email: "ada@example.com",
          role: UserRole.Instructor,
        };
      }

      return null;
    });
    mocks.getCourseRows.mockReturnValue([
      {
        courseId: 101,
        courseTitle: "Course Alpha",
        revenue: 12345,
        newEnrollments: 7,
        activeLearners: 5,
        completionRate: 80,
        avgRating: 4.25,
        ratingCount: 4,
        warnings: {
          lowEnrollments: false,
          lowCompletion: false,
          lowRating: true,
        },
      },
      {
        courseId: 202,
        courseTitle: "Course Beta",
        revenue: 0,
        newEnrollments: 0,
        activeLearners: 0,
        completionRate: 0,
        avgRating: null,
        ratingCount: 0,
        warnings: {
          lowEnrollments: true,
          lowCompletion: true,
          lowRating: false,
        },
      },
    ]);

    const response = await loader(
      makeArgs("http://localhost/instructor/analytics/export?days=7&instructorId=22")
    );

    expect(mocks.getCourseRows).toHaveBeenCalledWith(22, 7, 1, UserRole.Admin);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain(
      'analytics-instructor-22-7d.csv'
    );

    const csv = await response.text();
    const rows = csv.trim().split(/\r?\n/);

    expect(rows[0]).toBe(
      "Course Title,Revenue,New Enrollments,Active Learners,Completion Rate,Rating,Warning Flags"
    );
    expect(rows).toHaveLength(3);
    expect(csv).toContain("Course Alpha");
    expect(csv).toContain("$123.45");
    expect(csv).toContain("4.3 (4)");
    expect(csv).toContain("Low Completion");
  });
});
