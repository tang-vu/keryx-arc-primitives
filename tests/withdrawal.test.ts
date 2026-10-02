import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  pad,
  zeroAddress,
  encodePacked,
  concatHex,
  keccak256,
  type Hex,
  type WalletClient,
} from "viem";
const mock = vi.hoisted(() => ({
  chain: 5042002,
  head: 10n,
  simulate: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
  send: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({
    getChainId: async () => mock.chain,
    getBlockNumber: async () => mock.head,
    simulateContract: mock.simulate,
    sendRawTransaction: mock.send,
    waitForTransactionReceipt: mock.receipt,
  }),
  createWalletClient: () => ({
    prepareTransactionRequest: mock.prepare,
    signTransaction: mock.sign,
  }),
}));
import { ARC } from "../arc.js";
import {
  buildAndSignWithdrawIntent,
  verifyWithdrawIntent,
  withdrawTypedData,
  type SignedWithdrawIntent,
} from "../gasless-cashout/withdraw-intent.js";
import {
  relayGaslessWithdraw,
  matchMintAttestation,
  type RelayJournal,
  type RelayOpts,
} from "../gasless-cashout/relay.js";
const owner = privateKeyToAccount(`0x${"1".repeat(64)}`),
  treasuryKey = `0x${"2".repeat(64)}` as Hex,
  treasury = privateKeyToAccount(treasuryKey),
  other = privateKeyToAccount(`0x${"3".repeat(64)}`);
