import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { getAddress, zeroAddress } from "viem";
import { ARC } from "../arc.js";
import { formatUsdc, parseUsdc } from "../amounts.js";

export interface TollOptions {
  /** Exact decimal USDC; numbers were removed in 0.3 to avoid rounding. */
  priceUsdc: string;
  payTo: string;
  resourceUrl: string;
  description?: string;
  maxTimeoutSeconds?: number;
}
export interface PaymentIdentity {
  network: string;
  asset: string;
  payer: string;
  payee: string;
  nonce: string;
  amountMicros: string;
  resourceUrl: string;
}
export interface SettleInfo extends PaymentIdentity {
  transaction: string;
}
export interface X402Result {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}
export type PaymentPayload = Parameters<BatchFacilitatorClient["verify"]>[0];
export type Requirements = ReturnType<typeof buildRequirements>;
export interface SellerJournal {
  /** Atomic unique claim by network + asset + payer + nonce across ALL resources.
   * Persist identity and original payload before returning true; false never resubmits.
   * A restart must not forget claims. Do not release pending/expired authorizations. */
  claim(identity: PaymentIdentity, payload: PaymentPayload): Promise<boolean>;
  /** Durable submitted boundary BEFORE the first possible debit. */
  submitted(identity: PaymentIdentity): Promise<void>;
  /** Persist verified Circle evidence before delivery; failure means keep the claim held. */
  settled(info: SettleInfo): Promise<void>;
}
export interface SellerDependencies {
  journal: SellerJournal;
  facilitator?: Pick<BatchFacilitatorClient, "verify" | "settle">;
}
const b64 = (s: string) => Buffer.from(s).toString("base64");
const addressMatches = (a: unknown, b: string): boolean => {
  try {
    return typeof a === "string" && getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
};
const fail = (status: number, error: string, state?: string): X402Result => ({
  status,
  headers: {},
  body: { error, ...(state ? { state } : {}) },
});
export function buildRequirements(o: TollOptions) {
  const amount = parseUsdc(o.priceUsdc);
  const payTo = getAddress(o.payTo);
  if (amount <= 0n || payTo === zeroAddress || !o.resourceUrl)
    throw new Error("positive toll, nonzero payee and resource required");
  const timeout = o.maxTimeoutSeconds ?? ARC.x402ValiditySeconds;
  if (!Number.isSafeInteger(timeout) || timeout < ARC.x402ValiditySeconds)
    throw new Error("insufficient authorization validity window");
  return {
    scheme: "exact" as const,
    network: ARC.networkId,
    asset: ARC.usdc,
    amount: amount.toString(),
    payTo,
    maxTimeoutSeconds: timeout,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: ARC.gatewayWallet,
    },
  };
}
/** Single submission only. A response loss is pending, never permission to sign again.
 * Host authentication, price/payee authority, durable admission and reconciliation are required.
 * Resource URL is unsigned metadata: this journal binds first use, not signing intent.
 */
