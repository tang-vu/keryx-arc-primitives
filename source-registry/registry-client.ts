/**
 * registry-client — viem read helpers + ID derivation + write-call encoders for SourceRegistry.
 *
 * Standalone: pass the deployed `address` + `rpcUrl` in; no app config required. Write calls are
 * encoder-only (they return args for wagmi's useWriteContract / a walletClient) — this module never
 * holds a private key. All writes are creator-signed; the creator pays gas.
 *
 * ID derivation (matches the contract):
 *   urlHash  = keccak256(toBytes(canonicalUrl))
 *   sourceId = keccak256(abi.encode(creator, urlHash))   ← creator-bound, squat-proof
 */
import {
  createPublicClient, http, keccak256, toBytes, encodeAbiParameters, parseAbiParameters,
  type Hex, type Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import { ARC } from "../arc.js";

export const REGISTRY_ABI = [
  { name: "register", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "urlHash", type: "bytes32" }, { name: "payoutWallet", type: "address" },
    { name: "authors", type: "tuple[]", components: [{ name: "wallet", type: "address" }, { name: "basisPoints", type: "uint16" }] },
    { name: "fetchPriceUsdc6", type: "uint64" }, { name: "contentCid", type: "string" }, { name: "tags", type: "string" }], outputs: [] },
  { name: "update", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "bytes32" }, { name: "payoutWallet", type: "address" },
    { name: "authors", type: "tuple[]", components: [{ name: "wallet", type: "address" }, { name: "basisPoints", type: "uint16" }] },
    { name: "fetchPriceUsdc6", type: "uint64" }, { name: "contentCid", type: "string" }, { name: "tags", type: "string" }], outputs: [] },
  { name: "deactivate", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { name: "get", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [
    { name: "", type: "tuple", components: [
      { name: "creator", type: "address" }, { name: "payoutWallet", type: "address" },
      { name: "authors", type: "tuple[]", components: [{ name: "wallet", type: "address" }, { name: "basisPoints", type: "uint16" }] },
      { name: "fetchPriceUsdc6", type: "uint64" }, { name: "contentCid", type: "string" }, { name: "tags", type: "string" }, { name: "active", type: "bool" }] }] },
  { name: "sourceCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "SourceRegistered", type: "event", inputs: [
    { name: "id", type: "bytes32", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "contentCid", type: "string", indexed: false }] },
  { name: "SourceUpdated", type: "event", inputs: [{ name: "id", type: "bytes32", indexed: true }, { name: "updater", type: "address", indexed: true }] },
  { name: "SourceDeactivated", type: "event", inputs: [{ name: "id", type: "bytes32", indexed: true }] },
] as const;

/** keccak256(toBytes(canonicalUrl)) — the `urlHash` param passed to register() (NOT the full id). */
export function urlHash(url: string): Hex {
  return keccak256(toBytes(url));
}

/** Full on-chain bytes32 id = keccak256(abi.encode(creator, urlHash)). Creator-bound ⇒ squat-proof. */
export function sourceId(creator: Address, url: string): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("address, bytes32"), [creator, urlHash(url)]));
}

export type OnChainRecord = {
  creator: Address; payoutWallet: Address;
  authors: ReadonlyArray<{ wallet: Address; basisPoints: number }>;
  fetchPriceUsdc6: bigint; contentCid: string; tags: string; active: boolean;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/** Read a single record. Returns null if the source doesn't exist. Throws on RPC errors. */
export async function getRegistrySource(address: Address, id: Hex, rpcUrl = ARC.rpcUrl): Promise<OnChainRecord | null> {
  const client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  const record = await client.readContract({ address, abi: REGISTRY_ABI, functionName: "get", args: [id] });
  if ((record as OnChainRecord).creator === ZERO) return null;
  return record as OnChainRecord;
}

// ── write-call encoders (for wagmi useWriteContract / a viem walletClient) ──

export interface AuthorSplitInput { wallet: Address; basisPoints: number; } // sum to 10_000

export function buildRegisterArgs(address: Address, p: {
  urlHash: Hex; payoutWallet: Address; authors: AuthorSplitInput[]; fetchPriceUsdc6: bigint; contentCid: string; tags: string;
}) {
  return { address, abi: REGISTRY_ABI, functionName: "register" as const,
    args: [p.urlHash, p.payoutWallet, p.authors, p.fetchPriceUsdc6, p.contentCid, p.tags] as const };
}

export function buildUpdateArgs(address: Address, p: {
  id: Hex; payoutWallet: Address; authors: AuthorSplitInput[]; fetchPriceUsdc6: bigint; contentCid: string; tags: string;
}) {
  return { address, abi: REGISTRY_ABI, functionName: "update" as const,
    args: [p.id, p.payoutWallet, p.authors, p.fetchPriceUsdc6, p.contentCid, p.tags] as const };
}

export function buildDeactivateArgs(address: Address, id: Hex) {
  return { address, abi: REGISTRY_ABI, functionName: "deactivate" as const, args: [id] as const };
}
