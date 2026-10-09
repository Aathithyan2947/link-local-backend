import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import {
  addressScopeFilter,
  resolveUserCityId,
  resolveUserScopeContext,
  sanitizeAreaOverride,
  type HomeScope,
} from '../home/home.service.js';
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

/**
 * A group's discussions are open to view, but only its joined members (paid, for a paid
 * group) and its creator may like or reply. Posts outside a group are open to everyone.
 * Returns the post's group, or null when it isn't a group post.
 */
async function groupAccess(postId: number, userId: number) {
  const gp = await prisma.interestGroupPost.findFirst({
    where: { postId },
    select: { group: { select: { id: true, title: true, creatorId: true, isPaid: true } } },
  });
  if (!gp) return null;
  const { group } = gp;
  if (group.creatorId === userId) return { group, canInteract: true };
  const member = await prisma.interestGroupMember.findFirst({
    where: { groupId: group.id, userId, status: 'joined' },
    select: { paymentStatus: true },
  });
  const canInteract = !!member && (!group.isPaid || member.paymentStatus === 'paid');
  return { group, canInteract };
}

async function assertCanInteract(postId: number, userId: number) {
  const access = await groupAccess(postId, userId);
  if (access && !access.canInteract) throw ApiError.forbidden('Join the group to like, comment or share');
}

/** Comment likes live in post_comment_reactions as (entityType 'comment', emoji 'like'). */
const COMMENT_LIKE = { entityType: 'comment', emoji: 'like' } as const;

/** Marks which of `postIds` the viewer has liked. */
async function likedSet(userId: number, postIds: number[]): Promise<Set<number>> {
  if (postIds.length === 0) return new Set();
  const rows = await prisma.postLike.findMany({
    where: { userId, postId: { in: postIds } },
    select: { postId: true },
  });
  return new Set(rows.map((r) => r.postId));
}

export async function listPosts(
  userId: number,
  params: PaginationParams & { postType?: string; scope?: HomeScope; areaId?: number; userId?: number },
) {
  const where: Record<string, unknown> = { isActive: true };
  if (params.postType) where.postType = params.postType;

  // A profile's "View More": everything that member posted, not limited to the viewer's city
  // (the profile itself already shows their latest posts the same way).
  if (params.userId !== undefined) {
    where.userId = params.userId;
    const [items, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { createdAt: 'desc' }, include: postInclude, ...toPrismaPagination(params) }),
      prisma.post.count({ where }),
    ]);
    return { items: await decorateDiscussions(items, userId), meta: buildMeta(params.page, params.pageSize, total) };
  }

  // Home's Community Discussions header can be re-scoped to a single area, the same way the
  // service-provider / workshop / group sections already are. Without a scope or area this
  // stays exactly as it was: everything in the caller's own city.
  if (params.scope || params.areaId !== undefined) {
    const ctx = await resolveUserScopeContext(userId);
    const overrideAreaId = await sanitizeAreaOverride(params.areaId, ctx.cityId);
    const filter = addressScopeFilter(params.scope ?? 'area', ctx, overrideAreaId);
    if (Object.keys(filter).length > 0) where.user = { profile: { address: filter } };
  } else {
    const cityId = await resolveUserCityId(userId);
    if (cityId) where.user = { profile: { address: { area: { cityId } } } };
  }

  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: postInclude,
      ...toPrismaPagination(params),
    }),
    prisma.post.count({ where }),
  ]);
  return { items: await decorateDiscussions(items, userId), meta: buildMeta(params.page, params.pageSize, total) };
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
  const [liked, access] = await Promise.all([
    prisma.postLike.findFirst({ where: { postId: id, userId } }),
    groupAccess(id, userId),
  ]);

  // Each comment's (and reply's) like count, and whether the viewer liked it.
  const commentIds = post.comments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  const [counts, mine] = commentIds.length
    ? await Promise.all([
        prisma.postCommentReaction.groupBy({
          by: ['entityId'],
          where: { ...COMMENT_LIKE, entityId: { in: commentIds } },
          _count: { _all: true },
        }),
        prisma.postCommentReaction.findMany({
          where: { ...COMMENT_LIKE, userId, entityId: { in: commentIds } },
          select: { entityId: true },
        }),
      ])
    : [[], []];
  const likeCount = new Map(counts.map((c) => [c.entityId, c._count._all]));
  const likedByMe = new Set(mine.map((m) => m.entityId));
  const withLikes = <T extends { id: number }>(c: T) => ({
    ...c,
    likes: likeCount.get(c.id) ?? 0,
    viewerLiked: likedByMe.has(c.id),
  });

  return {
    ...post,
    comments: post.comments.map((c) => ({ ...withLikes(c), replies: c.replies.map(withLikes) })),
    viewerLiked: !!liked,
    // Set for group posts: the app shows non-members a view-only thread.
    group: access ? { id: access.group.id, title: access.group.title } : null,
    canInteract: access?.canInteract ?? true,
  };
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

