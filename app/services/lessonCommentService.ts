import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  lessonComments,
  lessons,
  modules,
  users,
  LessonCommentStatus,
} from "~/db/schema";

export function createLessonComment(
  userId: number,
  lessonId: number,
  body: string
) {
  return db
    .insert(lessonComments)
    .values({
      userId,
      lessonId,
      body: body.trim(),
      status: LessonCommentStatus.Visible,
    })
    .returning()
    .get();
}

export function getLessonCommentById(commentId: number) {
  return db
    .select()
    .from(lessonComments)
    .where(eq(lessonComments.id, commentId))
    .get();
}

export function getLessonCommentsForLesson(
  lessonId: number,
  includeHidden: boolean
) {
  const query = db
    .select({
      id: lessonComments.id,
      lessonId: lessonComments.lessonId,
      userId: lessonComments.userId,
      body: lessonComments.body,
      status: lessonComments.status,
      moderatedByUserId: lessonComments.moderatedByUserId,
      moderatedAt: lessonComments.moderatedAt,
      createdAt: lessonComments.createdAt,
      updatedAt: lessonComments.updatedAt,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(
      includeHidden
        ? eq(lessonComments.lessonId, lessonId)
        : and(
            eq(lessonComments.lessonId, lessonId),
            eq(lessonComments.status, LessonCommentStatus.Visible)
          )
    );

  return query.orderBy(lessonComments.createdAt).all();
}

export function getLessonCommentsForCourse(courseId: number) {
  return db
    .select({
      id: lessonComments.id,
      lessonId: lessonComments.lessonId,
      lessonTitle: lessons.title,
      userId: lessonComments.userId,
      body: lessonComments.body,
      status: lessonComments.status,
      moderatedByUserId: lessonComments.moderatedByUserId,
      moderatedAt: lessonComments.moderatedAt,
      createdAt: lessonComments.createdAt,
      updatedAt: lessonComments.updatedAt,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(lessonComments)
    .innerJoin(lessons, eq(lessonComments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(desc(lessonComments.createdAt))
    .all();
}

export function hideLessonComment(commentId: number, moderatorUserId: number) {
  return db
    .update(lessonComments)
    .set({
      status: LessonCommentStatus.Hidden,
      moderatedByUserId: moderatorUserId,
      moderatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(lessonComments.id, commentId))
    .returning()
    .get();
}

export function restoreLessonComment(
  commentId: number,
  moderatorUserId: number
) {
  return db
    .update(lessonComments)
    .set({
      status: LessonCommentStatus.Visible,
      moderatedByUserId: moderatorUserId,
      moderatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(lessonComments.id, commentId))
    .returning()
    .get();
}
