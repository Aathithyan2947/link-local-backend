import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import { resolveUserCityId } from '../home/home.service.js';

const postInclude = {
  user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
  media: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { likes: true, comments: true, shares: true } },
};

export async function listPosts(
  userId: number,
  params: PaginationParams & { postType?: string },
) {
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
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getPost(id: number) {
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      ...postInclude,
      comments: {
        where: { parentCommentId: null },
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
          replies: true,
        },
      },
    },
  });
  if (!post) throw ApiError.notFound('Post not found');
  return post;
}

export async function createPost(
  userId: number,
  data: { postType: string; textContent?: string; media?: { mediaType: string; url: string }[] },
) {
  return prisma.post.create({
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

export async function addComment(userId: number, postId: number, comment: string, parentCommentId?: number) {
  return prisma.postComment.create({
    data: { userId, postId, comment, parentCommentId },
    include: { user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } } },
  });
}
