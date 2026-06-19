/**
 * indexer — a minimal, framework-agnostic event poller for SourceRegistry.
 *
 * Polls Arc RPC for SourceRegistered / SourceUpdated / SourceDeactivated logs in block chunks and
 * hands each decoded event to your `onEvent` callback. You decide where to persist (DB, KV, memory)
 * and where to checkpoint `fromBlock`. Returns the next block to resume from.
 *
 * Why poll instead of subscribe: works over plain HTTP RPC (no websocket needed), and chunked
 * backfill from the deploy block is restart-safe — checkpoint the returned block and you never
 * miss or double-process a log.
 */
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC } from "../arc.js";

export type RegistryEvent =
  | { type: "registered"; id: Hex; creator: Address; contentCid: string; block: bigint }
  | { type: "updated"; id: Hex; updater: Address; block: bigint }
  | { type: "deactivated"; id: Hex; block: bigint };

const EVENTS = {
  registered: parseAbiItem("event SourceRegistered(bytes32 indexed id, address indexed creator, string contentCid)"),
  updated: parseAbiItem("event SourceUpdated(bytes32 indexed id, address indexed updater)"),
  deactivated: parseAbiItem("event SourceDeactivated(bytes32 indexed id)"),
} as const;

export interface IndexerOptions {
  address: Address;        // deployed SourceRegistry
  fromBlock: bigint;       // last processed block + 1 (or the deploy block on cold start)
  rpcUrl?: string;
  chunk?: bigint;          // blocks per getLogs call (default 500 — Arc-friendly)
  onEvent: (e: RegistryEvent) => Promise<void> | void;
}

/**
 * Sync from `fromBlock` to the current head, emitting every registry event in order.
 * Returns the block to use as the next `fromBlock`. Throws on RPC error so the caller can
 * retry the same chunk without advancing the checkpoint past unprocessed logs.
 */
export async function syncOnce(o: IndexerOptions): Promise<bigint> {
  const client = createPublicClient({ chain: arcTestnet, transport: http(o.rpcUrl ?? ARC.rpcUrl) });
  const chunk = o.chunk ?? 500n;
  const head = await client.getBlockNumber();
  let from = o.fromBlock;

  while (from <= head) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n;
    const [reg, upd, deact] = await Promise.all([
      client.getLogs({ address: o.address, event: EVENTS.registered, fromBlock: from, toBlock: to }),
      client.getLogs({ address: o.address, event: EVENTS.updated, fromBlock: from, toBlock: to }),
      client.getLogs({ address: o.address, event: EVENTS.deactivated, fromBlock: from, toBlock: to }),
    ]);

    const events: RegistryEvent[] = [
      ...reg.map((l) => ({ type: "registered" as const, id: l.args.id!, creator: l.args.creator!, contentCid: l.args.contentCid ?? "", block: l.blockNumber! })),
      ...upd.map((l) => ({ type: "updated" as const, id: l.args.id!, updater: l.args.updater!, block: l.blockNumber! })),
      ...deact.map((l) => ({ type: "deactivated" as const, id: l.args.id!, block: l.blockNumber! })),
    ].sort((a, b) => Number(a.block - b.block));

    for (const e of events) await o.onEvent(e);
    from = to + 1n;
  }
  return from; // persist this as the next fromBlock
}
