/**
 * Server-side relay for a gasless creator/user cash-out on Arc.
 *
 * The user signs a burn intent in the browser (see `withdraw-intent.ts`). This relay:
 *   1. POSTs the signed intent to Circle's Gateway /transfer API → gets a mint attestation.
 *   2. Has a TREASURY wallet submit the on-chain gatewayMint(), paying the gas — so the user pays none.
 *
 * Non-custodial + safe to expose: the burn-intent signature can only be produced by the balance
 * owner, and destinationCaller = 0x0 makes the mint permissionless, so the treasury (any sender)
 * can submit it. It can only ever move the SIGNER's own funds to the recipient the SIGNER chose.
 *
 * Framework-agnostic: no request/DB coupling. Wrap `relayGaslessWithdraw` in your route handler,
 * pass the treasury key, and (recommended) assert `expectedDepositor` = the authenticated user.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ARC } from "../arc";
import type { WireBurnIntent } from "./withdraw-intent";

/** gatewayMint(bytes attestationPayload, bytes signature) — from the SDK's GATEWAY_MINTER_ABI. */
const GATEWAY_MINTER_ABI = [
  {
    name: "gatewayMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export interface RelayOpts {
  /** Treasury private key that pays gas to submit the mint. Keep server-side only. */
  treasuryKey: Hex;
  /** Signed burn intent from the browser. */
  burnIntent: WireBurnIntent;
  signature: Hex;
  /**
   * REQUIRED for safety: the address you expect to own the funds (e.g. your authenticated session
   * wallet). The relay rejects any intent whose depositor/signer isn't this address, so callers
   * can't spend the treasury relay to mint against balances they don't own.
   */
  expectedDepositor: string;
  /** Override the RPC (defaults to Arc testnet). */
  rpcUrl?: string;
  /** Mint receipt timeout in ms (default 90s). */
  timeoutMs?: number;
}

export interface RelayResult {
  mintTxHash: Hex;
  amountUsdc: number;
  recipient: string;
  explorerUrl: string;
}

/** Decode a left-padded bytes32 back to a checksummed address (rightmost 20 bytes). */
function b32ToAddress(b32: string): string {
  return getAddress(("0x" + b32.slice(-40)) as Hex);
}

/**
 * Validate a signed burn intent against the expected owner + the canonical Arc contracts, then
 * relay it to Circle and submit the mint from the treasury. Throws a `RelayError` (with `.status`)
 * on any rejection so a route handler can map it to an HTTP code.
 */
export async function relayGaslessWithdraw(opts: RelayOpts): Promise<RelayResult> {
  const { burnIntent, signature, expectedDepositor, treasuryKey } = opts;
  const spec = burnIntent?.spec;
  if (!spec || !signature) throw new RelayError("missing burnIntent or signature", 400);

  let depositor: string, signer: string, recipient: string;
  try {
    depositor = b32ToAddress(spec.sourceDepositor);
    signer = b32ToAddress(spec.sourceSigner);
    recipient = b32ToAddress(spec.destinationRecipient);
  } catch {
    throw new RelayError("malformed intent addresses", 400);
  }

  // The intent must be for the expected owner's own balance (correct attribution + no free use of
  // the treasury relay by non-owners).
  if (
    depositor.toLowerCase() !== expectedDepositor.toLowerCase() ||
    signer.toLowerCase() !== depositor.toLowerCase()
  ) {
    throw new RelayError("intent depositor does not match expected owner", 403);
  }

  // Same-chain Arc → Arc only, against the canonical Gateway contracts + USDC.
  const okChain =
    spec.sourceDomain === ARC.cctpDomain &&
    spec.destinationDomain === ARC.cctpDomain &&
    b32ToAddress(spec.sourceContract).toLowerCase() === ARC.gatewayWallet.toLowerCase() &&
    b32ToAddress(spec.destinationContract).toLowerCase() === ARC.gatewayMinter.toLowerCase() &&
    b32ToAddress(spec.sourceToken).toLowerCase() === ARC.usdc.toLowerCase() &&
    b32ToAddress(spec.destinationToken).toLowerCase() === ARC.usdc.toLowerCase();
  if (!okChain) throw new RelayError("intent targets an unexpected chain/contract", 400);

  const valueAtomic = BigInt(spec.value);
  if (valueAtomic <= 0n) throw new RelayError("withdraw amount must be > 0", 400);
  const amountUsdc = Number(valueAtomic) / 1e6;
  const rpcUrl = opts.rpcUrl ?? ARC.rpcUrl;

  // 1) Relay the signed burn intent to Circle → mint attestation.
  const transferRes = await fetch(ARC.gatewayTransferApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature }]),
  });
  const result = (await transferRes.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    message?: string;
    attestation?: Hex;
    signature?: Hex;
  };
  if (result.success === false || result.error || !result.attestation || !result.signature) {
    const reason = result.message || result.error || `HTTP ${transferRes.status}`;
    throw new RelayError(`gateway transfer failed: ${reason}`, 502);
  }

  // 2) Treasury submits the on-chain mint (pays gas). destinationCaller = 0x0 ⇒ permissionless.
  const treasury = privateKeyToAccount(treasuryKey);
  const walletClient = createWalletClient({ account: treasury, chain: arcTestnet, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });

  const mintTxHash = await walletClient.writeContract({
    address: ARC.gatewayMinter as Hex,
    abi: GATEWAY_MINTER_ABI,
    functionName: "gatewayMint",
    args: [result.attestation, result.signature],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: mintTxHash,
    timeout: opts.timeoutMs ?? 90_000,
  });
  if (receipt.status !== "success") throw new RelayError("mint reverted on-chain", 502);

  // Unlike per-payment Circle settlement UUIDs, THIS is a real EVM tx hash that resolves at /tx/.
  return { mintTxHash, amountUsdc, recipient, explorerUrl: `${ARC.explorer}/tx/${mintTxHash}` };
}

/** Error carrying an HTTP status so a route handler can `return Response.json({error}, {status})`. */
export class RelayError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "RelayError";
  }
}
