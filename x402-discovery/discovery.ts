/**
 * x402 discovery extension ("Bazaar" metadata) — make a paid endpoint self-describing so x402
 * tooling can find and call it with ZERO prior knowledge.
 *
 * The shape mirrors the entries Circle's x402 service registry returns from
 * `/v2/x402/discovery/resources` (the index behind `circle services search`): provider info +
 * input/output JSON schemas. You declare it once and:
 *   1. advertise it in your 402 challenge under `extensions.bazaar.info`, AND
 *   2. carry it through the facilitator verify/settle payload so the facilitator can catalog it.
 *
 * It is PURELY ADDITIVE metadata — it must never gate or break payment. `settleWithDiscoveryFallback`
 * enforces that: if a facilitator rejects the extended payload, it silently retries bare.
 */

/** Loose declaration shape — provider + path + JSON schemas. Extend freely; tooling reads what it knows. */
export interface DiscoveryDeclaration {
  provider: {
    name: string;
    website?: string;
    docsUrl?: string;
    openApiUrl?: string;
    description?: string;
    /** e.g. "WEB_SEARCH_RESEARCH", "DATA_API", "COMPUTE" — free-form category tag. */
    category?: string;
    tags?: string[];
  };
  path: string;
  method: string;
  description?: string;
  mimeType?: string;
  /** JSON-schema-ish description of the request body / query. */
  input?: Record<string, unknown>;
  /** JSON-schema-ish description of the response. */
  output?: Record<string, unknown>;
  supportsCircleGateway?: boolean;
  supportsVanillax402?: boolean;
  [k: string]: unknown;
}

/**
 * Wrap a declaration into the `extensions` object of an x402 challenge. Spread the result into your
 * 402 JSON body's `extensions` field:
 *
 *   { x402Version: 2, accepts: [requirements], extensions: bazaarExtension(decl) }
 */
export function bazaarExtension(discovery: DiscoveryDeclaration): { bazaar: { info: DiscoveryDeclaration } } {
  return { bazaar: { info: discovery } };
}

/** Merge the bazaar extension into an existing x402 challenge object (non-mutating). */
export function withBazaarInfo<T extends { extensions?: Record<string, unknown> }>(
  challenge: T,
  discovery: DiscoveryDeclaration,
): T {
  return { ...challenge, extensions: { ...(challenge.extensions ?? {}), ...bazaarExtension(discovery) } };
}

/**
 * Carry discovery metadata through a facilitator verify/settle call WITHOUT ever risking the money
 * path. Adds `extensions.bazaar.info` to the payload; if the facilitator rejects the extended
 * payload, retries once with the bare payload. Discovery is best-effort; settlement is not.
 *
 * @param payload   the x402 payment payload you'd normally pass to verify/settle
 * @param discovery the declaration to attach (skip attaching if payload already has extensions)
 * @param settleFn  your actual verify-or-settle call (e.g. facilitator.settle)
 */
export async function settleWithDiscoveryFallback<P extends { extensions?: unknown }, R>(
  payload: P,
  discovery: DiscoveryDeclaration | undefined,
  settleFn: (payload: P) => Promise<R>,
): Promise<R> {
  const extended =
    discovery && !payload.extensions
      ? ({ ...payload, extensions: bazaarExtension(discovery) } as P)
      : payload;
  try {
    return await settleFn(extended);
  } catch (err) {
    if (extended !== payload) {
      // Facilitator rejected the bazaar-extended payload — retry bare so payment still settles.
      return await settleFn(payload);
    }
    throw err;
  }
}
