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

import { pad, getAddress, parseUnits, maxUint256, zeroAddress, type WalletClient, type Hex } from "viem";
import { ARC } from "../arc";

/** TransferSpec + BurnIntent EIP-712 types, verbatim from the SDK. Do not reorder — the hash depends on it. */
const BURN_INTENT_TYPES = {
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
  /** USDC ceiling for Circle's withdraw fee (charged ON TOP of value). Default 2.01. */
  maxFeeUsdc?: number;
}

/** Address → left-padded bytes32 (matches the SDK's addressToBytes32). */
function toBytes32(addr: string): Hex {
  return pad(addr.toLowerCase() as Hex, { size: 32 });
}

/** Cryptographically-random 32-byte salt as hex. */
function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/**
 * Build a same-chain (Arc → Arc) burn intent for `valueAtomic` USDC, signed by the connected wallet.
 * sourceDepositor/sourceSigner are the signer's own address — Circle only mints against a balance the
 * signer actually owns.
 *
 * NOTE ON FULL-BALANCE WITHDRAWALS: Circle requires `available >= value + fee`, so a withdraw for the
 * ENTIRE available balance fails by exactly the fee. Reserve a fee margin from the amount before
 * calling this (e.g. value = availableAtomic - parseUnits("0.005", 6)). See README.
 *
 * @param walletClient - the connected wallet (e.g. wagmi useWalletClient)
 * @param valueAtomic  - amount to withdraw in atomic USDC units (6 decimals)
 */
export async function buildAndSignWithdrawIntent(
  walletClient: WalletClient,
  valueAtomic: bigint,
  opts: WithdrawIntentOpts = {},
): Promise<SignedWithdrawIntent> {
  const account = walletClient.account;
  if (!account) throw new Error("wallet has no account");
  const from = getAddress(account.address);
  const to = getAddress(opts.recipient ?? account.address);
  if (valueAtomic <= 0n) throw new Error("withdraw amount must be > 0");

  const domain = ARC.cctpDomain; // same source + destination domain (Arc → Arc)
  const maxFee = parseUnits((opts.maxFeeUsdc ?? 2.01).toFixed(6), 6);
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
  const message = { maxBlockHeight: maxUint256, maxFee, spec };

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
    maxBlockHeight: maxUint256.toString(),
    maxFee: maxFee.toString(),
    spec: { ...spec, value: valueAtomic.toString() },
  };
  return { burnIntent, signature };
}
