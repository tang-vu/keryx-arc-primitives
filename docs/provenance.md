# Provenance, maintenance and release gates

Refresh baseline: standalone `b08106c` (2026-09-19, ignore-file update); its runtime source originated in `b453e3e` (2026-07-05). Reviewed upstream anchor: [Keryx `2c59c07`](https://github.com/tang-vu/keryx/tree/2c59c07). The extraction preserves small reusable interfaces and does not claim source or runtime equivalence with that application.

| Area              | Upstream reference                                                                            | Extraction decision                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| x402 seller/buyer | `lib/x402-server.ts`, `lib/payments/real-gateway.ts`                                          | SDK 3.5.0; explicit testnet facilitator URL; exact prices, single-submit journal boundary, honest debit/delivery states                                                                         |
| Session spend     | `lib/payments/session-grants.ts`, browser authorization journal docs                          | Integer atomic reservations as a deliberately non-durable teaching reference; no complete browser journal/custody port                                                                          |
| Withdrawal        | `lib/gateway/withdraw-protocol.ts`, `withdrawal-attestation.ts`, mint journal/receipt modules | Signed identity/term validation, exact single-spec attestation matching, durable host interfaces and prepared raw transaction identity; no app worker/recovery service copied                   |
| Registry          | `contracts/source-registry.sol`, registry/indexer helpers                                     | Original-version Solidity remains unchanged; upstream v2 is intentionally outside this extraction; helper bounds and log identity/order tested; URL ownership is separately established by host |
| Surfaces          | Keryx's web/desktop/CLI/MCP/extensions/bots                                                   | Remain separate upstream distributions; no new runtime version, npm publication or installer implied                                                                                            |

Validated runtime/development dependencies are pinned in `package-lock.json`: Circle batching 3.5.0, x402 core/EVM 2.23.0 and viem 2.47.1. The SDK server imports its optional EVM peer at module load, so this package explicitly requires it. SDK/core/EVM are pinned runtime dependencies to avoid an incompatible automatic peer closure; viem remains the compatible peer with a pinned development version. CI pins Node 24.21.0/npm 11.19.0, runs typecheck/tests/build/offline demo, and installs a packed artifact into a clean consumer. Local Node may differ within the declared supported range; CI provides the pinned release check.

The packed artifact excludes tests, local environments, keys, generated private evidence and application data. `dist/` is generated from checked source and appears only in the package artifact. There is no assumption of npm publishing rights or existing npm distribution.

## Required host contracts

Seller and relay journals must be transactional and durable. Their atomic claims cannot be implemented by a read followed by a write. They must preserve original signed identity and submitted boundaries across restart, connection loss, revocation and expiry. A missing/failed acknowledgement never authorizes a new payment or releases consumed exposure. Store callbacks must not mutate selected request objects; modules pass detached values into admission boundaries.

For seller recovery, match exact Circle transfer evidence by nonce, payer, payee, Arc network, asset and integer amount across the provider's bounded pagination. Empty search or authorization expiry is not terminal non-consumption. No generic reconciliation service is provided here. Authenticate host-issued nonce/request policy before exposing signing terms when purpose binding is needed.

For withdrawal recovery, retain the original BurnIntent and TransferSpec hash, original attestation, signed raw transaction and its local hash. Query that exact transaction; resolve replacement/nonce conflicts deliberately. Serialize treasury signing/nonces, rate-limit sponsorship, independently quote fees and available balance, and verify chain finality/effects. A matching HTTP attestation is not evidence of a mint; a synthetic receipt is not a funded transaction. The contract simulation is the chain's attestation signature check, subject to the host's trusted RPC.

## Still open

- Durable database implementation and fault-injected crash/restart/multi-process acceptance for each host.
- Withdrawal draft persistence/custody acceptance. The builder requires an explicit finite-height ceiling; the host still owns current-head selection and policy.
- Funded Circle settlement/withdrawal and exact mint-effect acceptance. This release performs no live fund writes.
- Registry deployment/runtime Solidity tests, creator verification and outage/fallback policy. The creator-scoped ID prevents another address taking the same ID; it does not prove URL ownership.
- RPC availability/trust, finality and indexer reorg policy; callbacks must handle at-least-once replay.
- Mainnet activation/security review. Testnet constants are not mainnet authority.

## Maintenance direction

The user confirmed on 2026-10-02 that the Showcase standalone should be maintained alongside relevant upstream primitive changes. For each upstream payment/registry/signing/discovery change, assess applicability, select a concrete anchor commit, independently review the extraction and update its code, tests, migration notes and provenance. Preserve small reusable components rather than copying the entire app or unfinished mainnet work.

Maintenance happens during an authorized development session. No autonomous scheduler or availability while the desktop app is closed is implied. Do not make artificial commits to suggest momentum. Publish evidence proportional to actual checks, and record deployed/package versions separately from this library release.

A release requires reproducible clean install/check/packed-consumer CI and independent review. Funded acceptance remains separate. GitHub release tarballs may be attached after those gates; npm publication requires separately established package ownership. Upstream gitlink/docs synchronization is a separate reviewed release, not evidence that Keryx's runtime was changed by this library.

Primary protocol references: [Circle SDK source](https://github.com/circlefin/x402-batching), [official Gateway contracts](https://github.com/circlefin/evm-gateway-contracts), and [Circle Gateway guide](https://www.circle.com/blog/a-practical-guide-to-building-with-circle-gateway). Seller accepts a bounded nonempty SDK settlement-identifier string (not an assumed UUID or EVM hash); Circle/chain reconciliation supplies stronger identity evidence. The binary attestation format follows the official contracts' TransferSpec/Attestation libraries at `fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8`, matching the pinned upstream helper. Revalidate these references before changing formats.
