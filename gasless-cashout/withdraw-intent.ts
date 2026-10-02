/**
 * Browser-side builder + signer for a Circle Gateway "burn intent" — the authorization a wallet
 * owner signs to withdraw their accrued Gateway balance back on-chain as real USDC, WITHOUT paying
 * gas. The signed intent is relayed by a server (see `relay.ts`) that gets a mint attestation from
 * Circle and submits the on-chain gatewayMint() on the user's behalf.
 *
 * Why this exists: @circle-fin/x402-batching's GatewayClient.withdraw() only works with a raw
 * privateKey against the key's OWN balance. A user who connected a wallet holds the key in the
 * browser, so we replicate the SDK's burn-intent signing here (verified against the SDK's
 * dist/client/index.js) and let the connected wallet sign it.
 *
 * Non-custodial: the signature can only be produced by the balance owner (sourceDepositor), so
 * nobody can withdraw someone else's funds. destinationCaller = zeroAddress makes the mint
 * PERMISSIONLESS — that is precisely what lets a treasury relayer submit it and pay the gas.
 *
 * Runs in the browser: needs a connected WalletClient + crypto.getRandomValues.
 */

import {
  pad,
  getAddress,
  maxUint256,
  zeroAddress,
  hashTypedData,
  recoverTypedDataAddress,
  type WalletClient,
  type Hex,
} from "viem";
import { ARC } from "../arc.js";
import { parseUsdc } from "../amounts.js";

/** TransferSpec + BurnIntent EIP-712 types, verbatim from the SDK. Do not reorder — the hash depends on it. */
export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

/** Wire-safe burn intent (all bigints serialised to decimal strings) — JSON-transportable to the relay. */
export interface WireBurnIntent {
  maxBlockHeight: string;
  maxFee: string;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: Hex;
    destinationContract: Hex;
    sourceToken: Hex;
    destinationToken: Hex;
    sourceDepositor: Hex;
    destinationRecipient: Hex;
    sourceSigner: Hex;
    destinationCaller: Hex;
    value: string;
    salt: Hex;
    hookData: Hex;
  };
}

export interface SignedWithdrawIntent {
  burnIntent: WireBurnIntent;
  signature: Hex;
}

export interface WithdrawIntentOpts {
  /** Address to receive the minted USDC. Defaults to the signer's own address. */
  recipient?: string;
  /** USDC ceiling for Circle's withdraw fee (charged ON TOP of value). Must be explicitly quoted/reserved by the host; there is no assumed fee. */
  maxFeeUsdc: string;
  /** Finite source-chain height selected from a current trusted head and signing policy. */
  maxBlockHeight: bigint;
}

/** Address → left-padded bytes32 (matches the SDK's addressToBytes32). */
function toBytes32(addr: string): Hex {
  return pad(addr.toLowerCase() as Hex, { size: 32 });
}

/** Cryptographically-random 32-byte salt as hex. */
function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as Hex;
}

/**
 * Build a same-chain (Arc → Arc) burn intent for `valueAtomic` USDC, signed by the connected wallet.
 * sourceDepositor/sourceSigner are the signer's own address — Circle only mints against a balance the
 * signer actually owns.
 *
 * NOTE ON FULL-BALANCE WITHDRAWALS: Circle requires `available >= value + fee`, so a withdraw for the
 * ENTIRE available balance fails by exactly the fee. Reserve a fee margin from the amount before
 * calling this (value = availableAtomic - quotedMaxFeeAtomic). See README.
 *
 * @param walletClient - the connected wallet (e.g. wagmi useWalletClient)
 * @param valueAtomic  - amount to withdraw in atomic USDC units (6 decimals)
 */
export async function buildAndSignWithdrawIntent(
  walletClient: WalletClient,
  valueAtomic: bigint,
  opts: WithdrawIntentOpts,
): Promise<SignedWithdrawIntent> {
  const account = walletClient.account;
  if (!account) throw new Error("wallet has no account");
  const from = getAddress(account.address);
  const to = getAddress(opts.recipient ?? account.address);
  if (typeof valueAtomic !== "bigint" || valueAtomic <= 0n)
    throw new Error("withdraw amount must be > 0");

  const domain = ARC.cctpDomain; // same source + destination domain (Arc → Arc)
  const maxFee = parseUsdc(opts.maxFeeUsdc);
  if (maxFee > maxUint256 || valueAtomic > maxUint256)
    throw new Error("uint256 overflow");
  const maxBlockHeight = opts.maxBlockHeight;
  if (
    typeof maxBlockHeight !== "bigint" ||
    maxBlockHeight <= 0n ||
    maxBlockHeight >= maxUint256
  )
    throw new Error("finite block-height ceiling required");
  const salt = randomSalt();

  // Bigint form used for the EIP-712 hash (matches GatewayClient.createBurnIntent exactly).
  const spec = {
    version: 1,
    sourceDomain: domain,
    destinationDomain: domain,
    sourceContract: toBytes32(ARC.gatewayWallet),
    destinationContract: toBytes32(ARC.gatewayMinter),
    sourceToken: toBytes32(ARC.usdc),
    destinationToken: toBytes32(ARC.usdc),
    sourceDepositor: toBytes32(from),
    destinationRecipient: toBytes32(to),
    sourceSigner: toBytes32(from),
    destinationCaller: toBytes32(zeroAddress), // 0x0 ⇒ permissionless mint ⇒ a relayer can submit it
    value: valueAtomic,
    salt,
    hookData: "0x" as Hex,
  };
  const message = { maxBlockHeight, maxFee, spec };

  // domain = { name, version } only (no chainId) → chain-agnostic signature, no gas, no network switch.
  const signature = await walletClient.signTypedData({
    account,
    domain: ARC.gatewayWalletEip712,
    types: BURN_INTENT_TYPES,
    primaryType: "BurnIntent",
    message,
  });

  // Serialise bigints → strings for JSON transport. Equal numeric values ⇒ Circle reconstructs the
  // same EIP-712 digest, so the signature still verifies (the SDK posts strings too).
  const burnIntent: WireBurnIntent = {
    maxBlockHeight: maxBlockHeight.toString(),
    maxFee: maxFee.toString(),
    spec: { ...spec, value: valueAtomic.toString() },
  };
  return { burnIntent, signature };
}

