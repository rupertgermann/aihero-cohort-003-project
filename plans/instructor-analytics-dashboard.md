# Plan: Instructor Analytics Dashboard

> Source PRD: docs/instructor-analytics-dashboard-prd.md

## Architectural decisions

- **Routes**:
  - `/instructor/analytics` — cross-course rollup view (instructor sees own courses; admin sees all with optional instructor filter)
  - `/instructor/analytics/:courseId` — course-specific analytics detail view
- **Schema**: No new tables required in v1. All metrics are derived from existing tables: `purchases`, `enrollments`, `lessonProgress`, `courseRatings`, `users`, `courses`.
- **Key models**: `analyticsService` — a dedicated aggregation module in `/app/services/` that encapsulates all metric definitions, authorization scoping, date-range filtering, and warning-flag logic. Routes call this service; they do not assemble metrics inline.
- **Authorization**: Instructors may only query courses they own (`courses.instructorId = currentUserId`). Admins may query any course and filter by any instructor. Authorization is enforced inside the analytics service, not only at the route layer.
- **Time ranges**: Preset values of 7, 30, and 90 days only (v1). Passed as a query param (`?days=7|30|90`, default 30). Trend metrics (revenue, new enrollments, active learners) are scoped to the range. Outcome metrics (completion rate) include all enrolled learners regardless of enrollment date.
- **Warning flag thresholds**: Fixed constants in the analytics service. v1 defaults: enrollments < 5, completion rate < 20%, average rating < 3.5.
- **CSV export**: Admin-only. Produced server-side from the same aggregation logic as the dashboard. Returned as a streaming/downloaded file from a dedicated action or loader route.
- **Test style**: Service-level tests using an in-memory SQLite test DB (`createTestDb()` + `seedBaseData()`), following the pattern established in `progressService.test.ts` and `ratingService.test.ts`.

---

## Phase 1: Analytics Service + Rollup KPI Cards

**User stories**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 27, 29, 30

### What to build

Create the `analyticsService` aggregation module as the single source of truth for all metric definitions. Expose a `getRollupMetrics(instructorId, days, viewerRole)` function that returns aggregate KPIs across all courses owned by the instructor: gross revenue, new enrollments, active learners, and completion rate for the selected time range.

Add the `/instructor/analytics` route. The loader performs auth (instructor or admin), reads the `?days` query param, calls the analytics service, and returns the KPI payload. The page renders four KPI cards and a time-range selector (7 / 30 / 90 days). Changing the filter updates the URL and re-runs the loader.

Write service-level tests covering each metric definition, the effect of the time-range filter on trend metrics, and the pass-through of all enrolled learners into completion-rate calculation.

### Acceptance criteria

- [ ] Instructor navigating to `/instructor/analytics` sees a page scoped to their own courses.
- [ ] Admin navigating to `/instructor/analytics` sees rollup across all courses (no instructor filter yet — that is Phase 4).
- [ ] A student or unauthenticated user receives a 403/redirect.
- [ ] KPI cards display: Gross Revenue, New Enrollments, Active Learners, Completion Rate.
- [ ] Time-range selector shows 7 / 30 / 90 day options; selecting one updates all KPI values.
- [ ] Gross revenue counts only purchases within the selected date range.
- [ ] New enrollments counts only enrollments created within the selected date range.
- [ ] Active learners counts learners who recorded any `lessonProgress` update within the range.
- [ ] Completion rate = learners with 100% lesson completion / all enrolled learners (not date-scoped).
- [ ] Analytics service tests pass for all four metric definitions across all three date ranges.

---

## Phase 2: Cross-Course Comparison Table + Warning Flags

**User stories**: 10, 11, 12, 13, 19, 21, 28

### What to build

Extend `analyticsService` with a `getCourseRows(instructorId, days, viewerRole)` function that returns one row per owned course containing: course title, revenue, new enrollments, active learners, completion rate, average rating + count, and a set of boolean warning flags.

Warning flags use fixed thresholds: `lowEnrollments` (total enrolled < 5), `lowCompletion` (completion rate < 20%), `lowRating` (average rating < 3.5 with at least 3 ratings). A course with no ratings does not trigger `lowRating`.