/**
 * Sets the viewer's like on a post to `liked`. Idempotent — sending the same state twice
 * changes nothing — so rapid taps can't stack likes the way check-then-insert toggling did.
 */
export async function setPostLike(userId: number, postId: number, liked: boolean) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw ApiError.notFound('Post not found');
  await assertCanInteract(postId, userId);
  if (liked) {
    const existing = await prisma.postLike.findFirst({ where: { postId, userId }, select: { id: true } });
    if (!existing) await prisma.postLike.createMany({ data: [{ postId, userId }], skipDuplicates: true });
  } else {
    await prisma.postLike.deleteMany({ where: { postId, userId } });
  }
  const likes = await prisma.postLike.count({ where: { postId } });
  return { liked, likes };
}

/** Legacy toggle, kept for app builds that predate `setPostLike`. */
export async function toggleLike(userId: number, postId: number) {
  const existing = await prisma.postLike.findFirst({ where: { userId, postId }, select: { id: true } });
  const { liked } = await setPostLike(userId, postId, !existing);
  return { liked };
}

export async function addComment(
  userId: number,
  postId: number,
  comment: string,
  parentCommentId?: number,
) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) throw ApiError.notFound('Post not found');
  await assertCanInteract(postId, userId);

  // Replies are one level deep: a reply to a reply joins its top-level comment's thread.
  let parent: { id: number; userId: number } | null = null;
  if (parentCommentId != null) {
    const target = await prisma.postComment.findUnique({
      where: { id: parentCommentId },
      select: { id: true, postId: true, userId: true, parentCommentId: true },
    });
    if (!target || target.postId !== postId) throw ApiError.badRequest('That comment is not on this post');
    parent = target.parentCommentId
      ? await prisma.postComment.findUnique({
          where: { id: target.parentCommentId },
          select: { id: true, userId: true },
        })
      : target;
    // Whoever was replied to hears about it, even when replying inside a thread.
    if (target.userId !== userId && target.userId !== post.userId) {
      await emitNotification({
        userId: target.userId,
        title: 'New reply',
        body: comment.slice(0, 80),
        type: 'message',
        entityType: 'post',
        entityId: postId,
      });
    }
  }

  const created = await prisma.postComment.create({
    data: { userId, postId, comment, parentCommentId: parent?.id },
    include: authorSelect,
  });
  if (post.userId !== userId) {
    await emitNotification({
      userId: post.userId,
      title: parent ? 'New reply' : 'New comment',
      body: comment.slice(0, 80),
      type: 'message',
      entityType: 'post',
      entityId: postId,
    });
  }
  return { ...created, likes: 0, viewerLiked: false, replyCount: 0 };
}

/** Sets the viewer's like on a comment or reply to `liked` (idempotent, like `setPostLike`). */
export async function setCommentLike(userId: number, commentId: number, liked: boolean) {
  const comment = await prisma.postComment.findUnique({ where: { id: commentId }, select: { postId: true } });
  if (!comment) throw ApiError.notFound('Comment not found');
  await assertCanInteract(comment.postId, userId);

  const where = { ...COMMENT_LIKE, entityId: commentId, userId };
  if (liked) {
    const existing = await prisma.postCommentReaction.findFirst({ where, select: { id: true } });
    if (!existing) await prisma.postCommentReaction.createMany({ data: [where], skipDuplicates: true });
  } else {
    await prisma.postCommentReaction.deleteMany({ where });
  }
  const likes = await prisma.postCommentReaction.count({ where: { ...COMMENT_LIKE, entityId: commentId } });
  return { liked, likes };
}

/** Legacy toggle, kept for app builds that predate `setCommentLike`. */
export async function toggleCommentLike(userId: number, commentId: number) {
  const existing = await prisma.postCommentReaction.findFirst({
    where: { ...COMMENT_LIKE, entityId: commentId, userId },
    select: { id: true },
  });
  return setCommentLike(userId, commentId, !existing);
}

