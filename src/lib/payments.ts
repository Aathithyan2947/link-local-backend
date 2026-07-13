// MOCK payment gateway for the July MVP.
// Every paid flow (events, groups, orders) charges through here so the real
// Razorpay/Stripe integration later is a single-file swap behind this interface.

export interface ChargeResult {
  status: 'paid';
  transactionRef: string;
  paidAt: Date;
}

/** Pretends to charge `amount` and returns a fake-but-unique transaction ref. */
export function mockCharge(_amount: number): ChargeResult {
  const rand = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0');
  return {
    status: 'paid',
    transactionRef: `MOCK-${Date.now()}-${rand}`,
    paidAt: new Date(),
  };
}