export async function settleThenServe(
  header: string | null | undefined,
  opts: TollOptions,
  produce: (settle: SettleInfo) => Promise<unknown> | unknown,
  deps?: SellerDependencies,
): Promise<X402Result> {
  const requirements = buildRequirements(opts);
  const resource = {
    url: opts.resourceUrl,
    description:
      opts.description ??
      `Paid resource (${formatUsdc(BigInt(requirements.amount))} USDC)`,
    mimeType: "application/json",
  };
  if (!header)
    return {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": b64(
          JSON.stringify({ x402Version: 2, resource, accepts: [requirements] }),
        ),
      },
      body: {},
    };
  if (!deps?.journal) throw new Error("durable seller journal required");
  let payload: PaymentPayload, identity: PaymentIdentity;
  try {
    if (header.length > 32_768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header))
      throw new Error();
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    payload = decoded?.payload
      ? decoded
      : { x402Version: 2, resource, accepted: requirements, payload: decoded };
    const accepted = payload.accepted as Record<string, unknown>;
    const auth = payload.payload.authorization as Record<string, unknown>;
    const extra = accepted?.extra as Record<string, unknown>;
    const addressEq = (a: unknown, b: string) =>
      typeof a === "string" && getAddress(a) === getAddress(b);
    if (
      payload.x402Version !== 2 ||
      !auth ||
      !accepted ||
      accepted.scheme !== requirements.scheme ||
      accepted.network !== requirements.network ||
      !addressEq(accepted.asset, requirements.asset) ||
      !addressEq(accepted.payTo, requirements.payTo) ||
      accepted.amount !== requirements.amount ||
      accepted.maxTimeoutSeconds !== requirements.maxTimeoutSeconds ||
      extra?.name !== requirements.extra.name ||
      extra?.version !== requirements.extra.version ||
      !addressEq(extra?.verifyingContract, ARC.gatewayWallet) ||
      payload.resource?.url !== opts.resourceUrl ||
      !addressEq(auth.to, requirements.payTo) ||
      auth.value !== requirements.amount ||
      typeof auth.nonce !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce) ||
      typeof auth.from !== "string" ||
      getAddress(auth.from) === zeroAddress ||
      typeof payload.payload.signature !== "string" ||
      !/^0x[0-9a-fA-F]{130}$/.test(payload.payload.signature)
    )
      throw new Error();
    identity = {
      network: ARC.networkId,
      asset: ARC.usdc,
      payer: getAddress(auth.from),
      payee: requirements.payTo,
      nonce: auth.nonce.toLowerCase(),
      amountMicros: requirements.amount,
      resourceUrl: opts.resourceUrl,
    };
    // Detach input before awaits. No caller-controlled dependency mutation changes the selected operation.
    payload = structuredClone(payload);
  } catch {
    return fail(400, "payment identity does not match resource");
  }
  const journal = deps.journal;
  const facilitator =
    deps.facilitator ?? new BatchFacilitatorClient({ url: ARC.gatewayApiUrl });
  let verify;
  try {
    verify = await facilitator.verify(payload, requirements);
  } catch {
    return fail(503, "verification unavailable", "unsubmitted");
  }
  if (
    !verify ||
    typeof verify !== "object" ||
    verify.isValid !== true ||
    !addressMatches(verify.payer, identity.payer)
  )
    return fail(402, "verification failed", "unsubmitted");
  try {
    if (
      (await journal.claim({ ...identity }, structuredClone(payload))) !== true
    )
      return fail(
        409,
        "authorization already claimed; recover original attempt",
        "retained",
      );
    await journal.submitted({ ...identity });
  } catch {
    return fail(
      503,
      "admission acknowledgement unavailable; recover original attempt",
      "retained",
    );
  }
  let settle;
  try {
    settle = await facilitator.settle(payload, requirements);
  } catch {
    return fail(
      202,
      "settlement response unavailable; reconcile original nonce",
      "pending",
    );
  }
  // A negative/malformed response cannot establish terminal non-consumption here.
  if (
    !settle ||
    typeof settle !== "object" ||
    settle.success !== true ||
    typeof settle.transaction !== "string" ||
    !settle.transaction.trim() ||
    settle.transaction.length > 256 ||
    settle.network !== ARC.networkId ||
    !addressMatches(settle.payer, identity.payer)
  )
    return fail(
      202,
      "settlement not confirmed; reconcile original nonce",
      "pending",
    );
  const info: SettleInfo = { ...identity, transaction: settle.transaction };
  const headers = {
    "PAYMENT-RESPONSE": b64(
      JSON.stringify({
        success: true,
        transaction: info.transaction,
        payer: info.payer,
        network: ARC.networkId,
      }),
    ),
  };
  try {
    await journal.settled({ ...info });
  } catch {
    return {
      status: 202,
      headers,
      body: {
        error: "confirmed debit; durable acknowledgement unavailable",
        state: "settled-recording-pending",
      },
    };
  }
  try {
    return {
      status: 200,
      headers,
      body: (await produce({ ...info })) ?? { ok: true },
    };
  } catch {
    return {
      status: 502,
      headers,
      body: {
        error: "settled but delivery failed",
        state: "settled-undelivered",
      },
    };
  }
}
export function toNextResponse(
  r: X402Result,
  NextResponse: {
    json: (
      b: unknown,
      init?: { status?: number },
    ) => { headers: { set: (k: string, v: string) => void } };
  },
) {
  const response = NextResponse.json(r.body, { status: r.status });
  for (const [k, v] of Object.entries(r.headers)) response.headers.set(k, v);
  return response;
}