/** Like counts, the viewer's likes and reply counts for a set of comments. */
async function commentStats(commentIds: number[], userId: number) {
  if (!commentIds.length) {
    return { likes: new Map<number, number>(), mine: new Set<number>(), replies: new Map<number, number>() };
  }
  const [counts, mine, replies] = await Promise.all([
    prisma.postCommentReaction.groupBy({
      by: ['entityId'],
      where: { ...COMMENT_LIKE, entityId: { in: commentIds } },
      _count: { _all: true },
    }),
    prisma.postCommentReaction.findMany({
      where: { ...COMMENT_LIKE, userId, entityId: { in: commentIds } },
      select: { entityId: true },
    }),
    prisma.postComment.groupBy({
      by: ['parentCommentId'],
      where: { parentCommentId: { in: commentIds } },
      _count: { _all: true },
    }),
  ]);
  return {
    likes: new Map(counts.map((c) => [c.entityId, c._count._all])),
    mine: new Set(mine.map((m) => m.entityId)),
    replies: new Map(replies.map((r) => [r.parentCommentId!, r._count._all])),
  };
}

/**
 * One page of a post's top-level comments for the comments panel. `top` puts the most-liked
 * first (newest breaking ties); `newest` is plain recency. Replies load per thread.
 */
export async function listComments(
  postId: number,
  userId: number,
  params: PaginationParams & { sort: 'top' | 'newest' },
) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, _count: { select: { comments: true } } },
  });
  if (!post) throw ApiError.notFound('Post not found');
  const { skip, take } = toPrismaPagination(params);

  let ids: number[];
  if (params.sort === 'top') {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT c.id
      FROM post_comments c
      LEFT JOIN (
        SELECT entity_id, count(*) AS n FROM post_comment_reactions
        WHERE entity_type = 'comment' AND emoji = 'like' GROUP BY entity_id
      ) r ON r.entity_id = c.id
      WHERE c.post_id = ${postId} AND c.parent_comment_id IS NULL
      ORDER BY coalesce(r.n, 0) DESC, c.created_at DESC, c.id DESC
      OFFSET ${skip} LIMIT ${take}`;
    ids = rows.map((r) => Number(r.id));
  } else {
    const rows = await prisma.postComment.findMany({
      where: { postId, parentCommentId: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: { id: true },
    });
    ids = rows.map((r) => r.id);
  }

  const [rows, topLevel, stats, access] = await Promise.all([
    prisma.postComment.findMany({ where: { id: { in: ids } }, include: authorSelect }),
    prisma.postComment.count({ where: { postId, parentCommentId: null } }),
    commentStats(ids, userId),
    groupAccess(postId, userId),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      ...c,
      likes: stats.likes.get(c.id) ?? 0,
      viewerLiked: stats.mine.has(c.id),
      replyCount: stats.replies.get(c.id) ?? 0,
    }));
  return {
    items,
    meta: buildMeta(params.page, params.pageSize, topLevel),
    // Every comment and reply, for the panel's "Comments · N" header.
    totalComments: post._count.comments,
    canInteract: access?.canInteract ?? true,
  };
}

/** A comment's replies, oldest first, for expanding its thread in the comments panel. */
export async function listReplies(commentId: number, userId: number) {
  const parent = await prisma.postComment.findUnique({ where: { id: commentId }, select: { id: true } });
  if (!parent) throw ApiError.notFound('Comment not found');
  const replies = await prisma.postComment.findMany({
    where: { parentCommentId: commentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: authorSelect,
  });
  const stats = await commentStats(replies.map((r) => r.id), userId);
  return replies.map((r) => ({
    ...r,
    likes: stats.likes.get(r.id) ?? 0,
    viewerLiked: stats.mine.has(r.id),
    replyCount: 0,
  }));
}

/**
 * Adds what a discussion card needs for the viewer to every post in a list: their like,
 * whether they may interact (group posts: members only), the post's group, and a top
 * comment preview (most-liked, then newest). Used by every discussion list — Home, the
 * community feed and group pages — so the card behaves the same everywhere.
 */
export async function decorateDiscussions<T extends { id: number }>(posts: T[], viewerId: number) {
  if (!posts.length) return [];
  const postIds = posts.map((p) => p.id);

  const [liked, groupPosts, topRows] = await Promise.all([
    likedSet(viewerId, postIds),
    prisma.interestGroupPost.findMany({
      where: { postId: { in: postIds } },
      select: { postId: true, group: { select: { id: true, title: true, creatorId: true, isPaid: true } } },
    }),
    prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT ON (c.post_id) c.id
      FROM post_comments c
      LEFT JOIN (
        SELECT entity_id, count(*) AS n FROM post_comment_reactions
        WHERE entity_type = 'comment' AND emoji = 'like' GROUP BY entity_id
      ) r ON r.entity_id = c.id
      WHERE c.post_id IN (${Prisma.join(postIds)}) AND c.parent_comment_id IS NULL
      ORDER BY c.post_id, coalesce(r.n, 0) DESC, c.created_at DESC, c.id DESC`,
  ]);

  // Membership in each group these posts belong to, in one query.
  const groupIds = [...new Set(groupPosts.map((g) => g.group.id))];
  const memberships = groupIds.length
    ? await prisma.interestGroupMember.findMany({
        where: { userId: viewerId, groupId: { in: groupIds }, status: 'joined' },
        select: { groupId: true, paymentStatus: true },
      })
    : [];
  const memberOf = new Map(memberships.map((m) => [m.groupId, m]));
  const groupOf = new Map(groupPosts.map((g) => [g.postId, g.group]));

  const topIds = topRows.map((r) => Number(r.id));
  const [topComments, topStats] = await Promise.all([
    topIds.length ? prisma.postComment.findMany({ where: { id: { in: topIds } }, include: authorSelect }) : [],
    commentStats(topIds, viewerId),
  ]);
  const topByPost = new Map(topComments.map((c) => [c.postId, c]));

  return posts.map((p) => {
    const group = groupOf.get(p.id);
    let canInteract = true;
    if (group && group.creatorId !== viewerId) {
      const m = memberOf.get(group.id);
      canInteract = !!m && (!group.isPaid || m.paymentStatus === 'paid');
    }
    const top = topByPost.get(p.id);
    return {
      ...p,
      viewerLiked: liked.has(p.id),
      canInteract,
      group: group ? { id: group.id, title: group.title } : null,
      topComment: top
        ? { ...top, likes: topStats.likes.get(top.id) ?? 0, viewerLiked: topStats.mine.has(top.id), replyCount: topStats.replies.get(top.id) ?? 0 }
        : null,
    };
  });
}

