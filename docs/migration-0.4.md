# Integrating 0.4

The two new exports are additive. Existing 0.3 seller, buyer, grant, withdrawal, indexer and discovery interfaces remain unchanged. The [0.3 migration requirements](migration-0.3.md) still apply.

## Registry terms before signing

Use `getRegistryPaymentTerms` from `source-registry/payment-terms` with the host-authenticated creator, the exact canonical URL used at registration and its original registry deployment. It derives the creator-scoped source ID and reads the existing original-version `SourceRegistry.sol` ABI on Arc testnet. A missing/inactive/mismatched creator, zero payout wallet, invalid uint64 price, wrong chain or RPC error refuses the operation. No catalog/cache fallback or replacement registry is selected.

The returned frozen terms carry the registry address, source ID, creator, payee and exact bigint micro-USDC/decimal-string price. Compare the paid challenge to these terms and persist them into the authenticated request/nonce and cap admission before signing. A zero price belongs to the host's free-content path. A read does not freeze on-chain state: RPC trust, freshness, creator/URL ownership and admission policy remain host-owned. Upstream v2/v3 registries require separate reviewed adapters; do not relabel their records as this ABI.

## Plaintext delivery after payment

Use `selectPlaintextCommitment(item, manifest)` from `x402-two-toll/paid-content` **before purchase I/O**. Supply only explicit plaintext SHA-256 hashes and byte counts. Malformed or conflicting commitments throw before spending; the result is detached and frozen. Do not infer plaintext bytes from previews, encrypted storage or a legacy display receipt.

After the host independently records the payment outcome, call `checkPaidText(body, selected, originalPayment)`. It checks nonempty text, the selected SHA-256 and exact UTF-8 byte count. A failed delivery retains the identical payment original and has no usable body. A malformed commitment supplied after payment also returns a retained delivery failure. Hash equality proves consistency only; publisher signatures and exact source/item/version authentication remain host-owned. Without explicit legacy commitments, only text usability is checked.

This helper neither reads receipts nor marks a payment settled. Preserve valid settlement evidence before checking HTTP status/body. A paid content mismatch is a debit with failed delivery, not a refund or permission to release exposure/retry with a new nonce. Pending payment remains pending even when text matches. Neither failed delivery nor a pending receipt authorizes citation rewards.

The existing SDK buyer remains a thin server-key wrapper: budget/challenge validation, non-2xx receipt preservation and durable recovery are host integrations. These helpers do not turn it into a guarded buyer. No browser custody worker, application recovery daemon, mainnet profile or new funded authority is included.
