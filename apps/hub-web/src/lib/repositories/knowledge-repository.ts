import { eq, and, asc, desc, inArray, isNull, sql } from 'drizzle-orm';
import {
  db,
  courses,
  courseChapters,
  courseVideos,
  videoWatchProgress,
  videoNotes,
  users,
} from '../db';
import type {
  Course,
  NewCourse,
  CourseChapter,
  NewCourseChapter,
  CourseVideo,
  NewCourseVideo,
  VideoWatchProgress,
  VideoNote,
} from '@repo/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChapterWithVideos extends CourseChapter {
  videos: CourseVideoWithProgress[];
}

export interface CourseVideoWithProgress extends CourseVideo {
  progress: VideoWatchProgress | null;
}

export interface CourseWithChapters extends Course {
  chapters: ChapterWithVideos[];
  totalVideos: number;
  completedVideos: number;
}

export interface VideoDetail extends CourseVideo {
  chapter: CourseChapter & { course: Course };
  progress: VideoWatchProgress | null;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * List all published courses accessible to the given role.
 * - Empty allowed_roles → open to all.
 * - Non-empty → only roles listed in the array.
 */
export async function listCourses(userRole: string): Promise<Course[]> {
  const allCourses = await db
    .select()
    .from(courses)
    .where(eq(courses.is_published, true))
    .orderBy(asc(courses.created_at));

  return allCourses.filter((course) => {
    if (!course.allowed_roles || course.allowed_roles.length === 0) return true;
    return course.allowed_roles.includes(userRole);
  });
}

export async function listAllCourses(): Promise<Course[]> {
  return db.select().from(courses).orderBy(asc(courses.created_at));
}

export async function getCourseById(id: string): Promise<Course | null> {
  const [course] = await db.select().from(courses).where(eq(courses.id, id));
  return course ?? null;
}

/**
 * Full course tree: chapters → videos, with per-user progress injected.
 */
export async function getCourseWithChapters(
  courseId: string,
  userId: string
): Promise<CourseWithChapters | null> {
  const course = await getCourseById(courseId);
  if (!course) return null;

  const chapters = await db
    .select()
    .from(courseChapters)
    .where(eq(courseChapters.course_id, courseId))
    .orderBy(asc(courseChapters.order_index));

  const chapterIds = chapters.map((c) => c.id);
  const allVideos =
    chapterIds.length === 0
      ? []
      : await db
          .select()
          .from(courseVideos)
          .where(inArray(courseVideos.chapter_id, chapterIds))
          .orderBy(asc(courseVideos.order_index));

  const allVideoIds = allVideos.map((v) => v.id);
  const progressRows =
    allVideoIds.length === 0
      ? []
      : await db
          .select()
          .from(videoWatchProgress)
          .where(
            and(
              eq(videoWatchProgress.user_id, userId),
              inArray(videoWatchProgress.video_id, allVideoIds)
            )
          );

  const progressMap = new Map<string, VideoWatchProgress>(
    progressRows.map((p) => [p.video_id, p])
  );

  let totalVideos = 0;
  let completedVideos = 0;

  const chaptersWithVideos: ChapterWithVideos[] = chapters.map((chapter) => {
    const chapterVideos = allVideos
      .filter((v) => v.chapter_id === chapter.id && v.is_published)
      .map((video) => {
        const prog = progressMap.get(video.id) ?? null;
        totalVideos++;
        if (prog?.is_completed) completedVideos++;
        return { ...video, progress: prog };
      });

    return { ...chapter, videos: chapterVideos };
  });

  return { ...course, chapters: chaptersWithVideos, totalVideos, completedVideos };
}

export async function createCourse(data: Omit<NewCourse, 'id' | 'created_at' | 'updated_at'>): Promise<Course> {
  const [created] = await db.insert(courses).values(data).returning();
  return created;
}

export async function updateCourse(
  id: string,
  patch: Partial<Omit<NewCourse, 'id' | 'created_at' | 'updated_at'>>
): Promise<Course | null> {
  const [updated] = await db.update(courses).set(patch).where(eq(courses.id, id)).returning();
  return updated ?? null;
}

export async function deleteCourse(id: string): Promise<void> {
  await db.delete(courses).where(eq(courses.id, id));
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export async function listChaptersByCourse(courseId: string): Promise<CourseChapter[]> {
  return db
    .select()
    .from(courseChapters)
    .where(eq(courseChapters.course_id, courseId))
    .orderBy(asc(courseChapters.order_index));
}

export async function createChapter(
  data: Omit<NewCourseChapter, 'id' | 'created_at' | 'updated_at'>
): Promise<CourseChapter> {
  const [created] = await db.insert(courseChapters).values(data).returning();
  return created;
}

export async function updateChapter(
  id: string,
  patch: Partial<Omit<NewCourseChapter, 'id' | 'created_at' | 'updated_at'>>
): Promise<CourseChapter | null> {
  const [updated] = await db.update(courseChapters).set(patch).where(eq(courseChapters.id, id)).returning();
  return updated ?? null;
}

export async function deleteChapter(id: string): Promise<void> {
  await db.delete(courseChapters).where(eq(courseChapters.id, id));
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export async function getVideoById(videoId: string): Promise<VideoDetail | null> {
  const [video] = await db.select().from(courseVideos).where(eq(courseVideos.id, videoId));
  if (!video) return null;

  const [chapter] = await db
    .select()
    .from(courseChapters)
    .where(eq(courseChapters.id, video.chapter_id));
  if (!chapter) return null;

  const [course] = await db.select().from(courses).where(eq(courses.id, chapter.course_id));
  if (!course) return null;

  return {
    ...video,
    chapter: { ...chapter, course },
    progress: null,
  };
}

export async function getVideoWithProgress(
  videoId: string,
  userId: string
): Promise<VideoDetail | null> {
  const detail = await getVideoById(videoId);
  if (!detail) return null;

  const [progress] = await db
    .select()
    .from(videoWatchProgress)
    .where(
      and(
        eq(videoWatchProgress.user_id, userId),
        eq(videoWatchProgress.video_id, videoId)
      )
    );

  return { ...detail, progress: progress ?? null };
}

export async function listVideosByChapter(chapterId: string): Promise<CourseVideo[]> {
  return db
    .select()
    .from(courseVideos)
    .where(and(eq(courseVideos.chapter_id, chapterId), eq(courseVideos.is_published, true)))
    .orderBy(asc(courseVideos.order_index));
}

export async function createVideo(
  data: Omit<NewCourseVideo, 'id' | 'created_at' | 'updated_at'>
): Promise<CourseVideo> {
  const [created] = await db.insert(courseVideos).values(data).returning();
  return created;
}

export async function updateVideo(
  id: string,
  patch: Partial<Omit<NewCourseVideo, 'id' | 'created_at' | 'updated_at'>>
): Promise<CourseVideo | null> {
  const [updated] = await db.update(courseVideos).set(patch).where(eq(courseVideos.id, id)).returning();
  return updated ?? null;
}

export async function deleteVideo(id: string): Promise<void> {
  await db.delete(courseVideos).where(eq(courseVideos.id, id));
}

// ---------------------------------------------------------------------------
// Watch Progress
// ---------------------------------------------------------------------------

export async function upsertWatchProgress(
  userId: string,
  videoId: string,
  lastPositionSeconds: number,
  isCompleted: boolean
): Promise<VideoWatchProgress> {
  const completedAt = isCompleted ? new Date() : undefined;

  const [result] = await db
    .insert(videoWatchProgress)
    .values({
      user_id: userId,
      video_id: videoId,
      last_position_seconds: lastPositionSeconds,
      is_completed: isCompleted,
      ...(completedAt ? { completed_at: completedAt } : {}),
    })
    .onConflictDoUpdate({
      target: [videoWatchProgress.user_id, videoWatchProgress.video_id],
      set: {
        last_position_seconds: lastPositionSeconds,
        is_completed: isCompleted,
        last_viewed_at: new Date(),
        ...(completedAt ? { completed_at: completedAt } : {}),
      },
    })
    .returning();

  return result;
}

export async function getWatchProgress(
  userId: string,
  videoId: string
): Promise<VideoWatchProgress | null> {
  const [progress] = await db
    .select()
    .from(videoWatchProgress)
    .where(
      and(
        eq(videoWatchProgress.user_id, userId),
        eq(videoWatchProgress.video_id, videoId)
      )
    );
  return progress ?? null;
}

/**
 * Aggregate progress for all videos in a course.
 * Returns { completedCount, totalCount, percentComplete }.
 */
export async function getUserCourseProgress(
  userId: string,
  courseId: string
): Promise<{ completedCount: number; totalCount: number; percentComplete: number }> {
  const chapters = await listChaptersByCourse(courseId);
  if (chapters.length === 0) return { completedCount: 0, totalCount: 0, percentComplete: 0 };

  const chapterIds = chapters.map((c) => c.id);
  const allVideos: CourseVideo[] = [];
  for (const chapterId of chapterIds) {
    const vids = await listVideosByChapter(chapterId);
    allVideos.push(...vids);
  }

  const totalCount = allVideos.length;
  if (totalCount === 0) return { completedCount: 0, totalCount: 0, percentComplete: 0 };

  const videoIds = allVideos.map((v) => v.id);
  const progressRows = await db
    .select()
    .from(videoWatchProgress)
    .where(eq(videoWatchProgress.user_id, userId));

  const completedCount = progressRows.filter(
    (p) => p.is_completed && videoIds.includes(p.video_id)
  ).length;

  return {
    completedCount,
    totalCount,
    percentComplete: Math.round((completedCount / totalCount) * 100),
  };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listVideoNotes(
  userId: string,
  videoId: string
): Promise<VideoNote[]> {
  return db
    .select()
    .from(videoNotes)
    .where(
      and(eq(videoNotes.user_id, userId), eq(videoNotes.video_id, videoId))
    )
    .orderBy(
      // Timestamped notes first (ascending), then general notes
      sql`CASE WHEN ${videoNotes.timestamp_seconds} IS NULL THEN 1 ELSE 0 END`,
      asc(videoNotes.timestamp_seconds),
      desc(videoNotes.created_at)
    );
}

export async function createVideoNote(data: {
  userId: string;
  videoId: string;
  timestampSeconds?: number | null;
  content: string;
}): Promise<VideoNote> {
  const [note] = await db
    .insert(videoNotes)
    .values({
      user_id: data.userId,
      video_id: data.videoId,
      timestamp_seconds: data.timestampSeconds ?? null,
      content: data.content,
    })
    .returning();
  return note;
}

export async function deleteVideoNote(noteId: string, userId: string): Promise<void> {
  await db
    .delete(videoNotes)
    .where(and(eq(videoNotes.id, noteId), eq(videoNotes.user_id, userId)));
}