/** Records a post share (both the post-specific and unified entity_shares logs). */
/** Whether [userId] may share the post: it exists and is live, its author allows sharing,
 *  and for a group post they're a member (the same rule as liking and replying). */
export async function assertCanSharePost(postId: number, userId: number) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { isActive: true, sharingAllowed: true },
  });
  if (!post || !post.isActive) throw ApiError.notFound('Post not found');
  if (!post.sharingAllowed) throw ApiError.forbidden("This post can't be shared");
  await assertCanInteract(postId, userId);
}

/** A shared post as a chat shows it: who wrote it, what it says, its first photo. */
export async function postPreviews(postIds: number[]) {
  if (postIds.length === 0) return new Map<number, ReturnType<typeof toPreview>>();
  const posts = await prisma.post.findMany({
    where: { id: { in: [...new Set(postIds)] } },
    select: {
      id: true,
      postType: true,
      textContent: true,
      isActive: true,
      ...authorSelect,
      media: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true, mediaType: true } },
    },
  });
  return new Map(posts.map((p) => [p.id, toPreview(p)]));
}

function toPreview(p: {
  id: number;
  postType: string;
  textContent: string | null;
  isActive: boolean;
  user: { id: number; profile: { name: string | null; photoUrl: string | null } | null };
  media: { url: string; mediaType: string }[];
}) {
  const photo = p.media.find((m) => m.mediaType === 'photo');
  return {
    id: p.id,
    postType: p.postType,
    text: p.textContent ?? '',
    authorName: p.user.profile?.name ?? 'Member',
    authorPhoto: p.user.profile?.photoUrl ?? null,
    photoUrl: photo?.url ?? null,
    isActive: p.isActive,
  };
}

export async function sharePost(userId: number, postId: number, channel?: string) {
  await assertCanSharePost(postId, userId);
  await prisma.$transaction([
    prisma.postShare.create({ data: { postId, userId } }),
    prisma.entityShare.create({
      data: { userId, entityType: 'post', entityId: postId, sharingChannel: channel ?? 'chat' },
    }),
  ]);
  return { shared: true };
}
