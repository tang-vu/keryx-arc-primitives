# keryx-arc-primitives

Reusable, forkable building blocks for **agent + creator-monetization apps on [Arc](https://docs.arc.network)**, extracted from [Keryx](https://keryx.cc) ([repo](https://github.com/tang-vu/keryx)) for the **Arc Open Source Showcase**.

The `circlefin/arc-*` repos (arc-commerce, arc-p2p-payments, …) cover commerce and P2P flows. These primitives add the pieces that weren't there yet: **two-toll x402 settlement, an on-chain creator/attribution registry, and non-custodial user-funded agent spend** — all on Arc testnet, all real USDC settlement.

> MIT-licensed. Built to fork, import, and ship on top of.

## What's inside

| Primitive | Folder | What it gives you |
|---|---|---|
| **Two-toll x402** | [`x402-two-toll/`](./x402-two-toll) | A `settleThenServe` seller that charges a **fixed** OR a **dynamic** (per-request, computed) USDC toll on one rail, plus a buyer helper. Pattern for pay-per-use **and** pay-per-attribution. Framework-agnostic + a Next.js adapter. |
| **SourceRegistry** | [`source-registry/`](./source-registry) | A Solidity contract + viem client + a generic event indexer for an on-chain catalog of payable sources: **squat-proof creator-scoped IDs, basis-point multi-author splits, IPFS CID, tags**. Reusable for any attribution/royalty/payout app. |
| **Browser co-sign** | [`browser-cosign/`](./browser-cosign) | Server-side **spend-cap enforcement** for non-custodial, user-funded agent spend: the user funds a session EOA, the in-tab key co-signs each x402 authorization, and the server caps spend **before** signing. The key never touches the server. |
| **Arc constants** | [`arc.ts`](./arc.ts) | The Arc-testnet constants the docs scatter — chain id, USDC, Gateway wallet, RPC, explorer, the 6-vs-18 decimal footgun, and the **undocumented 7-day x402 validity floor** (with the safe value). |

## The two questions Arc OSS asks

**What primitives are you exposing?** Two-toll x402 settlement (fixed + dynamic on one rail), a squat-proof on-chain creator registry with weighted multi-author splits + indexer, and a server-enforced spend cap for non-custodial agent spend.

**What do you add vs `circlefin/arc-*`?** Those repos show commerce/P2P transfers. These add (1) **dynamic, contribution-weighted** tolls — not just fixed prices; (2) a reusable **attribution registry** (creator→wallet, multi-author bp splits) that nothing in arc-* provides; (3) a **non-custodial user-funded agent** spend pattern with a hard cap, beyond a server holding a key.

## Quick start

```bash
npm i @circle-fin/x402-batching viem
```

### Charge a toll (fixed or dynamic), settle on Arc
```ts
import { settleThenServe } from "./x402-two-toll/seller";

// FIXED toll:
const r = await settleThenServe(paymentSigHeader, { priceUsdc: 0.004, payTo: creatorWallet, resourceUrl: "/api/source/42" }, async (settle) => {
  return { content: unlockGatedContent(), tx: settle.transaction }; // runs ONLY after settlement
});

// DYNAMIC toll — compute the price per request (e.g. a weighted citation reward), then:
const reward = pool * contributionWeight;
await settleThenServe(paymentSigHeader, { priceUsdc: reward, payTo: authorWallet, resourceUrl: "/api/cite/42" }, () => ({ ok: true }));
```

### Pay a toll (the agent side)
```ts
import { makeBuyer, payToll } from "./x402-two-toll/buyer";
const buyer = makeBuyer({ privateKey: process.env.AGENT_KEY as `0x${string}` });
const res = await payToll(buyer, "https://host/api/source/42"); // settles real USDC on Arc
```

### Register a source on-chain (creator-signed, squat-proof)
```ts
import { urlHash, buildRegisterArgs } from "./source-registry/registry-client";
const args = buildRegisterArgs(REGISTRY_ADDRESS, {
  urlHash: urlHash("https://blog.example.com/feed"), payoutWallet,
  authors: [{ wallet: a, basisPoints: 6000 }, { wallet: b, basisPoints: 4000 }], // 60/40, must sum to 10_000
  fetchPriceUsdc6: 4000n, contentCid: "ipfs://…", tags: "ai,x402",
});
await walletClient.writeContract(args); // creator's wallet signs + pays gas
```

### Index registry events
```ts
import { syncOnce } from "./source-registry/indexer";
let from = DEPLOY_BLOCK;
from = await syncOnce({ address: REGISTRY_ADDRESS, fromBlock: from, onEvent: (e) => db.apply(e) }); // persist `from`
```

## On-chain proof (read before reporting "tx hashes")

Circle's Gateway **batches** many nanopayments into a few on-chain settlements, so `GatewayClient.pay()` returns a Circle **transfer id (UUID)** — *not* a per-payment EVM tx hash. Verifiable proof is the **settlement wallet** + the **registry contract** on [ArcScan](https://testnet.arcscan.app), not a per-payment `/tx/` link. Live reference deployment of `SourceRegistry`: [`0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536`](https://testnet.arcscan.app/address/0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536#code) (verified source).

## Status
Extracted from a live app ([keryx.cc](https://keryx.cc)) settling real USDC on Arc testnet. Testnet-first (KISS): no OpenZeppelin dep, no funds held in the registry. PRs welcome.

## License
MIT — see [LICENSE](./LICENSE).
