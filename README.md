# Keryx Arc primitives

Small MIT-licensed TypeScript building blocks for citation-toll and creator-payment applications on **Arc testnet**. Fork the code, run the offline checks, then supply your own authenticated application and durable payment journal.

Version 0.3 refreshes the original July extraction against [Keryx](https://github.com/tang-vu/keryx/tree/2c59c07) and its pinned Circle SDK 3.5.0. It is a reviewed subset, not the complete Keryx runtime, an audited payment service or a mainnet release. See [provenance and remaining gates](docs/provenance.md).

## Run the fork

Use Node 22.19+ or Node 24+; CI uses Node 24.21.0 and npm 11.19.0.

```sh
git clone https://github.com/tang-vu/keryx-arc-primitives.git
cd keryx-arc-primitives
npx --yes npm@11.19.0 ci
npm run check
npm run test:package
```

`npm run demo` makes **no network requests, signs no payments and spends no funds**. It shows an exact reward allocation, atomic budget reservations and a seller's unpaid 402 challenge. All test settlement/receipt responses are synthetic.

`npm run build` generates ESM JavaScript and TypeScript declarations under `dist/`. `npm pack` builds a portable tarball; install that local artifact with `npm install /path/to/keryx-arc-primitives-0.3.0.tgz`. This repository does not claim an npm registry publication. Clone/build/pack before consumption; do not rely on a Git URL install to build ignored `dist/`.

## Primitives

| Export                            | Purpose                                                                                                            | Host responsibility                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `amounts`                         | Exact micro-USDC parsing/formatting and largest-remainder weighted allocation                                      | Authoritative amounts, reward evidence and selected recipients                                                                                   |
| `x402-two-toll/seller`            | Fixed or request-computed tolls; bind payment identity, claim durably, submit once, then deliver                   | Authenticate buyer/request, resolve creator payee/price, implement atomic journal and reconciliation                                             |
| `x402-two-toll/buyer`             | Testnet Circle SDK client for a **server-held treasury key**                                                       | Validate challenge/payee, cap aggregate spend before signing, persist/recover ambiguous debits; never blindly repeat a missing-response purchase |
| `source-registry/registry-client` | Creator-bound IDs, contract reads and bounded write encoders                                                       | Establish source ownership separately, read active payout authority, authenticate creator writes                                                 |
| `source-registry/indexer`         | Ordered block/log delivery with stable deduplication identity                                                      | Durable cursor, idempotent/transactional application, RPC trust and finality policy                                                              |
| `browser-cosign/session-grant`    | Synchronous integer reservations in a **single-process, in-memory reference**                                      | Durable database transactions, authenticated nonce admission, signer/epoch lifetime accounting, browser signing policy                           |
| `gasless-cashout/withdraw-intent` | Browser signing and recovered-signature validation of same-chain burn terms                                        | Authenticated owner/recipient, current fee quote, funded availability and finite signing window                                                  |
| `gasless-cashout/relay`           | Single Circle request, exact attestation binding, gas-capped mint, prepared transaction persisted before broadcast | Durable unique journal, treasury nonce serialization, sponsorship limits, backups and explicit recovery                                          |
| `x402-discovery/discovery`        | Additive Bazaar metadata                                                                                           | Schema quality and compatibility; metadata never proves a safe settlement retry                                                                  |
| `arc`                             | Frozen testnet constants, USDC ERC-20 six decimals versus native gas eighteen                                      | Revalidate vendor facts when changing networks or SDKs                                                                                           |

### Fixed and weighted tolls

Use strings at the price boundary and integers everywhere budgets are allocated:

```ts
import {
  allocateMicros,
  formatUsdc,
  parseUsdc,
} from "keryx-arc-primitives/amounts";
import { settleThenServe } from "keryx-arc-primitives/x402-two-toll/seller";

const rewards = allocateMicros(parseUsdc("0.01"), [6000n, 4000n]);
const options = {
  priceUsdc: formatUsdc(rewards[0]),
  payTo: creatorWallet, // selected from authoritative active registry state
  resourceUrl: canonicalUrl, // host authenticates the exact intended request
};
const result = await settleThenServe(
  paymentSignatureHeader,
  options,
  (receipt) => unlockExactPaidVersion(receipt),
  { journal: durableSellerJournal },
);
```

The journal must uniquely claim `network + asset + payer + nonce` across resources, persist the original request, and acknowledge submission **before** the facilitator is called. Missing storage fails closed. Unknown settlement returns `202 pending`; it does not release the claim or authorize a fresh nonce. A confirmed debit survives producer failure through `PAYMENT-RESPONSE` and `settled-undelivered`. Resource metadata is unsigned: the journal binds its first admitted use; proving the buyer intended a particular product requires a host-issued durable nonce/request policy before signing.

### Browser budget reference

```ts
import { MemoryGrantStore } from "keryx-arc-primitives/browser-cosign/session-grant";
const store = new MemoryGrantStore(); // offline/reference only
store.setGrant("session", sessionAddress, 10_000n);
store.reserve("session", admittedIntentId, 4000n); // atomic before any await
store.expose(admittedIntentId); // before revealing signing terms
store.submit(admittedIntentId); // before possible settlement
// Persist exact Circle success evidence first, then:
store.settle(admittedIntentId);
```

Only `cancelUnexposed` releases a prepared reservation. Expiry and revocation stop new admission and preserve existing consumption. An expired server grant does **not** expire a signed Circle authorization or constrain a stolen key's direct use. Funded balance is a separate economic limit. This example is unsuitable for restart or multiple processes and does not constrain `GatewayClient.pay()`.

### Gasless withdrawal

The browser must receive an explicit fee ceiling and approved recipient; reserve that fee from available funds. `buildAndSignWithdrawIntent(walletClient, valueMicros, { recipient, maxFeeUsdc: quotedCeiling, maxBlockHeight: approvedFiniteHeight })` returns a JSON-safe signed intent. The builder requires an explicit finite source-chain block-height ceiling. Production hosts must persist the draft before signing under a reviewed policy.

The server calls `relayGaslessWithdraw` with `policy: { owner, recipient, maxValueMicros, maxFeeMicros, maxBlockHeight }`, a required durable `journal`, and `maxGasCostAtomic` in **18-decimal native units**. It recovers the signature before effects, matches the entire returned TransferSpec, simulates mint verification, persists the signed raw transaction/hash, and confirms only that exact successful receipt. A response loss, expiry, gas-cap rejection after Circle submission or replacement receipt stays retained for explicit recovery. See [relay journal contract](gasless-cashout/README.md).

## Evidence and scope

A Circle nanopayment settlement identifier is not automatically an EVM transaction hash. Preserve Circle success/network/payer/amount/nonce evidence; only a verified chain transaction belongs in an explorer `/tx/` link. Neither synthetic tests nor the offline demo prove a funded payment, a deployed registry or mainnet readiness.

| Surface                                               | Applicability here                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Library/API host                                      | ESM exports, HTTP result adapter, required durable journal interfaces                          |
| Browser                                               | Burn-intent signing/verification and server budget reference; no packaged worker or wallet UI  |
| Web, desktop, CLI, remote/stdio MCP, extensions, bots | Products in upstream Keryx; this extraction does not distribute, deploy or synchronize them    |
| Smart contract                                        | Unchanged `SourceRegistry.sol`; deployment/contract runtime acceptance remains a separate gate |
| Mainnet                                               | Not supported by these defaults; no activation, funded writes or mainnet proof in this release |

## Arc OSS Showcase pitch

**What primitives are exposed?** Exact weighted micro-USDC allocation, fixed/dynamic x402 settle-before-delivery, creator-bound registry helpers and ordered indexing, atomic budget reservation examples, browser-signed treasury-relayed withdrawal, and endpoint discovery metadata. The safety contracts keep ambiguous debits retained and require durable admission before effects.

**What do they add alongside Circle's Arc commerce/P2P examples?** Composable patterns for attribution and creator payments: a second computed toll, exact weighted splits, creator-scoped payout metadata, user-funded signing integration boundaries, and recovery-aware withdrawal/settlement interfaces. These are useful additions for builders, without claiming exclusivity or copying a full application.

Read the [0.3 migration guide](docs/migration-0.3.md), [changelog](CHANGELOG.md) and [maintenance policy](docs/provenance.md). MIT; see [LICENSE](LICENSE).
