import { describe, it, expect, vi } from "vitest";
import {
  settleThenServe,
  buildRequirements,
  type SellerJournal,
  type PaymentPayload,
} from "../x402-two-toll/seller.js";
import { ARC } from "../arc.js";
const payer = "0x1111111111111111111111111111111111111111",
  payTo = "0x2222222222222222222222222222222222222222";
const opts = {
  priceUsdc: "0.004",
  payTo,
  resourceUrl: "https://example.test/paid",
};
function fixtures() {
  const payload = {
    x402Version: 2,
    resource: {
      url: opts.resourceUrl,
      description: "paid",
      mimeType: "application/json",
    },
    accepted: buildRequirements(opts),
    payload: {
      authorization: {
        from: payer,
        to: payTo,
        value: "4000",
        nonce: `0x${"a".repeat(64)}`,
        validAfter: "0",
        validBefore: "9999999999",
      },
      signature: `0x${"b".repeat(130)}`,
    },
  };
  const facilitator = {
    verify: vi.fn(async () => ({ isValid: true, payer })),
    settle: vi.fn(async () => ({
      success: true,
      payer,
      network: ARC.networkId as string,
      transaction: "circle-transfer-id",
    })),
  };
  const journal: SellerJournal = {
    claim: vi.fn(async () => true),
    submitted: vi.fn(async () => {}),
    settled: vi.fn(async () => {}),
  };
  const encode = (p: unknown = payload) =>
    Buffer.from(JSON.stringify(p)).toString("base64");
  return { payload, facilitator, journal, encode };
}
describe("seller admission and evidence", () => {
  it.each([null, { isValid: "true", payer }, { isValid: 1, payer }])(
    "rejects malformed verification response %j",
    async (response) => {
      const f = fixtures();
      f.facilitator.verify.mockResolvedValue(response as never);
      expect((await settleThenServe(f.encode(), opts, () => 1, f)).status).toBe(
        402,
      );
      expect(f.journal.claim).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { success: "true", payer, network: ARC.networkId, transaction: "id" },
    { success: true, payer, network: ARC.networkId, transaction: {} },
    { success: true, payer, network: ARC.networkId, transaction: "   " },
  ])("retains malformed settlement response %j", async (response) => {
    const f = fixtures();
    f.facilitator.settle.mockResolvedValue(response as never);
    expect((await settleThenServe(f.encode(), opts, () => 1, f)).status).toBe(
      202,
    );
    expect(f.journal.settled).not.toHaveBeenCalled();
  });

  it("advertises testnet/exact micro-USDC without dependencies or effects", async () => {
    const result = await settleThenServe(null, opts, () => {
      throw new Error("unpaid");
    });
    expect(result.status).toBe(402);
    expect(
      JSON.parse(
        Buffer.from(result.headers["PAYMENT-REQUIRED"]!, "base64").toString(),
      ).accepts[0],
    ).toMatchObject({ network: ARC.networkId, amount: "4000" });
    expect(() => buildRequirements({ ...opts, priceUsdc: "0" })).toThrow();
    expect(() =>
      buildRequirements({ ...opts, priceUsdc: 0.004 as never }),
    ).toThrow();
  });
  it("requires a durable journal on paid requests", async () => {
    const f = fixtures();
    await expect(settleThenServe(f.encode(), opts, () => 1)).rejects.toThrow(
      "journal",
    );
  });
  it.each([
    "network",
    "asset",
    "payTo",
    "amount",
    "maxTimeoutSeconds",
    "verifyingContract",
    "resource",
    "value",
    "nonce",
    "from",
  ])("rejects mismatched %s before verification", async (field) => {
    const f = fixtures(),
      p = f.payload;
    if (field === "verifyingContract")
      p.accepted.extra.verifyingContract = payer as typeof ARC.gatewayWallet;
    else if (field === "resource") p.resource.url = "https://other.test";
    else if (["value", "nonce", "from"].includes(field))
      (p.payload.authorization as Record<string, unknown>)[field] = "wrong";
    else (p.accepted as Record<string, unknown>)[field] = "wrong";
    expect((await settleThenServe(f.encode(), opts, () => 1, f)).status).toBe(
      400,
    );
    expect(f.facilitator.verify).not.toHaveBeenCalled();
  });
  it("normalizes the browser inner shape, journals before effect, delivers after persisted evidence", async () => {
    const f = fixtures(),
      events: string[] = [];
    f.journal.claim = vi.fn(async () => {
      events.push("claim");
      return true;
    });
    f.journal.submitted = vi.fn(async () => {
      events.push("submitted");
    });
    f.facilitator.settle = vi.fn(async () => {
      events.push("settle");
      return {
        success: true,
        payer,
        network: ARC.networkId,
        transaction: "id",
      };
    });
    f.journal.settled = vi.fn(async () => {
      events.push("evidence");
    });
    const result = await settleThenServe(
      f.encode(f.payload.payload),
      opts,
      (info) => {
        events.push("produce");
        expect(info.amountMicros).toBe("4000");
        return "body";
      },
      f,
    );
    expect(result.status).toBe(200);
    expect(events).toEqual([
      "claim",
      "submitted",
      "settle",
      "evidence",
      "produce",
    ]);
  });
  it("holds a lost settlement response, never retries or delivers", async () => {
    const f = fixtures(),
      produce = vi.fn();
    f.facilitator.settle.mockRejectedValue(new Error("response lost"));
    const result = await settleThenServe(f.encode(), opts, produce, f);
    expect(result).toMatchObject({ status: 202, body: { state: "pending" } });
    expect(f.facilitator.settle).toHaveBeenCalledTimes(1);
    expect(produce).not.toHaveBeenCalled();
    expect(f.journal.settled).not.toHaveBeenCalled();
  });
  it.each(["verify", "settle"])(
    "handles malformed %s payer without throwing",
    async (stage) => {
      const f = fixtures();
      if (stage === "verify")
        f.facilitator.verify.mockResolvedValue({
          isValid: true,
          payer: "malformed",
        });
      else
        f.facilitator.settle.mockResolvedValue({
          success: true,
          payer: "malformed",
          network: ARC.networkId,
          transaction: "id",
        });
      expect((await settleThenServe(f.encode(), opts, () => 1, f)).status).toBe(
        stage === "verify" ? 402 : 202,
      );
    },
  );
  it("refuses a retained duplicate authorization before resubmission", async () => {
    const f = fixtures();
    vi.mocked(f.journal.claim).mockResolvedValue(false);
    expect((await settleThenServe(f.encode(), opts, () => 1, f)).status).toBe(
      409,
    );
    expect(f.facilitator.settle).not.toHaveBeenCalled();
  });
  it.each(["claim", "submitted", "settled"])(
    "fails closed when %s acknowledgement is lost",
    async (stage) => {
      const f = fixtures(),
        produce = vi.fn();
      vi.mocked(f.journal[stage as keyof SellerJournal]).mockRejectedValue(
        new Error("storage lost"),
      );
      const result = await settleThenServe(f.encode(), opts, produce, f);
      expect(result.status).toBe(stage === "settled" ? 202 : 503);
      expect(produce).not.toHaveBeenCalled();
      if (stage !== "settled")
        expect(f.facilitator.settle).not.toHaveBeenCalled();
      else expect(result.headers["PAYMENT-RESPONSE"]).toBeTruthy();
    },
  );
  it.each(["negative", "wrong-network", "empty-id"])(
    "retains %s response as uncertain",
    async (kind) => {
      const f = fixtures();
      f.facilitator.settle.mockResolvedValue({
        success: kind !== "negative",
        payer,
        network: kind === "wrong-network" ? "eip155:1" : ARC.networkId,
        transaction: kind === "empty-id" ? "" : "id",
      });
      expect((await settleThenServe(f.encode(), opts, () => 1, f)).status).toBe(
        202,
      );
      expect(f.journal.settled).not.toHaveBeenCalled();
    },
  );
  it("keeps confirmed debit evidence when the producer fails", async () => {
    const f = fixtures(),
      result = await settleThenServe(
        f.encode(),
        opts,
        () => {
          throw new Error("delivery");
        },
        f,
      );
    expect(result).toMatchObject({
      status: 502,
      body: { state: "settled-undelivered" },
    });
    expect(
      JSON.parse(
        Buffer.from(result.headers["PAYMENT-RESPONSE"]!, "base64").toString(),
      ).success,
    ).toBe(true);
    expect(f.journal.settled).toHaveBeenCalledOnce();
  });
});
