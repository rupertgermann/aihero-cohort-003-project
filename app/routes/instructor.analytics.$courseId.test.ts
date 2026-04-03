import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "~/db/schema";

const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  getUserById: vi.fn(),
  getCourseDetailMetrics: vi.fn(),
  getStudentProgressRows: vi.fn(),
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
}));

vi.mock("~/services/userService", () => ({
  getUserById: mocks.getUserById,
}));

vi.mock("~/services/analyticsService", () => ({
  getCourseDetailMetrics: mocks.getCourseDetailMetrics,
  getStudentProgressRows: mocks.getStudentProgressRows,
}));

import { loader } from "./instructor.analytics.$courseId";

function makeArgs(url: string, courseId = "42") {
  return {
    request: new Request(url),
    params: { courseId },
    context: {},
  } as Parameters<typeof loader>[0];
}

function makeMetrics() {
  return {
    courseTitle: "Course Analytics",
    grossRevenue: 12345,
    newEnrollments: 7,
    activeLearners: 5,
    completionRate: 80,
    avgRating: 4.2,
    ratingCount: 4,
    totalEnrolled: 9,
    warnings: {
      lowEnrollments: false,
      lowCompletion: false,
      lowRating: false,
    },
  };
}

function makeStudents() {
  return [
    {
      userId: 10,
      name: "Ada Student",
      email: "ada@example.com",
      enrolledAt: "2026-03-01T12:00:00.000Z",
      progressPercent: 100,
      lastActivityAt: "2026-03-10T12:00:00.000Z",
      isCompleted: true,
    },
  ];
}

describe("instructor analytics course detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCourseDetailMetrics.mockReturnValue(makeMetrics());
    mocks.getStudentProgressRows.mockReturnValue(makeStudents());
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getCurrentUserId.mockResolvedValue(null);

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics/42"))
    ).rejects.toMatchObject({
      init: { status: 401 },
      data: "Select a user from the DevUI panel to view analytics.",
    });
  });

  it("rejects non-instructor and non-admin users", async () => {
    mocks.getCurrentUserId.mockResolvedValue(8);
    mocks.getUserById.mockReturnValue({ id: 8, role: UserRole.Student });

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics/42"))
    ).rejects.toMatchObject({
      init: { status: 403 },
      data: "Only instructors and admins can access analytics.",
    });
  });

  it("rejects invalid course ids", async () => {
    mocks.getCurrentUserId.mockResolvedValue(7);
    mocks.getUserById.mockReturnValue({ id: 7, role: UserRole.Instructor });

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics/not-a-number", "not-a-number"))
    ).rejects.toMatchObject({
      init: { status: 400 },
      data: "Invalid course ID.",
    });
  });

  it("loads instructor-owned course analytics with the selected time range", async () => {
    mocks.getCurrentUserId.mockResolvedValue(7);
    mocks.getUserById.mockReturnValue({ id: 7, role: UserRole.Instructor });

    const result = await loader(
      makeArgs("http://localhost/instructor/analytics/42?days=90")
    );

    expect(mocks.getCourseDetailMetrics).toHaveBeenCalledWith(
      42,
      90,
      7,
      UserRole.Instructor
    );
    expect(mocks.getStudentProgressRows).toHaveBeenCalledWith(
      42,
      7,
      UserRole.Instructor
    );
    expect(result).toMatchObject({
      courseId: 42,
      days: 90,
      metrics: makeMetrics(),
      students: makeStudents(),
    });
  });

  it("allows admins and falls back to 30 days for unsupported ranges", async () => {
    mocks.getCurrentUserId.mockResolvedValue(1);
    mocks.getUserById.mockReturnValue({ id: 1, role: UserRole.Admin });

    const result = await loader(
      makeArgs("http://localhost/instructor/analytics/42?days=999")
    );

    expect(mocks.getCourseDetailMetrics).toHaveBeenCalledWith(
      42,
      30,
      1,
      UserRole.Admin
    );
    expect(mocks.getStudentProgressRows).toHaveBeenCalledWith(
      42,
      1,
      UserRole.Admin
    );
    expect(result.days).toBe(30);
  });

  it("maps forbidden course access to a 403 response", async () => {
    mocks.getCurrentUserId.mockResolvedValue(7);
    mocks.getUserById.mockReturnValue({ id: 7, role: UserRole.Instructor });
    mocks.getCourseDetailMetrics.mockImplementation(() => {
      throw new Error("Forbidden: you do not own this course");
    });

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics/42"))
    ).rejects.toMatchObject({
      init: { status: 403 },
      data: "You can only view analytics for your own courses.",
    });
  });

  it("maps missing courses to a 404 response", async () => {
    mocks.getCurrentUserId.mockResolvedValue(1);
    mocks.getUserById.mockReturnValue({ id: 1, role: UserRole.Admin });
    mocks.getCourseDetailMetrics.mockImplementation(() => {
      throw new Error("Course not found");
    });

    await expect(
      loader(makeArgs("http://localhost/instructor/analytics/404"))
    ).rejects.toMatchObject({
      init: { status: 404 },
      data: "Course not found.",
    });
  });
});