const policy = {
  owner: owner.address,
  recipient: owner.address,
  maxValueMicros: 1_000_000n,
  maxFeeMicros: 10_000n,
  maxBlockHeight: 1000n,
};
async function signed() {
  return buildAndSignWithdrawIntent(
    {
      account: owner,
      signTypedData: (data: Parameters<typeof owner.signTypedData>[0]) =>
        owner.signTypedData(data),
    } as unknown as WalletClient,
    500_000n,
    { maxFeeUsdc: "0.01", maxBlockHeight: 1000n },
  );
}
function attestation(request: SignedWithdrawIntent) {
  const s = request.burnIntent.spec;
  const spec = concatHex([
    encodePacked(
      ["bytes4", "uint32", "uint32", "uint32"],
      ["0xca85def7", s.version, s.sourceDomain, s.destinationDomain],
    ),
    s.sourceContract,
    s.destinationContract,
    s.sourceToken,
    s.destinationToken,
    s.sourceDepositor,
    s.destinationRecipient,
    s.sourceSigner,
    s.destinationCaller,
    encodePacked(
      ["uint256", "bytes32", "uint32"],
      [BigInt(s.value), s.salt, 0],
    ),
  ]);
  return {
    transferId: "11111111-2222-3333-4444-555555555555",
    attestation: concatHex([
      encodePacked(["bytes4", "uint256", "uint32"], ["0xff6fb334", 100n, 340]),
      spec,
    ]),
    signature: `0x${"a".repeat(130)}` as Hex,
    expirationBlock: "100",
  };
}
async function fixtures() {
  const request = await signed(),
    journal: RelayJournal = {
      claim: vi.fn(async () => true),
      submitted: vi.fn(async () => {}),
      attested: vi.fn(async () => {}),
      mintPrepared: vi.fn(async () => {}),
      confirmed: vi.fn(async () => {}),
    };
  const opts: RelayOpts = {
    ...request,
    treasuryKey,
    policy,
    journal,
    maxGasCostAtomic: 1000n,
  };
  const response = attestation(request);
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);
  return { request, journal, opts, response, fetchMock };
}
beforeEach(() => {
  mock.chain = 5042002;
  mock.head = 10n;
  mock.simulate.mockReset().mockResolvedValue({});
  mock.prepare
    .mockReset()
    .mockResolvedValue({ chainId: 5042002, gas: 10n, maxFeePerGas: 1n });
  mock.sign.mockReset().mockResolvedValue("0xabcd");
  mock.send.mockReset().mockResolvedValue(keccak256("0xabcd"));
  mock.receipt.mockReset().mockResolvedValue({
    status: "success",
    transactionHash: keccak256("0xabcd"),
    to: ARC.gatewayMinter,
    from: treasury.address,
  });
});
describe("signed withdrawal binding", () => {
  it("recovers signer and binds same-chain contracts, owner and recipient", async () => {
    const request = await signed(),
      verified = await verifyWithdrawIntent(request, policy);
    expect(verified.owner).toBe(owner.address);
    expect(verified.id).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it.each([
    "owner",
    "recipient",
    "token",
    "domain",
    "caller",
    "padding",
    "fee",
    "value",
    "signature",
    "extra",
  ])("rejects altered %s before effects", async (field) => {
    const request = await signed();
    const s = request.burnIntent.spec;
    if (field === "owner") s.sourceDepositor = pad(other.address, { size: 32 });
    if (field === "recipient")
      s.destinationRecipient = pad(other.address, { size: 32 });
    if (field === "token") s.sourceToken = pad(other.address, { size: 32 });
    if (field === "domain") s.destinationDomain = 1;
    if (field === "caller")
      s.destinationCaller = pad(owner.address, { size: 32 });
    if (field === "padding")
      s.sourceSigner = `0x${"1".repeat(24)}${owner.address.slice(2)}`;
    if (field === "fee") request.burnIntent.maxFee = "10001";
    if (field === "value") s.value = "1000001";
    if (field === "signature")
      request.signature = await other.signTypedData(
        withdrawTypedData(request.burnIntent),
      );
    if (field === "extra")
      (s as unknown as Record<string, unknown>).extra = true;
    await expect(verifyWithdrawIntent(request, policy)).rejects.toThrow();
  });
  it("matches exact binary TransferSpec and rejects unrelated/extra attestations", async () => {
    const request = await signed(),
      v = await verifyWithdrawIntent(request, policy),
      a = attestation(request);
    expect(matchMintAttestation(v, a).transferId).toBe(a.transferId);
    const altered = structuredClone(request);
    altered.burnIntent.spec.value = "499999";
    expect(() => matchMintAttestation(v, attestation(altered))).toThrow();
    expect(() =>
      matchMintAttestation(v, {
        ...a,
        attestation: concatHex([
          "0x1e12db71",
          "0x00000002",
          a.attestation,
          a.attestation,
        ]),
      }),
    ).toThrow();
  });
});
describe("durable gasless relay", () => {
  it("rejects invalid signatures and missing gas policy before effects", async () => {
    const f = await fixtures();
    await expect(
      relayGaslessWithdraw({ ...f.opts, signature: "0x00" }),
    ).rejects.toMatchObject({ status: 400, state: "unsubmitted" });
    await expect(
      relayGaslessWithdraw({ ...f.opts, maxGasCostAtomic: undefined as never }),
    ).rejects.toMatchObject({ status: 400, state: "unsubmitted" });
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it("rejects expired or over-policy block heights before admission", async () => {
    const f = await fixtures();
    await expect(
      relayGaslessWithdraw({
        ...f.opts,
        policy: { ...policy, maxBlockHeight: 999n },
      }),
    ).rejects.toMatchObject({ status: 400, state: "unsubmitted" });
    mock.head = 1000n;
    await expect(relayGaslessWithdraw(f.opts)).rejects.toMatchObject({
      status: 400,
      state: "unsubmitted",
    });
    expect(f.journal.claim).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it.each(["claim", "submitted"])(
    "retains %s acknowledgement loss before Circle",
    async (stage) => {
      const f = await fixtures();
      vi.mocked(f.journal[stage as "claim" | "submitted"]).mockRejectedValue(
        new Error("lost"),
      );
      await expect(relayGaslessWithdraw(f.opts)).rejects.toMatchObject({
        status: 503,
        state: "retained",
      });
      expect(f.fetchMock).not.toHaveBeenCalled();
    },
  );

  it("requires journal and testnet RPC before any transfer", async () => {
    const f = await fixtures();
    await expect(
      relayGaslessWithdraw({ ...f.opts, journal: undefined as never }),
    ).rejects.toThrow("journal");
    mock.chain = 1;
    await expect(relayGaslessWithdraw(f.opts)).rejects.toThrow("Arc testnet");
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it("records original request/submission/attestation/prepared hash before effect and confirms exact receipt", async () => {
    const f = await fixtures(),
      events: string[] = [];
    f.journal.submitted = async () => {
      events.push("submitted");
    };
    f.fetchMock.mockImplementation(async () => {
      events.push("transfer");
      return { ok: true, json: async () => f.response };
    });
    f.journal.mintPrepared = async (_id, raw, hash) => {
      events.push("prepared");
      expect(hash).toBe(keccak256(raw));
    };
    mock.send.mockImplementation(async () => {
      events.push("broadcast");
      return keccak256("0xabcd");
    });
    expect((await relayGaslessWithdraw(f.opts)).amountMicros).toBe("500000");
    expect(events).toEqual(["submitted", "transfer", "prepared", "broadcast"]);
    expect(f.journal.confirmed).toHaveBeenCalledOnce();
  });
  it("refuses duplicate admission without Circle or treasury effects", async () => {
    const f = await fixtures();
    vi.mocked(f.journal.claim).mockResolvedValue(false);
    await expect(relayGaslessWithdraw(f.opts)).rejects.toMatchObject({
      state: "retained",
    });
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    "transfer",
    "attested",
    "prepared",
    "broadcast",
    "receipt",
    "confirmed",
  ])("retains %s acknowledgement loss and never resubmits", async (stage) => {
    const f = await fixtures();
    const error = new Error("lost");
    if (stage === "transfer") f.fetchMock.mockRejectedValue(error);
    if (stage === "attested")
      vi.mocked(f.journal.attested).mockRejectedValue(error);
    if (stage === "prepared")
      vi.mocked(f.journal.mintPrepared).mockRejectedValue(error);
    if (stage === "broadcast") mock.send.mockRejectedValue(error);
    if (stage === "receipt") mock.receipt.mockRejectedValue(error);
    if (stage === "confirmed")
      vi.mocked(f.journal.confirmed).mockRejectedValue(error);
    await expect(relayGaslessWithdraw(f.opts)).rejects.toMatchObject({
      status: 202,
      state: "pending",
    });
    expect(f.fetchMock).toHaveBeenCalledOnce();
    expect(mock.send.mock.calls.length).toBeLessThanOrEqual(1);
    if (stage === "prepared") expect(mock.send).not.toHaveBeenCalled();
  });
  it("blocks gas cap before signing/broadcast while retaining Circle transfer", async () => {
    const f = await fixtures();
    mock.prepare.mockResolvedValue({
      chainId: 5042002,
      gas: 1001n,
      maxFeePerGas: 1n,
    });
    await expect(relayGaslessWithdraw(f.opts)).rejects.toMatchObject({
      state: "pending",
    });
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it.each(["hash", "to", "from", "reverted"])(
    "never confirms a successful replacement or wrong receipt %s",
    async (field) => {
      const f = await fixtures(),
        receipt = {
          status: "success",
          transactionHash: keccak256("0xabcd"),
          to: ARC.gatewayMinter as string,
          from: treasury.address as string,
        };
      if (field === "hash") receipt.transactionHash = keccak256("0xdead");
      if (field === "to") receipt.to = zeroAddress;
      if (field === "from") receipt.from = owner.address;
      if (field === "reverted") receipt.status = "reverted";
      mock.receipt.mockResolvedValue(receipt);
      await expect(relayGaslessWithdraw(f.opts)).rejects.toMatchObject({
        state: "pending",
        mintTxHash: keccak256("0xabcd"),
      });
      expect(f.journal.confirmed).not.toHaveBeenCalled();
    },
  );
});
