/**
 * x402 buyer — the paying side. A thin wrapper over Circle's GatewayClient so an agent can pay a
 * toll (fixed or dynamic) in one call. Returns the settlement result, including `transaction`
 * (a Circle Gateway transfer id — NOT an EVM tx hash; see README "On-chain proof").
 */
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { ARC } from "../arc.js";

export interface BuyerOptions {
  privateKey: `0x${string}`;   // the agent's funded spend wallet
  rpcUrl?: string;
  chain?: SupportedChainName;
}

export function makeBuyer(o: BuyerOptions): GatewayClient {
  return new GatewayClient({
    chain: o.chain ?? (ARC.viemChainName as SupportedChainName),
    privateKey: o.privateKey,
    rpcUrl: o.rpcUrl ?? ARC.rpcUrl,
  });
}

/** Pay a FIXED-price toll (GET). The seller's 402 challenge dictates the amount. */
export async function payToll<T = unknown>(buyer: GatewayClient, url: string) {
  return buyer.pay<T>(url);
}

/**
 * Pay a DYNAMIC-price endpoint (POST). The seller computes the price per request (e.g. a
 * contribution-weighted citation reward encoded in the query/body) and returns a matching
 * 402 challenge; GatewayClient.pay authorizes exactly that amount.
 */
export async function payDynamic<T = unknown>(buyer: GatewayClient, url: string, body?: unknown) {
  return buyer.pay<T>(url, { method: "POST", body });
}

/** One-time: deposit USDC into the Gateway balance the buyer settles from. */
export async function fund(buyer: GatewayClient, usdc: string) {
  return buyer.deposit(usdc);
}
