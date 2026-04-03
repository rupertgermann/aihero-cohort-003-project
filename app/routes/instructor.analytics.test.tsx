import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseRow } from "~/services/analyticsService";
import { UserRole } from "~/db/schema";

const {
  mockGetCurrentUserId,
  mockGetUserById,
  mockGetUsersByRole,
  mockGetRollupMetrics,
  mockGetCourseRows,
} =
  vi.hoisted(() => ({
    mockGetCurrentUserId: vi.fn(),
    mockGetUserById: vi.fn(),
    mockGetUsersByRole: vi.fn(),
    mockGetRollupMetrics: vi.fn(),
    mockGetCourseRows: vi.fn(),
  }));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: mockGetCurrentUserId,
}));

vi.mock("~/services/userService", () => ({
  getUserById: mockGetUserById,
  getUsersByRole: mockGetUsersByRole,
}));

vi.mock("~/services/analyticsService", () => ({
  getRollupMetrics: mockGetRollupMetrics,
  getCourseRows: mockGetCourseRows,
}));

import { loader } from "./instructor.analytics";

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

function makeRollupMetrics() {
  return {
    grossRevenue: 1234,
    newEnrollments: 2,
    activeLearners: 1,
    completionRate: 50,
  };
}

function makeCourseRows(): CourseRow[] {
  return [
    {
      courseId: 11,
      courseTitle: "Course One",
      revenue: 1200,
      newEnrollments: 2,
      activeLearners: 1,
      completionRate: 50,
      avgRating: 4.5,
      ratingCount: 4,
      warnings: {
        lowEnrollments: false,
        lowCompletion: false,
        lowRating: false,
      },
    },
  ];
}

describe("instructor.analytics loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUsersByRole.mockReturnValue([]);
  });

  it("rejects unauthenticated users", async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(null);

    await expect(loader({ request: makeRequest("/instructor/analytics") } as never)).rejects.toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 401 },
      data: "Select a user from the DevUI panel to view analytics.",
    });
  });

  it("rejects non-instructor and non-admin users", async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(9);
    mockGetUserById.mockReturnValueOnce({ id: 9, role: UserRole.Student });

    await expect(loader({ request: makeRequest("/instructor/analytics") } as never)).rejects.toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 403 },
      data: "Only instructors and admins can access analytics.",
    });
  });

  it("lets instructors load their own analytics and ignores admin-only instructor filters", async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(7);
    mockGetUserById.mockReturnValueOnce({ id: 7, role: UserRole.Instructor });
    mockGetRollupMetrics.mockReturnValueOnce(makeRollupMetrics());
    mockGetCourseRows.mockReturnValueOnce(makeCourseRows());

    const result = await loader({
      request: makeRequest("/instructor/analytics?days=90&instructorId=999"),
    } as never);

    expect(mockGetRollupMetrics).toHaveBeenCalledWith(7, 90, 7, UserRole.Instructor);
    expect(mockGetCourseRows).toHaveBeenCalledWith(7, 90, 7, UserRole.Instructor);
    expect(result).toMatchObject({
      days: 90,
      userRole: UserRole.Instructor,
      metrics: makeRollupMetrics(),
      courseRows: makeCourseRows(),
    });
  });

  it("applies an admin instructor filter when one is provided", async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(1);
    mockGetUserById.mockImplementation((id: number) => {
      if (id === 1) return { id: 1, role: UserRole.Admin };
      if (id === 42) return { id: 42, role: UserRole.Instructor };
      return null;
    });
    mockGetUsersByRole.mockReturnValueOnce([{ id: 42, role: UserRole.Instructor }]);
    mockGetRollupMetrics.mockReturnValueOnce(makeRollupMetrics());
    mockGetCourseRows.mockReturnValueOnce(makeCourseRows());

    const result = await loader({
      request: makeRequest("/instructor/analytics?days=30&instructorId=42"),
    } as never);

    expect(mockGetRollupMetrics).toHaveBeenCalledWith(42, 30, 1, UserRole.Admin);
    expect(mockGetCourseRows).toHaveBeenCalledWith(42, 30, 1, UserRole.Admin);
    expect(result).toMatchObject({
      selectedInstructorId: 42,
    });
  });
});
