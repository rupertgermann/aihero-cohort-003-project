import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "~/db/schema";

const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  getUserById: vi.fn(),
  getUsersByRole: vi.fn(),
  getRollupMetrics: vi.fn(),
  getCourseRows: vi.fn(),
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
}));

vi.mock("~/services/userService", () => ({
  getUserById: mocks.getUserById,
  getUsersByRole: mocks.getUsersByRole,
}));

vi.mock("~/services/analyticsService", () => ({
  getRollupMetrics: mocks.getRollupMetrics,
  getCourseRows: mocks.getCourseRows,
}));

import { loader } from "./instructor.analytics";

function makeArgs(url: string) {
  return {
    request: new Request(url),
    params: {},
    context: {},
  } as Parameters<typeof loader>[0];
}

describe("instructor analytics rollup loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRollupMetrics.mockReturnValue({
      grossRevenue: 0,
      newEnrollments: 0,
      activeLearners: 0,
      completionRate: 0,
    });
    mocks.getCourseRows.mockReturnValue([]);
    mocks.getUsersByRole.mockReturnValue([]);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getCurrentUserId.mockResolvedValue(null);

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics"))
    ).rejects.toMatchObject({ init: { status: 401 } });
  });

  it("rejects non-instructor and non-admin users", async () => {
    mocks.getCurrentUserId.mockResolvedValue(5);
    mocks.getUserById.mockReturnValue({
      id: 5,
      name: "Student",
      email: "student@example.com",
      role: UserRole.Student,
    });

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics"))
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("forces instructors to their own analytics even when instructorId is present", async () => {
    mocks.getCurrentUserId.mockResolvedValue(10);
    mocks.getUserById.mockImplementation((id: number) => {
      if (id === 10) {
        return {
          id: 10,
          name: "Instructor One",
          email: "instructor@example.com",
          role: UserRole.Instructor,
        };
      }

      return null;
    });

    const result = await loader(
      makeArgs("http://localhost/instructor/analytics?days=90&instructorId=77")
    );

    expect(mocks.getRollupMetrics).toHaveBeenCalledWith(
      10,
      90,
      10,
      UserRole.Instructor
    );
    expect(mocks.getCourseRows).toHaveBeenCalledWith(
      10,
      90,
      10,
      UserRole.Instructor
    );
    expect(mocks.getUsersByRole).not.toHaveBeenCalled();
    expect(result.selectedInstructorId).toBeNull();
  });

  it("allows admins to filter analytics to a specific instructor", async () => {
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
    mocks.getUsersByRole.mockReturnValue([
      {
        id: 22,
        name: "Ada Instructor",
        email: "ada@example.com",
        role: UserRole.Instructor,
      },
    ]);

    const result = await loader(
      makeArgs("http://localhost/instructor/analytics?days=7&instructorId=22")
    );

    expect(mocks.getRollupMetrics).toHaveBeenCalledWith(22, 7, 1, UserRole.Admin);
    expect(mocks.getCourseRows).toHaveBeenCalledWith(22, 7, 1, UserRole.Admin);
    expect(mocks.getUsersByRole).toHaveBeenCalledWith(UserRole.Instructor);
    expect(result.selectedInstructorId).toBe(22);
    expect(result.instructors).toHaveLength(1);
  });
});
