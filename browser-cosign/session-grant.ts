/**
 * session-grant — server-side spend-cap enforcement for non-custodial, user-funded agent spend.
 *
 * The pattern: a user funds a session EOA (their own wallet, in the browser tab), and the in-tab
 * session key co-signs each x402 authorization. This module is the SERVER half — it tracks how much
 * a session has spent and rejects a sign-request BEFORE the browser is ever asked to sign once the
 * cap is reached. The private key never touches the server; the funded cap is the hard ceiling.
 *
 * In-memory by default (swap the Map for Redis/DB to scale horizontally). Grants expire after a TTL
 * so a leaked session key can only ever spend up to the remaining cap, within the window.
 */
export interface Grant {
  sessionId: string;     // lowercased session identifier (e.g. derived from the user's wallet sig)
  capUsdc: number;       // hard spend ceiling = the amount the user funded
  spentUsdc: number;     // monotonically increasing
  expiresAt: number;     // epoch ms
}

const grants = new Map<string, Grant>();

/** Register/replace a grant for a session. Call when the user funds + activates a session. */
export function setGrant(sessionId: string, capUsdc: number, ttlSeconds = 3600): Grant {
  const g: Grant = { sessionId: sessionId.toLowerCase(), capUsdc, spentUsdc: 0, expiresAt: Date.now() + ttlSeconds * 1000 };
  grants.set(g.sessionId, g);
  return g;
}

export function getGrant(sessionId: string): Grant | undefined {
  return grants.get(sessionId.toLowerCase());
}

export function isGrantValid(sessionId: string): boolean {
  const g = grants.get(sessionId.toLowerCase());
  return !!g && Date.now() < g.expiresAt && g.spentUsdc < g.capUsdc;
}

/**
 * Pre-spend check — call BEFORE asking the browser to sign. Returns true only if `amountUsdc`
 * still fits under the cap. This is the guard that makes the funded amount a hard ceiling.
 */
export function canSpend(sessionId: string, amountUsdc: number): boolean {
  const g = grants.get(sessionId.toLowerCase());
  if (!g || Date.now() >= g.expiresAt) return false;
  return g.spentUsdc + amountUsdc <= g.capUsdc + 1e-9;
}

/** Record a settled spend. Call AFTER a successful settle so the running total stays accurate. */
export function recordSpend(sessionId: string, amountUsdc: number): void {
  const g = grants.get(sessionId.toLowerCase());
  if (g) g.spentUsdc += amountUsdc;
}

export function revokeGrant(sessionId: string): void {
  grants.delete(sessionId.toLowerCase());
}

export function remaining(sessionId: string): number {
  const g = grants.get(sessionId.toLowerCase());
  return g ? Math.max(0, g.capUsdc - g.spentUsdc) : 0;
}
