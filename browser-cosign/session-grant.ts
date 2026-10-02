/** SINGLE-PROCESS reference only. Restart loses authority: never use this store for live funds.
 * Production requires a transactional durable store across all signer aliases/epochs.
 * TTL/revocation stops admission, never erases consumed or exposed reservations.
 */
export interface Grant {
  readonly sessionId: string;
  readonly signer: string;
  readonly capMicros: bigint;
  readonly expiresAt: number;
  readonly revoked: boolean;
}
export interface Reservation {
  readonly id: string;
  readonly sessionId: string;
  readonly amountMicros: bigint;
  readonly state:
    | "prepared"
    | "exposed"
    | "submitted"
    | "settled"
    | "cancelled";
}
export class MemoryGrantStore {
  private grants = new Map<string, Grant>();
  private reservations = new Map<string, Reservation>();
  constructor(private readonly now: () => number = Date.now) {}
  setGrant(
    sessionId: string,
    signer: string,
    capMicros: bigint,
    ttlSeconds = 3600,
  ): Grant {
    if (
      !sessionId ||
      !/^0x[0-9a-fA-F]{40}$/.test(signer) ||
      /^0x0{40}$/.test(signer) ||
      typeof capMicros !== "bigint" ||
      capMicros <= 0n ||
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds <= 0
    )
      throw new Error("invalid grant");
    const id = sessionId.toLowerCase();
    // A funded signer cannot gain fresh capacity via grant replacement or an alias.
    if (
      this.grants.has(id) ||
      [...this.grants.values()].some((g) => g.signer === signer.toLowerCase())
    )
      throw new Error("grant or signer already admitted");
    const expiresAt = this.now() + ttlSeconds * 1000;
    if (!Number.isSafeInteger(expiresAt)) throw new Error("invalid expiry");
    const grant = Object.freeze({
      sessionId: id,
      signer: signer.toLowerCase(),
      capMicros,
      expiresAt,
      revoked: false,
    });
    this.grants.set(id, grant);
    return grant;
  }
  getGrant(sessionId: string): Grant | undefined {
    return this.grants.get(sessionId.toLowerCase());
  }
  remaining(sessionId: string): bigint {
    const id = sessionId.toLowerCase(),
      grant = this.grants.get(id);
    if (!grant) return 0n;
    const held = [...this.reservations.values()]
      .filter((r) => r.sessionId === id && r.state !== "cancelled")
      .reduce((a, r) => a + r.amountMicros, 0n);
    return grant.capMicros - held;
  }
  /** Synchronous check + reserve, before ANY await or nonce/signature exposure.
   * id must be the host's unique admitted payment intent, never a caller replacement nonce. */
  reserve(sessionId: string, id: string, amountMicros: bigint): Reservation {
    const key = sessionId.toLowerCase(),
      grant = this.grants.get(key);
    if (
      !grant ||
      grant.revoked ||
      this.now() >= grant.expiresAt ||
      !id ||
      typeof amountMicros !== "bigint" ||
      amountMicros <= 0n ||
      this.reservations.has(id) ||
      amountMicros > this.remaining(key)
    )
      throw new Error("reservation denied");
    const reservation = Object.freeze({
      id,
      sessionId: key,
      amountMicros,
      state: "prepared" as const,
    });
    this.reservations.set(id, reservation);
    return reservation;
  }
  getReservation(id: string): Reservation | undefined {
    return this.reservations.get(id);
  }
  private transition(
    id: string,
    from: Reservation["state"],
    state: Reservation["state"],
  ): Reservation {
    const r = this.reservations.get(id);
    if (!r || r.state !== from)
      throw new Error("invalid reservation transition");
    const next = Object.freeze({ ...r, state });
    this.reservations.set(id, next);
    return next;
  }
  expose(id: string): Reservation {
    return this.transition(id, "prepared", "exposed");
  }
  submit(id: string): Reservation {
    return this.transition(id, "exposed", "submitted");
  }
  /** Bookkeeping only: caller must first persist exact, validated Circle success evidence. */
  settle(id: string): Reservation {
    return this.transition(id, "submitted", "settled");
  }
  /** Only proven unexposed work may release. No exposed timeout/failure release API. */
  cancelUnexposed(id: string): Reservation {
    return this.transition(id, "prepared", "cancelled");
  }
  revokeGrant(sessionId: string): void {
    const id = sessionId.toLowerCase(),
      g = this.grants.get(id);
    if (g) this.grants.set(id, Object.freeze({ ...g, revoked: true }));
  }
}
