import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { formatUsdc } from "../amounts.js";
import { getRegistrySource, sourceId } from "./registry-client.js";

export interface RegistrySelection {
  /** Original SourceRegistry deployment selected by the host, never a default/global replacement. */
  readonly registryAddress: Address;
  /** Host-authenticated creator and exact canonical URL used at registration. */
  readonly creator: Address;
  readonly canonicalUrl: string;
  readonly rpcUrl?: string;
}

export interface RegistryPaymentTerms {
  readonly registryAddress: Address;
  readonly sourceId: Hex;
  readonly creator: Address;
  readonly payTo: Address;
  readonly amountMicros: bigint;
  readonly priceUsdc: string;
}

/** Read the selected original-version registry on Arc testnet. Missing, inactive,
 * wrong-creator or unavailable records fail closed; no database/cache fallback.
 * Ownership verification, RPC trust/freshness and freezing terms into the host's
 * durable nonce admission before signing remain host responsibilities. */
export async function getRegistryPaymentTerms(
  selection: RegistrySelection,
): Promise<Readonly<RegistryPaymentTerms>> {
  const registryAddress = getAddress(selection.registryAddress);
  const creator = getAddress(selection.creator);
  const canonicalUrl = selection.canonicalUrl,
    rpcUrl = selection.rpcUrl;
  if (
    registryAddress === zeroAddress ||
    creator === zeroAddress ||
    typeof canonicalUrl !== "string" ||
    !canonicalUrl.trim()
  )
    throw new Error("registry, creator and canonical URL required");
  const id = sourceId(creator, canonicalUrl);
  const record = await getRegistrySource(registryAddress, id, rpcUrl);
  if (
    !record ||
    record.active !== true ||
    getAddress(record.creator) !== creator
  )
    throw new Error("selected creator has no active registry record");
  const payTo = getAddress(record.payoutWallet),
    amountMicros = record.fetchPriceUsdc6;
  if (
    payTo === zeroAddress ||
    typeof amountMicros !== "bigint" ||
    amountMicros < 0n ||
    amountMicros > 2n ** 64n - 1n
  )
    throw new Error("invalid registry payment terms");
  return Object.freeze({
    registryAddress,
    sourceId: id,
    creator,
    payTo,
    amountMicros,
    priceUsdc: formatUsdc(amountMicros),
  });
}
