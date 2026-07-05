# x402 discovery — make a paid endpoint self-describing

Declare **Bazaar discovery metadata** on your x402 endpoint so any x402 tooling — including Circle's
`circle services inspect <url>` — can read your pricing, provider info, and input/output JSON schemas
**with zero prior knowledge**, then pay and call you. Turns a paid URL into a discoverable service.

## The idea
```
1. Write one DiscoveryDeclaration (provider, path, input/output JSON schemas).
2. 402 challenge  → body.extensions.bazaar.info = declaration     (probe reads it, no payment)
3. verify/settle  → carry the same declaration in the payload     (facilitator can catalog it)
4. If a facilitator rejects the extended payload → retry BARE     (discovery never breaks payment)
```

Mirrors the entries Circle's registry returns from `/v2/x402/discovery/resources` (the index behind
`circle services search`), so a declared endpoint reads the same way a registry-listed one does.

## API ([`discovery.ts`](./discovery.ts))
- `bazaarExtension(decl)` → `{ bazaar: { info: decl } }` — spread into your 402 body's `extensions`.
- `withBazaarInfo(challenge, decl)` — non-mutating merge into an existing challenge object.
- `settleWithDiscoveryFallback(payload, decl, settleFn)` — attach discovery to the facilitator
  payload, **retry bare on rejection** so settlement can never fail because of metadata.

```ts
import { bazaarExtension, withBazaarInfo, settleWithDiscoveryFallback } from "./x402-discovery/discovery";

const decl = {
  provider: { name: "Acme Research", website: "https://acme.dev", category: "WEB_SEARCH_RESEARCH", tags: ["x402", "paid-api"] },
  path: "/api/ask", method: "POST",
  input:  { type: "object", required: ["question"], properties: { question: { type: "string" } } },
  output: { type: "object", properties: { answer: { type: "string" } } },
  supportsCircleGateway: true,
};

// 1) advertise in the 402 challenge (GET probe returns the same 402, no side effects)
const body = { x402Version: 2, accepts: [requirements], ...( { extensions: bazaarExtension(decl) } ) };

// 2) carry through settle, safely
const settled = await settleWithDiscoveryFallback(paymentPayload, decl, (p) => facilitator.settle(p));
```

**Serve a GET probe.** Tools like `circle services inspect` **GET** the URL before paying; without a
GET handler many frameworks answer 405 and the tool reports the endpoint "unavailable". Return the
same 402 challenge from GET (no agent run, no payment) so the schema is readable pre-payment.

## Why this isn't in `circlefin/arc-*`
The `arc-*` repos show how to charge and settle. This adds the **discoverability** layer: a compact,
standard way to publish *what your paid endpoint does* inside the x402 handshake itself — with a hard
guarantee (bare-retry fallback) that the discovery metadata can never break the money path.
