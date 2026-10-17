# Keryx Arc primitives

Small MIT-licensed TypeScript building blocks for citation-toll and creator-payment applications on **Arc testnet**. Fork the code, run the offline checks, then supply your own authenticated application and durable payment journal.

Version 0.4 adds selected-plaintext integrity and creator-bound active registry payment terms, traced against [Keryx](https://github.com/tang-vu/keryx/tree/50ad8e0ebdd65ba35da965dfb3e7ef8b0e6b3ed0). The original 0.3 payment interfaces and pinned Circle SDK 3.5.0 remain. This is a small extraction with host-owned security boundaries; see [provenance and remaining gates](docs/provenance.md).

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

`npm run build` generates ESM JavaScript and TypeScript declarations under `dist/`. `npm pack` builds a portable tarball; install that local artifact with `npm install /path/to/keryx-arc-primitives-0.4.0.tgz`. This repository does not claim an npm registry publication. Clone/build/pack before consumption; do not rely on a Git URL install to build ignored `dist/`.

## Primitives

| Export                            | Purpose                                                                                                            | Host responsibility                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `amounts`                         | Exact micro-USDC parsing/formatting and largest-remainder weighted allocation                                      | Authoritative amounts, reward evidence and selected recipients                                                                                   |
| `x402-two-toll/seller`            | Fixed or request-computed tolls; bind payment identity, claim durably, submit once, then deliver                   | Authenticate buyer/request, resolve creator payee/price, implement atomic journal and reconciliation                                             |
| `x402-two-toll/buyer`             | Testnet Circle SDK client for a **server-held treasury key**                                                       | Validate challenge/payee, cap aggregate spend before signing, persist/recover ambiguous debits; never blindly repeat a missing-response purchase |
| `x402-two-toll/paid-content`      | Frozen explicit plaintext commitments and SHA-256/UTF-8 delivery checks retaining the host payment original        | Authenticate publisher/version, capture commitments before I/O, verify payment separately; exclude failed delivery from evidence/rewards         |
| `source-registry/registry-client` | Creator-bound IDs, contract reads and bounded write encoders                                                       | Establish source ownership separately, read active payout authority, authenticate creator writes                                                 |
| `source-registry/payment-terms`   | Active creator-bound payee/price read from the selected original-version deployment, with no cache fallback        | Authenticate creator/URL and registry origin, trust RPC/freshness, durably bind terms before signing; original ABI only                          |
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

### Select registry terms before signing

```ts
import { getRegistryPaymentTerms } from "keryx-arc-primitives/source-registry/payment-terms";

const terms = await getRegistryPaymentTerms({
  registryAddress: originalRegistryAddress,
  creator: verifiedCreator,
  canonicalUrl: registeredCanonicalUrl,
});
// Host: check the seller challenge against terms.payTo and terms.amountMicros,
// then durably admit the exact request/nonce and spend cap before signing.
```

The helper derives the creator-bound source ID, reads that exact deployment on Arc testnet, and rejects missing/inactive/foreign-creator records, invalid terms and RPC errors. Its frozen result includes the original registry address and source ID. Zero-priced sources remain free; the paid seller still requires a positive price. The host selects and authenticates the registry/creator/URL, applies RPC trust/freshness policy and pins the terms into its signing journal. The helper supports this library's original `SourceRegistry.sol` ABI; upstream v2/v3 registries and application onboarding require separate adapters. The thin SDK buyer does not automatically apply this policy.

### Check paid plaintext while retaining the debit

```ts
import {
  selectPlaintextCommitment,
  checkPaidText,
} from "keryx-arc-primitives/x402-two-toll/paid-content";

// Before purchase I/O: capture explicit commitments from the selected version.
const selected = selectPlaintextCommitment(selectedItem, selectedItem.manifest);
// Host: submit once and independently verify/persist any settlement evidence,
// including PAYMENT-RESPONSE on an HTTP delivery error.
const delivery = checkPaidText(paidBody, selected, admittedPaymentOriginal);
if (delivery.delivered) {
  consumeSelectedText(delivery.body);
} else {
  retainOriginalForRecovery(delivery.payment, delivery.reason);
}
```

`checkPaidText` retains the exact supplied payment object on success and failure; it never infers settlement, changes a cap, releases a reservation or issues a request. Wrong hash/byte count, blank/non-text body or malformed commitments return no usable body. Keep such deliveries out of evidence and citation rewards. Hashes check consistency, not publisher identity or a manifest signature. Absent legacy commitments stay absent; a nonempty legacy body can pass without proving a selected version. The helper uses browser-compatible UTF-8/SHA-256 and performs no network I/O. The host still owns authenticated content/version selection and receipt handling; `GatewayClient.pay()` alone is not that integration.

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

| Surface                                               | Applicability here                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Library/API host                                      | ESM exports, HTTP result adapter, required durable journal interfaces                                               |
| Browser                                               | Portable plaintext checking, burn-intent signing/verification and budget reference; no packaged worker or wallet UI |
| Web, desktop, CLI, remote/stdio MCP, extensions, bots | Products in upstream Keryx; this extraction does not distribute, deploy or synchronize them                         |
| Smart contract                                        | Unchanged `SourceRegistry.sol`; deployment/contract runtime acceptance remains a separate gate                      |
| Mainnet                                               | Not supported by these defaults; no activation, funded writes or mainnet proof in this release                      |

## Arc OSS Showcase pitch

**What primitives are exposed?** Exact weighted micro-USDC allocation, fixed/dynamic x402 settle-before-delivery, creator-bound registry helpers and ordered indexing, atomic budget reservation examples, browser-signed treasury-relayed withdrawal, and endpoint discovery metadata. The safety contracts keep ambiguous debits retained and require durable admission before effects.

**What do they add alongside Circle's Arc commerce/P2P examples?** Composable patterns for attribution and creator payments: a second computed toll, exact weighted splits, creator-scoped payout metadata, user-funded signing integration boundaries, and recovery-aware withdrawal/settlement interfaces. These are useful additions for builders, without claiming exclusivity or copying a full application.

Read the [0.3 migration guide](docs/migration-0.3.md), [changelog](CHANGELOG.md) and [maintenance policy](docs/provenance.md). MIT; see [LICENSE](LICENSE).

For the additive helpers, see the [0.4 integration guide](docs/migration-0.4.md).
