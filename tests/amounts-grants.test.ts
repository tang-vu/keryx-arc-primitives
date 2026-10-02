import { describe, it, expect } from "vitest";
import { parseUsdc, formatUsdc, allocateMicros } from "../amounts.js";
import { MemoryGrantStore } from "../browser-cosign/session-grant.js";
const signer = "0x1111111111111111111111111111111111111111";
describe("integer money", () => {
  it("parses and formats exact six-decimal amounts beyond Number precision", () => {
    expect(formatUsdc(parseUsdc("9007199254740993.000001"))).toBe(
      "9007199254740993.000001",
    );
  });
  it.each(["-1", "1e3", "NaN", "0.0000001", "01", ".5", "1."])(
    "rejects unsafe amount %s",
    (value) => expect(() => parseUsdc(value)).toThrow(),
  );
  it("allocates exactly, preserves zero weights, deterministic ties", () => {
    expect(allocateMicros(7n, [1n, 1n, 1n, 0n])).toEqual([3n, 2n, 2n, 0n]);
    for (let n = 0n; n < 100n; n++)
      expect(
        allocateMicros(n, [3n, 17n, 91n]).reduce((a, b) => a + b, 0n),
      ).toBe(n);
    expect(() => allocateMicros(1n, [0n])).toThrow();
  });
});
describe("single-process reservation reference", () => {
  it("reserves synchronously, prevents concurrent over-admission", async () => {
    const store = new MemoryGrantStore();
    store.setGrant("s", signer, 10n);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => store.reserve("s", "a", 7n)),
      Promise.resolve().then(() => store.reserve("s", "b", 7n)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(store.remaining("s")).toBe(3n);
  });
  it("never releases exposed/submitted spend on revoke or expiry, or resets with an alias", () => {
    let time = 1;
    const store = new MemoryGrantStore(() => time);
    store.setGrant("s", signer, 10n, 1);
    store.reserve("s", "a", 6n);
    store.expose("a");
    store.submit("a");
    time = 5000;
    store.revokeGrant("s");
    expect(store.remaining("s")).toBe(4n);
    expect(() => store.cancelUnexposed("a")).toThrow();
    expect(() => store.setGrant("s", signer, 10n)).toThrow();
    expect(() => store.setGrant("alias", signer, 10n)).toThrow();
    expect(() => store.reserve("s", "b", 1n)).toThrow();
    store.settle("a");
    expect(store.remaining("s")).toBe(4n);
  });
  it("cancels only prepared unexposed work, with immutable views and single-use IDs", () => {
    const store = new MemoryGrantStore();
    const grant = store.setGrant("S", signer, 10n);
    expect(Object.isFrozen(grant)).toBe(true);
    store.reserve("s", "a", 10n);
    store.cancelUnexposed("a");
    expect(store.remaining("s")).toBe(10n);
    expect(() => store.reserve("s", "a", 1n)).toThrow();
    expect(() => store.reserve("s", "b", -1n)).toThrow();
    expect(() => store.reserve("s", "b", 0n)).toThrow();
  });
});
