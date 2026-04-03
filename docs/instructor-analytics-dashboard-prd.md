## Problem Statement

Instructors can already manage course content and inspect some learner data in a few separate places, but they do not have a dedicated analytics surface that helps them understand which courses are performing well, which ones are underperforming, and what action to take next. The current experience makes it harder to quickly answer practical questions like which course is earning the most, which courses are attracting new learners, whether learners are actually finishing courses, and which courses may need attention because quality or outcomes are slipping.

The core problem for this PRD is to help instructors improve course quality while still giving them enough revenue and enrollment visibility to prioritize where to focus. Admins also need access to the same analytics patterns across instructors and courses.

## Solution

Provide a new top-level instructor analytics dashboard that gives instructors a rollup view across all of their owned courses and lets them click into a course-specific analytics view for deeper inspection. The dashboard should prioritize a concise set of KPI cards and drill-down tables rather than a large reporting interface.

From the instructor's perspective, the dashboard should make it easy to see gross revenue, new enrollments, active learners, completion outcomes, ratings summaries, and warning flags for underperforming courses. It should support preset time filters for the last 7, 30, and 90 days. Instructors should be able to move directly from analytics into operational pages such as the course editor and student roster. Admins should be able to see the same analytics experience, with an added ability to filter by instructor and export CSV data.

## User Stories

1. As an instructor, I want a top-level analytics dashboard for all my courses, so that I can understand overall performance without opening each course separately.
2. As an instructor, I want the dashboard to default to a clear rollup across my courses, so that I can quickly identify where to focus.
3. As an instructor, I want to filter analytics by the last 7, 30, or 90 days, so that I can spot recent changes without building custom reports.
4. As an instructor, I want to see gross revenue for the selected time range, so that I can understand recent commercial performance.
5. As an instructor, I want to see new enrollments for the selected time range, so that I can tell whether learner acquisition is improving or slowing down.
6. As an instructor, I want to see active learners for the selected time range, so that I can understand whether enrolled learners are still making progress.
7. As an instructor, I want to see completion outcomes, so that I can tell whether my courses are actually getting learners to the finish line.
8. As an instructor, I want completion rate to reflect learners who reached 100% progress, so that the metric is easy to understand.
9. As an instructor, I want outcome metrics to include learners enrolled before the selected time range, so that course health is not distorted by acquisition dates alone.
10. As an instructor, I want a rollup table comparing my courses side by side, so that I can identify top and weak courses quickly.
11. As an instructor, I want the rollup table to include revenue, new enrollments, active learners, completion rate, rating summary, and warning flags, so that I can compare business and learning outcomes together.
12. As an instructor, I want warning flags on underperforming courses, so that weak courses stand out without requiring deep analysis.
13. As an instructor, I want warning flags for low enrollments, low completion rate, and low rating, so that I can spot the most actionable course health problems.
14. As an instructor, I want to click from the rollup dashboard into a single course analytics view, so that I can inspect one course in more detail.
15. As an instructor, I want the course analytics view to show a balanced course health overview, so that I can understand whether a course is healthy across acquisition and outcomes.
16. As an instructor, I want the course analytics view to include KPI cards and a detailed table section, so that I can review metrics and then dig into specifics on the same page.
17. As an instructor, I want to jump from analytics into the course editor, so that I can act immediately on what the metrics suggest.
18. As an instructor, I want to jump from analytics into the student roster, so that I can follow up on learner progress when needed.
19. As an instructor, I want simple rating summaries in the analytics experience, so that I can see whether learner sentiment is improving or declining.
20. As an instructor, I want the dashboard to stay focused on essential metrics, so that I am not overwhelmed by low-value reporting details.
21. As an instructor, I want the dashboard to work across multiple owned courses, so that I can compare my catalog rather than reviewing each course in isolation.
22. As an admin, I want to access the same analytics dashboard patterns as instructors, so that I can support instructors without learning a separate reporting tool.
23. As an admin, I want to filter analytics by instructor, so that I can inspect one instructor's catalog or compare operational performance across owners.
24. As an admin, I want access to analytics for any course, so that I can investigate issues without needing the course owner to reproduce them.
25. As an admin, I want to export analytics data to CSV, so that I can perform offline analysis or share operational reports.
26. As an admin, I want instructor filtering and export to respect access rules, so that analytics remains secure and role-appropriate.
27. As a product owner, I want metric definitions to be consistent across dashboard views, so that instructors do not see conflicting numbers between rollup and course detail pages.
28. As a product owner, I want analytics warnings to use clear fixed thresholds in v1, so that the first release is predictable and easier to test.
29. As a product owner, I want the dashboard to build on existing purchases, enrollments, progress, and ratings data, so that v1 can ship without inventing a large new tracking system.
30. As a product owner, I want the first version to avoid advanced reporting features that dilute focus, so that the team can ship a usable analytics experience quickly.

