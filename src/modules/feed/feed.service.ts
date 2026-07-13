import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import { resolveUserCityId } from '../home/home.service.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';

const authorSelect = {
  user: { select: { id: true, profile: { select: { id: true, name: true, photoUrl: true } } } },
};

const postInclude = {
  ...authorSelect,
  media: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { likes: true, comments: true, shares: true } },
};

/** Marks which of `postIds` the viewer has liked. */
async function likedSet(userId: number, postIds: number[]): Promise<Set<number>> {
  if (postIds.length === 0) return new Set();
  const rows = await prisma.postLike.findMany({
    where: { userId, postId: { in: postIds } },
    select: { postId: true },
  });
  return new Set(rows.map((r) => r.postId));
}

export async function listPosts(userId: number, params: PaginationParams & { postType?: string }) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = { isActive: true };
  if (params.postType) where.postType = params.postType;
  if (cityId) where.user = { profile: { address: { area: { cityId } } } };

  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: postInclude,
      ...toPrismaPagination(params),
    }),
    prisma.post.count({ where }),
  ]);
  const liked = await likedSet(userId, items.map((p) => p.id));
  const enriched = items.map((p) => ({ ...p, viewerLiked: liked.has(p.id) }));
  return { items: enriched, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getPost(id: number, userId: number) {
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      ...postInclude,
      comments: {
        where: { parentCommentId: null },
        orderBy: { createdAt: 'desc' },
        include: {
          ...authorSelect,
          replies: { orderBy: { createdAt: 'asc' }, include: authorSelect },
        },
      },
    },
  });
  if (!post) throw ApiError.notFound('Post not found');
  const liked = await prisma.postLike.findFirst({ where: { postId: id, userId } });
  return { ...post, viewerLiked: !!liked };
}

export async function createPost(
  userId: number,
  data: { postType: string; textContent?: string; media?: { mediaType: string; url: string }[] },
) {
  const post = await prisma.post.create({
    data: {
      userId,
      postType: data.postType,
      textContent: data.textContent,
      media: data.media?.length
        ? { create: data.media.map((m, i) => ({ ...m, sortOrder: i })) }
        : undefined,
    },
    include: postInclude,
  });
  await bumpUserStats(userId, { postsMade: 1 });
  return { ...post, viewerLiked: false };
}

export async function toggleLike(userId: number, postId: number) {
  const existing = await prisma.postLike.findFirst({ where: { userId, postId } });
  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
    return { liked: false };
  }
  await prisma.postLike.create({ data: { userId, postId } });
  return { liked: true };
}

export async function addComment(
  userId: number,
  postId: number,
  comment: string,
  parentCommentId?: number,
) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw ApiError.notFound('Post not found');

  const created = await prisma.postComment.create({
    data: { userId, postId, comment, parentCommentId },
    include: authorSelect,
  });
  if (post.userId !== userId) {
    await emitNotification({
      userId: post.userId,
      title: 'New comment',
      body: comment.slice(0, 80),
      type: 'message',
      entityType: 'post',
      entityId: postId,
    });
  }
  return created;
}

/** Records a post share (both the post-specific and unified entity_shares logs). */
export async function sharePost(userId: number, postId: number, channel?: string) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw ApiError.notFound('Post not found');
  await prisma.$transaction([
    prisma.postShare.create({ data: { postId, userId } }),
    prisma.entityShare.create({
      data: { userId, entityType: 'post', entityId: postId, sharingChannel: channel ?? 'in_app' },
    }),
  ]);
  return { shared: true };
}
