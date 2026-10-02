import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encodeAbiParameters,
  keccak256,
  toBytes,
  zeroAddress,
  type Hex,
} from "viem";
const mock = vi.hoisted(() => ({ head: 0n, chain: 5042002, getLogs: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({
    getChainId: async () => mock.chain,
    getBlockNumber: async () => mock.head,
    getLogs: mock.getLogs,
  }),
}));
import {
  sourceId,
  urlHash,
  buildRegisterArgs,
} from "../source-registry/registry-client.js";
import { syncOnce } from "../source-registry/indexer.js";
import {
  bazaarExtension,
  withBazaarInfo,
  settleWithDiscoveryFallback,
} from "../x402-discovery/discovery.js";
const a = "0x1111111111111111111111111111111111111111",
  b = "0x2222222222222222222222222222222222222222",
  id = `0x${"a".repeat(64)}` as Hex;
describe("creator-bound registry", () => {
  it("matches Solidity abi.encode creator/hash and never treats URL ownership as established", () => {
    const url = "https://example.test/feed";
    expect(urlHash(url)).toBe(keccak256(toBytes(url)));
    expect(sourceId(a, url)).toBe(
      keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }],
          [a, urlHash(url)],
        ),
      ),
    );
    expect(sourceId(a, url)).not.toBe(sourceId(b, url));
  });
  it("validates exact contract price/split/UTF8 bounds", () => {
    const input = {
      urlHash: id,
      payoutWallet: a as Hex,
      authors: [
        { wallet: a as Hex, basisPoints: 6000 },
        { wallet: b as Hex, basisPoints: 4000 },
      ],
      fetchPriceUsdc6: 4000n,
      contentCid: "ipfs://example",
      tags: "ai",
    };
    expect(buildRegisterArgs(a, input).args[3]).toBe(4000n);
    for (const invalid of [
      { ...input, payoutWallet: zeroAddress },
      { ...input, authors: [] },
      { ...input, authors: [{ wallet: a as Hex, basisPoints: 9999 }] },
      { ...input, fetchPriceUsdc6: 2n ** 64n },
      { ...input, contentCid: "\u00e9".repeat(65) },
      { ...input, tags: "a".repeat(257) },
    ])
      expect(() => buildRegisterArgs(a, invalid)).toThrow();
  });
});
describe("ordered at-least-once indexer", () => {
  beforeEach(() => {
    mock.chain = 5042002;
    mock.head = 1n;
    mock.getLogs.mockReset();
  });
  const log = (index: number, args: Record<string, unknown>) => ({
    blockNumber: 1n,
    transactionHash: id,
    logIndex: index,
    args,
  });
  function logs() {
    mock.getLogs.mockImplementation(async ({ event }) =>
      event.name === "SourceRegistered"
        ? [log(0, { id, creator: a, contentCid: "cid" })]
        : event.name === "SourceUpdated"
          ? [log(2, { id, updater: a })]
          : [log(1, { id })],
    );
  }
  it("preserves same-block transaction log order and stable duplicate identity", async () => {
    logs();
    const seen: string[] = [];
    const next = await syncOnce({
      address: a,
      fromBlock: 1n,
      onEvent: (e) => {
        seen.push(e.type);
        expect(e.transactionHash).toBe(id);
      },
    });
    expect(seen).toEqual(["registered", "deactivated", "updated"]);
    expect(next).toBe(2n);
  });
  it("never returns an advanced cursor after a partial callback failure; replay is explicit", async () => {
    logs();
    const apply = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("DB write"));
    await expect(
      syncOnce({ address: a, fromBlock: 1n, onEvent: apply }),
    ).rejects.toThrow("DB write");
    const replay = vi.fn();
    expect(await syncOnce({ address: a, fromBlock: 1n, onEvent: replay })).toBe(
      2n,
    );
    expect(replay.mock.calls[0]![0].logIndex).toBe(0);
  });
  it("rejects invalid chunks/wrong network before reading logs", async () => {
    await expect(
      syncOnce({ address: a, fromBlock: 1n, chunk: 0n, onEvent: () => {} }),
    ).rejects.toThrow();
    mock.chain = 1;
    await expect(
      syncOnce({ address: a, fromBlock: 1n, onEvent: () => {} }),
    ).rejects.toThrow("Arc testnet");
    expect(mock.getLogs).not.toHaveBeenCalled();
  });
});
describe("discovery is metadata, never authority to retry", () => {
  const discovery = {
    provider: { name: "example" },
    path: "/paid",
    method: "POST",
  };
  it("merges challenge metadata without mutation", () => {
    const original = { extensions: { other: true } };
    expect(withBazaarInfo(original, discovery).extensions).toMatchObject({
      ...original.extensions,
      ...bazaarExtension(discovery),
    });
    expect(original.extensions).toEqual({ other: true });
  });
  it("makes a single extended call on ambiguous failure", async () => {
    const call = vi.fn().mockRejectedValue(new Error("settled response lost"));
    await expect(
      settleWithDiscoveryFallback({}, discovery, call),
    ).rejects.toThrow("lost");
    expect(call).toHaveBeenCalledOnce();
  });
});
