# Atomic budget reservations (reference only)

`MemoryGrantStore` demonstrates synchronous check-and-reserve using bigint micro-USDC before any await or browser nonce exposure. Consumption stays held after exposure, submission, settlement, expiry and revocation. Only prepared, provably unexposed work can cancel. Grant replacement/signer aliases cannot reset the budget within this store.

This is **not durable**: restarting loses all authority, and multiple processes have independent state. Do not use it with live funds. Port the transition contract into an authenticated transactional database with cumulative signer/epoch accounting, durable nonce admission, exact settlement evidence and explicit recovery. The module does not implement browser custody/signing, Circle reconciliation or key expiry, and it does not constrain the server-key SDK buyer.

See [migration](../docs/migration-0.3.md), [host contracts](../docs/provenance.md) and the [offline demo](../examples/offline.ts).
