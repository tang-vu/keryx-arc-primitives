import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkPaidText,
  selectPlaintextCommitment,
} from "../x402-two-toll/paid-content.js";

const body = "Paid text — tiếng Việt 🦜\n";
const bodyHash = `0x${createHash("sha256").update(body, "utf8").digest("hex")}`;
const plaintextBytes = Buffer.byteLength(body, "utf8");

describe("selected plaintext commitments", () => {
  it("snapshots explicit item and manifest commitments before I/O", () => {
    const item = { bodyHash: bodyHash.toUpperCase(), plaintextBytes };
    const selected = selectPlaintextCommitment(item, { bodyHash });
    item.bodyHash = `0x${"0".repeat(64)}`;
    item.plaintextBytes = 1;
    expect(selected).toEqual({ bodyHash, plaintextBytes });
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it.each([
    [{ bodyHash: "bad" }],
    [{ bodyHash }, { bodyHash: `0x${"0".repeat(64)}` }],
    [{ plaintextBytes: 1 }, { plaintextBytes: 2 }],
    [{ plaintextBytes: -1 }],
    [{ plaintextBytes: 0.5 }],
    [{ plaintextBytes: Number.MAX_SAFE_INTEGER + 1 }],
    [{ plaintextBytes: Number.NaN }],
  ])(
    "refuses malformed/conflicting commitments before spending: %j",
    (...inputs) => {
      expect(() => selectPlaintextCommitment(...inputs)).toThrow();
    },
  );
  it("leaves absent legacy commitments absent rather than inferring preview bytes", () => {
    expect(selectPlaintextCommitment(undefined, {})).toEqual({});
  });
});

describe("paid text delivery is separate from debit evidence", () => {
  it("hashes hex-looking text as UTF-8 rather than decoding it as binary", () => {
    const text = "0x6869";
    const hash = `0x${createHash("sha256").update(text, "utf8").digest("hex")}`;
    expect(
      checkPaidText(text, { bodyHash: hash, plaintextBytes: 6 }, null)
        .delivered,
    ).toBe(true);
  });
  it("matches upstream SHA-256 and exact UTF-8 bytes without trimming the body", () => {
    const payment = Object.freeze({
      state: "settled",
      originalId: "synthetic-original",
    });
    const result = checkPaidText(
      body,
      selectPlaintextCommitment({ bodyHash, plaintextBytes }),
      payment,
    );
    expect(result).toEqual({ delivered: true, body, payment });
    expect(result.payment).toBe(payment);
    expect(plaintextBytes).toBeGreaterThan(body.length);
  });
  it.each(["settled", "pending"])(
    "retains the %s original on wrong hash or bytes and exposes no usable body",
    (state) => {
      const payment = Object.freeze({ state, nonce: "synthetic-nonce" });
      for (const commitment of [{ bodyHash }, { plaintextBytes: 1 }]) {
        const result = checkPaidText("different article", commitment, payment);
        expect(result.delivered).toBe(false);
        expect(result).not.toHaveProperty("body");
        expect(result.payment).toBe(payment);
        expect(payment.state).toBe(state);
      }
    },
  );
  it.each([undefined, null, {}, 1, "", " \n"])(
    "refuses unusable body %j even without legacy commitments",
    (value) => {
      const payment = { state: "pending" };
      expect(checkPaidText(value, {}, payment)).toEqual({
        delivered: false,
        reason: "paid body is missing, empty or not text",
        payment,
      });
    },
  );
  it("retains payment when a caller supplies a malformed commitment after debit", () => {
    const payment = { state: "settled" };
    expect(checkPaidText(body, { plaintextBytes: -1 }, payment)).toEqual({
      delivered: false,
      reason: "invalid plaintext commitment",
      payment,
    });
  });
  it("permits unlabeled legacy text without claiming publisher or settlement verification", () => {
    expect(checkPaidText(body, {}, null)).toEqual({
      delivered: true,
      body,
      payment: null,
    });
  });
});
