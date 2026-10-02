import { it, expect } from "vitest";
import { makeBuyer } from "../x402-two-toll/buyer.js";
import { ARC } from "../arc.js";
it("constructs the pinned SDK buyer on testnet without network effects", () => {
  const buyer = makeBuyer({ privateKey: `0x${"1".repeat(64)}` });
  expect(buyer.getChainName()).toBe("arcTestnet");
  expect(buyer.domain).toBe(ARC.cctpDomain);
});