Add the course comparison table below the KPI cards on `/instructor/analytics`. Each row links to the course-specific detail view (Phase 3). Warning flags render as inline badges or icons on the row. The same time-range filter already in the URL drives the per-course trend columns.

Write service-level tests for each warning flag threshold (at boundary, below, and above), and for the absence of `lowRating` when rating count is too low.

### Acceptance criteria

- [ ] The rollup page shows a table with one row per course owned by the instructor (or all courses for admin).
- [ ] Each row includes: Course Title, Revenue, New Enrollments, Active Learners, Completion Rate, Avg Rating (with count), Warning Flags.
- [ ] Time-range filter applies to Revenue, New Enrollments, and Active Learners columns; Completion Rate and Rating are not date-scoped.
- [ ] A course with total enrollments < 5 shows a `Low Enrollments` warning flag.
- [ ] A course with completion rate < 20% shows a `Low Completion` warning flag.
- [ ] A course with avg rating < 3.5 AND at least 3 ratings shows a `Low Rating` warning flag.
- [ ] A course with fewer than 3 ratings does not show a `Low Rating` flag.
- [ ] Multiple flags can appear on the same row simultaneously.
- [ ] Warning flag threshold tests pass for all three flag types.

---

## Phase 3: Course-Specific Analytics Detail View

**User stories**: 14, 15, 16, 17, 18

### What to build

Add the `/instructor/analytics/:courseId` route. The loader validates that the viewer owns the course (or is admin), then calls `analyticsService` for single-course metrics: the same KPI set as the rollup (revenue, new enrollments, active learners, completion rate, rating summary) but scoped to one course.

The page renders a course-health header with KPI cards, the same time-range selector, and a student-level detail table listing each enrolled learner with their progress percentage, last activity date, and completion status. Two action links sit prominently on the page: "Edit Course" (→ `/instructor/:courseId`) and "Student Roster" (→ `/instructor/:courseId/students`).

Extend analytics service tests to cover single-course metric isolation (metrics for course A are unaffected by data from course B).

### Acceptance criteria

- [ ] Clicking a course row on the rollup page navigates to `/instructor/analytics/:courseId`.
- [ ] Instructor can only reach the detail view for courses they own; admin can reach any course.
- [ ] Page shows KPI cards identical in definition to the rollup cards, scoped to the single course.
- [ ] Time-range selector works the same way as on the rollup page.
- [ ] A student detail table shows enrolled learners with progress %, last activity date, and completion status.
- [ ] "Edit Course" link navigates to `/instructor/:courseId`.
- [ ] "Student Roster" link navigates to `/instructor/:courseId/students`.
- [ ] Service tests confirm single-course metrics are isolated from other courses' data.

---

## Phase 4: Admin Extensions + CSV Export

**User stories**: 22, 23, 24, 25, 26

### What to build

Extend the `/instructor/analytics` rollup route to accept an optional `?instructorId` query param visible only to admins. When set, the rollup and course table are filtered to that instructor's catalog. Add an instructor dropdown to the rollup page UI that is rendered only for admins.

Add a CSV export endpoint (e.g. a loader action on `/instructor/analytics/export` or a resource route) that is gated to admin only. The export assembles the same per-course rows as the comparison table for the selected instructor and date range, serialises them as CSV, and returns the file for download. A download button appears in the admin UI only.

Write tests for: admin instructor-filter scoping, non-admin access to the export endpoint returning 403, and CSV output containing the expected columns and row count.

### Acceptance criteria

- [ ] An admin visiting `/instructor/analytics` sees a dropdown to filter by instructor.
- [ ] Selecting an instructor updates the KPI cards and course table to reflect only that instructor's courses.
- [ ] An instructor does not see the instructor filter dropdown.
- [ ] Admin can navigate to any course's detail view regardless of course owner.
- [ ] A "Download CSV" button is visible to admins only on the rollup page.
- [ ] Clicking "Download CSV" triggers a file download with columns matching the course comparison table.
- [ ] The CSV respects the currently selected instructor filter and time range.
- [ ] A non-admin request to the export endpoint returns 403.
- [ ] Service and route tests cover admin scoping, export access control, and CSV column correctness.
