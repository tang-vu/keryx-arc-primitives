/**
 * x402 two-toll seller — settle-then-serve, framework-agnostic.
 *
 * One rail, two toll moments:
 *   1. FIXED toll      — a constant access price per request (pass a constant `priceUsdc`).
 *   2. DYNAMIC toll     — a price computed per request (e.g. a contribution-weighted citation
 *                         reward); just compute `priceUsdc` before calling settleThenServe.
 *
 * Both settle real USDC on Arc to `payTo` via Circle's Gateway batching facilitator. The function
 * returns a plain {status, headers, body} so it works in any HTTP framework — a Next.js adapter is
 * included at the bottom.
 */
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { ARC } from "../arc.js";

export interface TollOptions {
  /** Price for THIS request in USDC. Constant = fixed toll; computed = dynamic toll. */
  priceUsdc: number;
  /** Settlement address — where the USDC lands (creator/seller wallet). */
  payTo: string;
  /** Canonical URL of the protected resource (echoed in the 402 challenge). */
  resourceUrl: string;
  description?: string;
  network?: string;
  usdcAddress?: string;
  gatewayWallet?: string;
  maxTimeoutSeconds?: number;
}

export interface SettleInfo { payer: string; transaction: string; amountUsdc: number; }
export interface X402Result { status: number; headers: Record<string, string>; body: unknown; }

const facilitator = new BatchFacilitatorClient();
const b64 = (s: string) => Buffer.from(s).toString("base64");

/** Build the x402 v2 "exact" payment requirements for a toll. */
export function buildRequirements(o: TollOptions) {
  const amount = Math.max(1, Math.round(o.priceUsdc * 1_000_000)); // USDC-6 atomic, min 1 unit
  return {
    scheme: "exact" as const,
    network: o.network ?? ARC.networkId,
    asset: o.usdcAddress ?? ARC.usdc,
    amount: amount.toString(),
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? ARC.x402ValiditySeconds,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: o.gatewayWallet ?? ARC.gatewayWallet },
  };
}

/**
 * No payment header → 402 challenge. Valid payment → verify + settle on Arc, then run `produce`.
 * `produce` only runs AFTER settlement succeeds, so gated content is never released unpaid.
 */
export async function settleThenServe(
  paymentSignatureHeader: string | null | undefined,
  opts: TollOptions,
  produce: (settle: SettleInfo) => Promise<unknown> | unknown,
): Promise<X402Result> {
  const requirements = buildRequirements(opts);

  if (!paymentSignatureHeader) {
    const challenge = {
      x402Version: 2,
      resource: { url: opts.resourceUrl, description: opts.description ?? `Paid resource (${opts.priceUsdc} USDC)`, mimeType: "application/json" },
      accepts: [requirements],
    };
    return { status: 402, headers: { "Content-Type": "application/json", "PAYMENT-REQUIRED": b64(JSON.stringify(challenge)) }, body: {} };
  }

  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(paymentSignatureHeader, "base64").toString("utf-8")); }
  catch { return { status: 400, headers: {}, body: { error: "invalid payment header" } }; }

  // verify() is read-only (always safe to retry). settle() is retried only when it THROWS — a
  // successful on-chain settle consumes the EIP-3009 nonce, so a transient throw leaves it reusable.
  const verify = await withRetry(() => facilitator.verify(payload as never, requirements));
  if (!verify.isValid) return { status: 402, headers: {}, body: { error: "verification failed", reason: verify.invalidReason } };
  const settle = await withRetry(() => facilitator.settle(payload as never, requirements));
  if (!settle.success) return { status: 402, headers: {}, body: { error: "settlement failed", reason: settle.errorReason } };

  const body = await produce({ payer: settle.payer ?? verify.payer ?? "unknown", transaction: settle.transaction ?? "", amountUsdc: opts.priceUsdc });
  return {
    status: 200,
    headers: { "PAYMENT-RESPONSE": b64(JSON.stringify({ success: true, transaction: settle.transaction, payer: settle.payer ?? verify.payer, network: requirements.network })) },
    body: body ?? { ok: true },
  };
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < attempts) await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw last;
}

/**
 * Next.js App Router adapter. Usage in a route handler:
 *   const r = await settleThenServe(req.headers.get("payment-signature"), opts, produce);
 *   return toNextResponse(r, NextResponse);
 */
export function toNextResponse(r: X402Result, NextResponse: { json: (b: unknown, init?: { status?: number }) => { headers: { set: (k: string, v: string) => void } } }) {
  const res = NextResponse.json(r.body, { status: r.status });
  for (const [k, v] of Object.entries(r.headers)) res.headers.set(k, v);
  return res;
}