## Implementation Decisions

- Build a new top-level analytics surface in the instructor area rather than embedding analytics only inside the existing course editor.
- Support both a cross-course rollup view and a course-specific analytics detail view.
- Allow instructors to view analytics only for courses they own.
- Allow admins to view analytics for any course and filter analytics by instructor.
- Use preset time ranges of 7, 30, and 90 days in v1.
- Define revenue in v1 as gross purchase revenue only.
- Define enrollments in v1 as new enrollments within the selected time range.
- Define completion rate in v1 as learners at 100% progress divided by all enrolled learners.
- Define active learners in v1 as learners who made any progress during the selected time range.
- Apply time filters to trend-oriented metrics such as revenue and new enrollments, while still including previously enrolled learners in outcome metrics so course health reflects the actual enrolled base.
- Show top-level KPI cards focused on revenue, enrollments, and completions, with supporting course-comparison tables below.
- Use drill-down tables rather than a broader chart-heavy reporting interface for the initial release.
- Include a main cross-course table with revenue, new enrollments, active learners, completion rate, rating summary, and warning flags.
- Include course warning flags for low enrollments, low completion rate, and low rating.
- Use fixed thresholds in code for warning flags in v1 rather than configurable thresholds or platform-relative thresholds.
- Provide direct action links from analytics into operational destinations such as course editing and the student roster.
- Include simple ratings and counts in analytics, but do not expand into richer review or comment reporting in v1.
- Exclude lesson-level engagement analytics from v1, even though watch-event data exists, to keep the first release focused.
- Exclude quiz analytics from v1, even though attempt data exists, to keep scope narrow and avoid overloading the first dashboard.
- Support admin-only CSV export for analytics data.
- Keep the analytics data assembly behind a deep aggregation module with stable service interfaces so metric definitions, authorization, and filtering logic remain encapsulated.
- Keep metric-definition logic explicit and centralized so future refinements do not require rewriting route-level code.

## Testing Decisions

- Good tests should verify external behavior only: returned metrics, access permissions, filter behavior, warning flags, and export behavior. They should not depend on internal query structure or implementation details.
- The highest-priority tests should target the analytics aggregation service because it is the deepest module and the main place where metric definitions, authorization, and filtering rules come together.
- Test metric behavior for gross revenue, new enrollments, active learners, completion rate, ratings summaries, and warning flags across the supported preset date ranges.
- Test instructor scoping to ensure instructors only receive analytics for owned courses.
- Test admin behavior to ensure admins can access all courses and filter by instructor.
- Test route loader authorization for instructor and admin analytics entry points.
- Test admin-only export behavior, including access control and whether exported rows reflect the same metrics as the dashboard.
- Prior art for these tests already exists in the codebase's service-focused test style, especially the tests around progress, purchases, ratings, and enrollments. The analytics tests should follow that pattern by preferring service-level assertions over brittle UI-level detail checks.

## Out of Scope

- Lesson-by-lesson engagement analysis in v1.
- Video watch-progress reporting in v1.
- Quiz analytics in v1, including per-quiz breakdowns and pass-rate reporting.
- Custom date ranges in v1.
- Period-over-period comparisons in v1.
- Configurable warning thresholds in v1.
- Instructor-facing exports in v1.
- Refund handling, net revenue, or more advanced accounting definitions.
- Composite health scores.
- Advanced review/comment moderation analytics or a recent comment activity feed.
- Cohort analysis split by acquisition period.

## Further Notes

- The repo already contains much of the underlying data needed for this feature, including purchases, enrollments, lesson progress, ratings, comments, quiz attempts, and video watch events, but the v1 dashboard should stay intentionally focused.
- Because the primary product goal is improving course quality, the dashboard should balance business metrics with learner-outcome metrics rather than becoming a pure sales console.
- Metric definitions should be documented clearly in the UI so instructors understand what each number includes.
- The initial warning-flag thresholds should be treated as product defaults that can be revisited after real instructor usage.
