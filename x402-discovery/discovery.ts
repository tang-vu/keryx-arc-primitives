/** Bazaar provider/request/response metadata. Advertise on the challenge; facilitator
 * compatibility and discovery publication are host-owned. This metadata never proves
 * that an uncertain debit is safe to retry. */

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
export function bazaarExtension(discovery: DiscoveryDeclaration): {
  bazaar: { info: DiscoveryDeclaration };
} {
  return { bazaar: { info: discovery } };
}

/** Merge the bazaar extension into an existing x402 challenge object (non-mutating). */
export function withBazaarInfo<
  T extends { extensions?: Record<string, unknown> },
>(challenge: T, discovery: DiscoveryDeclaration): T {
  return {
    ...challenge,
    extensions: {
      ...(challenge.extensions ?? {}),
      ...bazaarExtension(discovery),
    },
  };
}

/** Attach metadata once; never infer from a throw whether a debit occurred.
 * This legacy name is retained for imports, but 0.3 deliberately removes fallback retry.
 * Use discovery on the challenge or read-only verification if compatibility is uncertain.
 */
export async function settleWithDiscoveryFallback<
  P extends { extensions?: unknown },
  R,
>(
  payload: P,
  discovery: DiscoveryDeclaration | undefined,
  settleFn: (payload: P) => Promise<R>,
): Promise<R> {
  const extended =
    discovery && !payload.extensions
      ? ({ ...payload, extensions: bazaarExtension(discovery) } as P)
      : payload;
  return settleFn(extended);
}
