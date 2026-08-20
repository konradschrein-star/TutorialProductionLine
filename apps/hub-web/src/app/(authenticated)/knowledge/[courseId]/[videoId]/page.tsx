import { redirect, notFound } from 'next/navigation';
import { getSession } from '../../../_lib/v2-auth';
import { hasPermission } from '@/lib/auth/rbac';
import {
  getCourseWithChapters,
  getVideoWithProgress,
  listVideoNotes,
} from '@/lib/repositories/knowledge-repository';
import { V2KnowledgePlayer } from '../../_components/player';

export default async function V2VideoPlayerPage({
  params,
}: {
  params: Promise<{ courseId: string; videoId: string }>;
}) {
  const { courseId, videoId } = await params;

  const session = await getSession();
  if (!hasPermission(session as any, 'view:knowledge')) redirect('/dashboard');

  const [course, videoDetail, notes] = await Promise.all([
    getCourseWithChapters(courseId, session.userId),
    getVideoWithProgress(videoId, session.userId),
    listVideoNotes(session.userId, videoId),
  ]);

  if (!course || !videoDetail) notFound();

  const { allowed_roles } = course;
  if (allowed_roles.length > 0 && !allowed_roles.includes(session.role)) {
    redirect('/knowledge');
  }

  // Compute next video: flat list of published videos across all chapters
  const allVideos = course.chapters.flatMap((ch) =>
    ch.videos.filter((v) => v.is_published),
  );
  const currentIndex = allVideos.findIndex((v) => v.id === videoId);
  const nextVideoRaw =
    currentIndex >= 0 && currentIndex < allVideos.length - 1
      ? allVideos[currentIndex + 1]
      : null;
  const nextVideo = nextVideoRaw
    ? { id: nextVideoRaw.id, title: nextVideoRaw.title }
    : null;

  const streamUrl = `/api/knowledge/stream?videoId=${encodeURIComponent(videoId)}&key=${encodeURIComponent(videoDetail.video_key)}`;

  return (
    <V2KnowledgePlayer
      course={course}
      video={videoDetail}
      streamUrl={streamUrl}
      initialNotes={notes}
      userId={session.userId}
      nextVideo={nextVideo}
    />
  );
}
