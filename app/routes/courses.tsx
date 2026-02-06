import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/courses";
import { buildCourseQuery, getAllCategories, getLessonCountForCourse } from "~/services/courseService";
import { CourseStatus } from "~/db/schema";
import { Card, CardContent, CardFooter, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { BookOpen, Search, User } from "lucide-react";

export function meta() {
  return [
    { title: "Browse Courses — Ralph" },
    { name: "description", content: "Browse all available courses" },
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q");
  const category = url.searchParams.get("category");

  const courses = buildCourseQuery(
    search,
    category,
    CourseStatus.Published,
    "newest",
    50,
    0
  );

  const coursesWithLessonCount = courses.map((course) => ({
    ...course,
    lessonCount: getLessonCountForCourse(course.id),
  }));

  const categories = getAllCategories();

  return { courses: coursesWithLessonCount, categories, search, category };
}

export default function CourseCatalog({ loaderData }: Route.ComponentProps) {
  const { courses, categories, search, category } = loaderData;
  const [searchParams] = useSearchParams();

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Browse Courses</h1>
        <p className="mt-1 text-muted-foreground">
          Find courses to expand your skills
        </p>
      </div>

      {/* Search and Filter */}
      <Form method="get" className="mb-8 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search courses..."
            className="h-10 w-full rounded-md border border-input bg-background pl-10 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          name="category"
          defaultValue={category ?? ""}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.slug}>
              {cat.name}
            </option>
          ))}
        </select>
        <Button type="submit">Search</Button>
      </Form>

      {/* Course Grid */}
      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No courses found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {search || category
              ? "Try adjusting your search or filters."
              : "No published courses are available yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              to={`/courses/${course.slug}`}
              className="group"
            >
              <Card className="h-full transition-shadow group-hover:shadow-md">
                {course.coverImageUrl && (
                  <div className="aspect-video overflow-hidden rounded-t-lg">
                    <img
                      src={course.coverImageUrl}
                      alt={course.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                )}
                <CardHeader>
                  <div className="mb-1 text-xs font-medium text-primary">
                    {course.categoryName}
                  </div>
                  <h3 className="text-lg font-semibold leading-tight group-hover:text-primary">
                    {course.title}
                  </h3>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {course.description}
                  </p>
                </CardContent>
                <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="size-3" />
                    {course.instructorName}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="size-3" />
                    {course.lessonCount} lessons
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
