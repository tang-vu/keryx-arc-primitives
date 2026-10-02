import { allocateMicros, formatUsdc, parseUsdc } from "../amounts.js";
import { MemoryGrantStore } from "../browser-cosign/session-grant.js";
import { settleThenServe } from "../x402-two-toll/seller.js";
const creator = "0x1111111111111111111111111111111111111111";
const pool = parseUsdc("0.000007"),
  splits = allocateMicros(pool, [6000n, 4000n]);
const grants = new MemoryGrantStore();
grants.setGrant("offline-demo", creator, parseUsdc("0.01"));
grants.reserve("offline-demo", "offline-intent", parseUsdc("0.004"));
grants.expose("offline-intent");
const challenge = await settleThenServe(
  null,
  {
    priceUsdc: "0.004",
    payTo: creator,
    resourceUrl: "https://example.invalid/paid",
  },
  () => {
    throw new Error("unpaid delivery must not run");
  },
);
console.log(
  JSON.stringify(
    {
      mode: "offline, no funds or network",
      weightedRewards: splits.map(formatUsdc),
      reserved: "0.004000",
      remaining: formatUsdc(grants.remaining("offline-demo")),
      unpaidHttpStatus: challenge.status,
      exposedReservation: "held until exact recovery evidence",
    },
    null,
    2,
  ),
);
