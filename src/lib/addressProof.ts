import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma.js';
import { ApiError } from '../utils/ApiError.js';

/** The error code the app answers with its "Address proof mandatory" popup. */
export const ADDRESS_PROOF_REQUIRED = 'ADDRESS_PROOF_REQUIRED';

/**
 * Whether the member may act in the community: they've uploaded a proof for their current
 * address (one still under review counts; a rejected one doesn't), or an admin verified them.
 * Proofs belong to an address, so moving house asks for a new one.
 */
export async function hasSubmittedAddressProof(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isVerified: true, profile: { select: { addressId: true } } },
  });
  if (!user) return false;
  if (user.isVerified) return true;
  const addressId = user.profile?.addressId;
  if (!addressId) return false;
  const proof = await prisma.addressVerificationDoc.findFirst({
    where: { addressId, OR: [{ status: null }, { status: { in: ['pending', 'approved'] } }] },
    select: { id: true },
  });
  return proof != null;
}

/**
 * Refuses [action] ("place an order", "submit a review"…) until the member has uploaded an
 * address proof (BUG-084). It blocks the action, never the account: signing in, browsing,
 * chat, profile edits and uploading the proof itself all stay open. Gated: ordering, joining,
 * posting, creating, reviewing, and (the user's call, 2026-10-27) liking and commenting.
 * Runs after `authenticate('user')`.
 */
export function requireAddressProof(action: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (await hasSubmittedAddressProof(req.auth!.sub)) return next();
      next(new ApiError(403, `Upload your address proof to ${action}.`, undefined, ADDRESS_PROOF_REQUIRED));
    } catch (err) {
      next(err);
    }
  };
}
