# Gasless cash-out — treasury-relayed Gateway withdraw

Let a user cash their accrued **Circle Gateway** balance back on-chain as real USDC **without paying
gas** and **without your server ever holding their key**. The user signs; a treasury relayer pays.

## The flow
```
1. User connects a wallet (holds the key in the browser).
2. Browser: buildAndSignWithdrawIntent(walletClient, valueAtomic)  ← signs a burn intent, no gas.
3. POST the signed intent to your server.
4. Server: relayGaslessWithdraw({ treasuryKey, burnIntent, signature, expectedDepositor })
     ├─ validates depositor == authenticated user, chain/contracts == Arc canonical
     ├─ POSTs the intent to Circle /transfer  → mint attestation
     └─ treasury submits gatewayMint()  (pays gas)  → USDC minted to the user's wallet
5. Returns a REAL EVM tx hash (resolves at /tx/, unlike batched settlement UUIDs).
```

**Non-custodial.** The burn-intent signature can only be produced by the balance owner
(`sourceDepositor`), so nobody can withdraw someone else's funds. `destinationCaller = 0x0` makes the
mint **permissionless** — that is exactly what lets the treasury submit it on the user's behalf. The
EIP-712 domain is `{ name, version }` only (no `chainId`), so signing needs no network switch and
costs no gas.

## The full-balance footgun
Circle charges its withdraw fee **on top of** the value (`available >= value + fee`), so a withdraw
for the *entire* balance fails by exactly the fee. Reserve a margin from the amount before signing:

```ts
import { parseUnits } from "viem";
const FEE_RESERVE = parseUnits("0.005", 6);            // reserve ~half a cent
const value = availableAtomic - FEE_RESERVE;           // never sign the whole balance
```

## API
- [`withdraw-intent.ts`](./withdraw-intent.ts) — **browser**: `buildAndSignWithdrawIntent(walletClient, valueAtomic, { recipient?, maxFeeUsdc? })` → `{ burnIntent, signature }`.
- [`relay.ts`](./relay.ts) — **server**: `relayGaslessWithdraw({ treasuryKey, burnIntent, signature, expectedDepositor, rpcUrl? })` → `{ mintTxHash, amountUsdc, recipient, explorerUrl }`. Throws `RelayError` with an HTTP `.status`.

```ts
// server route (e.g. Next.js POST /api/withdraw)
import { relayGaslessWithdraw, RelayError } from "./gasless-cashout/relay";
try {
  const out = await relayGaslessWithdraw({
    treasuryKey: process.env.TREASURY_KEY as `0x${string}`,
    burnIntent, signature,
    expectedDepositor: session.address, // MUST be the authenticated user
  });
  return Response.json(out);
} catch (e) {
  if (e instanceof RelayError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
}
```

## Why this isn't in `circlefin/arc-*`
Those repos withdraw from a **server-held** key against that key's own balance. This is the
**non-custodial, gasless** counterpart: the *user's* wallet signs in the browser, a treasury relays
the mint and eats the gas, and the server can only ever move the signer's own funds. The shape you
need for "let my creators cash out sub-dollar USDC without a gas balance or a seed phrase prompt."
