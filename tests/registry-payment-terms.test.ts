import { beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress, type Address } from "viem";
const mock = vi.hoisted(() => ({
  chain: 5042002,
  readContract: vi.fn(),
  client: vi.fn(),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: (options: unknown) => {
    mock.client(options);
    return {
      getChainId: async () => mock.chain,
      readContract: mock.readContract,
    };
  },
}));
import { ARC } from "../arc.js";
import {
  sourceId,
  type OnChainRecord,
} from "../source-registry/registry-client.js";
import { getRegistryPaymentTerms } from "../source-registry/payment-terms.js";

const creator = "0x1111111111111111111111111111111111111111" as Address;
const payee = "0x2222222222222222222222222222222222222222" as Address;
const registry = "0x3333333333333333333333333333333333333333" as Address;
const selection = {
  creator,
  registryAddress: registry,
  canonicalUrl: "https://example.test/feed",
};
const record = (): OnChainRecord => ({
  creator,
  payoutWallet: payee,
  authors: [{ wallet: creator, basisPoints: 10_000 }],
  fetchPriceUsdc6: 4000n,
  contentCid: "ipfs://synthetic",
  tags: "test",
  active: true,
});

describe("creator-bound active registry payment terms", () => {
  beforeEach(() => {
    mock.chain = ARC.chainId;
    mock.readContract.mockReset().mockResolvedValue(record());
    mock.client.mockClear();
  });
  it("pins the original deployment and derives payee and exact amount from its active creator record", async () => {
    const result = await getRegistryPaymentTerms(selection);
    expect(mock.readContract).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        address: registry,
        functionName: "get",
        args: [sourceId(creator, selection.canonicalUrl)],
      }),
    );
    expect(result).toEqual({
      registryAddress: registry,
      sourceId: sourceId(creator, selection.canonicalUrl),
      creator,
      payTo: payee,
      amountMicros: 4000n,
      priceUsdc: "0.004000",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("snapshots caller selection before asynchronous reads", async () => {
    const mutable = { ...selection };
    const pending = getRegistryPaymentTerms(mutable);
    mutable.registryAddress = payee;
    mutable.creator = payee;
    mutable.canonicalUrl = "https://attacker.invalid";
    expect(await pending).toMatchObject({
      registryAddress: registry,
      creator,
      sourceId: sourceId(creator, selection.canonicalUrl),
    });
  });
  it.each([
    { creator: zeroAddress },
    { active: false },
    { creator: payee },
    { payoutWallet: zeroAddress },
    { fetchPriceUsdc6: -1n },
    { fetchPriceUsdc6: 2n ** 64n },
  ])(
    "refuses missing/inactive/foreign or malformed authority case %#",
    async (patch) => {
      mock.readContract.mockResolvedValue({ ...record(), ...patch });
      await expect(getRegistryPaymentTerms(selection)).rejects.toThrow();
    },
  );
  it("does not substitute cached terms on RPC loss", async () => {
    mock.readContract.mockRejectedValue(new Error("RPC unavailable"));
    await expect(getRegistryPaymentTerms(selection)).rejects.toThrow(
      "RPC unavailable",
    );
    expect(mock.readContract).toHaveBeenCalledOnce();
  });
  it("refuses another network before reading registry state", async () => {
    mock.chain = 5042;
    await expect(getRegistryPaymentTerms(selection)).rejects.toThrow(
      "Arc testnet",
    );
    expect(mock.readContract).not.toHaveBeenCalled();
  });
  it.each([
    { registryAddress: zeroAddress },
    { creator: zeroAddress },
    { canonicalUrl: " " },
  ])("refuses invalid selection before I/O: %j", async (patch) => {
    await expect(
      getRegistryPaymentTerms({ ...selection, ...patch }),
    ).rejects.toThrow();
    expect(mock.client).not.toHaveBeenCalled();
  });
  it("preserves zero/free and maximum uint64 amounts exactly for host policy", async () => {
    for (const amount of [0n, 2n ** 64n - 1n]) {
      mock.readContract.mockResolvedValue({
        ...record(),
        fetchPriceUsdc6: amount,
      });
      const result = await getRegistryPaymentTerms(selection);
      expect(result.amountMicros).toBe(amount);
      expect(result.priceUsdc).toBe(
        amount === 0n ? "0.000000" : "18446744073709.551615",
      );
    }
  });
});