export function withdrawTypedData(intent: WireBurnIntent) {
  return {
    domain: ARC.gatewayWalletEip712,
    types: BURN_INTENT_TYPES,
    primaryType: "BurnIntent" as const,
    message: {
      maxBlockHeight: BigInt(intent.maxBlockHeight),
      maxFee: BigInt(intent.maxFee),
      spec: { ...intent.spec, value: BigInt(intent.spec.value) },
    },
  };
}
export interface WithdrawPolicy {
  /** Authenticated owner and explicitly approved recipient; same-chain Arc testnet only. */
  owner: string;
  recipient: string;
  maxValueMicros: bigint;
  maxFeeMicros: bigint;
  maxBlockHeight: bigint;
}
/** Strict shape, canonical padded addresses, signed terms and recovered identity before effects. */
export async function verifyWithdrawIntent(
  value: SignedWithdrawIntent,
  selected: WithdrawPolicy,
) {
  const request = structuredClone(value),
    policy = { ...selected };
  if (
    [policy.maxValueMicros, policy.maxFeeMicros, policy.maxBlockHeight].some(
      (v) => typeof v !== "bigint" || v < 0n || v > maxUint256,
    )
  )
    throw new Error("explicit integer policy bounds required");
  const b = request?.burnIntent,
    s = b?.spec;
  const keys = (v: unknown, wanted: string[]) =>
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).sort().join() === wanted.sort().join();
  const uint = (v: unknown) =>
    typeof v === "string" &&
    /^(0|[1-9][0-9]{0,77})$/.test(v) &&
    BigInt(v) <= maxUint256;
  const b32 = (v: unknown) =>
    typeof v === "string" && /^0x0{24}[0-9a-fA-F]{40}$/.test(v);
  const hex32 = (v: unknown) =>
    typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
  if (
    !keys(request, ["burnIntent", "signature"]) ||
    !keys(b, ["maxBlockHeight", "maxFee", "spec"]) ||
    !keys(s, [
      "version",
      "sourceDomain",
      "destinationDomain",
      "sourceContract",
      "destinationContract",
      "sourceToken",
      "destinationToken",
      "sourceDepositor",
      "destinationRecipient",
      "sourceSigner",
      "destinationCaller",
      "value",
      "salt",
      "hookData",
    ]) ||
    !uint(b.maxBlockHeight) ||
    BigInt(b.maxBlockHeight) === 0n ||
    BigInt(b.maxBlockHeight) === maxUint256 ||
    policy.maxBlockHeight <= 0n ||
    BigInt(b.maxBlockHeight) > policy.maxBlockHeight ||
    !uint(b.maxFee) ||
    !uint(s.value) ||
    BigInt(s.value) <= 0n ||
    s.version !== 1 ||
    s.sourceDomain !== ARC.cctpDomain ||
    s.destinationDomain !== ARC.cctpDomain ||
    !hex32(s.salt) ||
    s.hookData !== "0x" ||
    !/^0x[0-9a-fA-F]{130}$/.test(request.signature) ||
    policy.maxValueMicros <= 0n ||
    policy.maxFeeMicros < 0n ||
    BigInt(s.value) > policy.maxValueMicros ||
    BigInt(b.maxFee) > policy.maxFeeMicros
  )
    throw new Error("invalid withdrawal terms");
  const from = getAddress(policy.owner),
    recipient = getAddress(policy.recipient);
  if (from === zeroAddress || recipient === zeroAddress)
    throw new Error("zero owner/recipient");
  const expected = {
    sourceContract: ARC.gatewayWallet,
    destinationContract: ARC.gatewayMinter,
    sourceToken: ARC.usdc,
    destinationToken: ARC.usdc,
    sourceDepositor: from,
    sourceSigner: from,
    destinationRecipient: recipient,
    destinationCaller: zeroAddress,
  };
  for (const [k, addr] of Object.entries(expected)) {
    const actual = s[k as keyof typeof expected];
    if (!b32(actual) || actual.toLowerCase() !== toBytes32(addr))
      throw new Error("withdrawal identity mismatch");
  }
  const typed = withdrawTypedData(b),
    signer = await recoverTypedDataAddress({
      ...typed,
      signature: request.signature,
    });
  if (getAddress(signer) !== from)
    throw new Error("withdrawal signer mismatch");
  return {
    id: hashTypedData(typed),
    request,
    owner: from,
    recipient,
    amountMicros: s.value,
  };
}
