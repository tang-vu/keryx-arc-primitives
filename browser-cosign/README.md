# Browser co-sign — non-custodial, user-funded agent spend

Let an agent spend a user's USDC on Arc **without ever holding the user's key**, with a hard cap.

## The flow
```
1. User funds a session EOA (their own wallet, in the browser tab) + deposits into Circle Gateway.
2. setGrant(sessionId, capUsdc) on the server  ← the funded amount IS the cap.
3. Agent wants to pay an x402 toll:
   server: canSpend(sessionId, amount)?   ← cap check BEFORE any signing
     └─ false → reject (never ask the browser to sign)
     └─ true  → emit a sign-request to the browser (SSE/websocket)
4. Browser's in-tab session key signs the EIP-712 authorization, POSTs it back.
5. Seller settles on Arc. server: recordSpend(sessionId, amount).
```

The private key lives only in the browser tab. The server holds **no** key for the session — it only
tracks spend and enforces the ceiling. A leaked session key can spend at most the remaining cap,
within the grant TTL.

## API ([`session-grant.ts`](./session-grant.ts))
- `setGrant(sessionId, capUsdc, ttlSeconds?)` — activate a grant (call when the user funds).
- `canSpend(sessionId, amountUsdc)` — **pre-spend guard**; call before asking the browser to sign.
- `recordSpend(sessionId, amountUsdc)` — call after a successful settle.
- `isGrantValid` / `remaining` / `revokeGrant` — status + teardown.

In-memory by default — swap the `Map` for Redis/DB to run multiple server instances.

## Why this isn't in `circlefin/arc-*`
Those repos settle from a server-held key. This is the **non-custodial** counterpart: user-funded,
browser-signed, server-capped — the safe shape for "an agent spends *my* money, up to $X."
