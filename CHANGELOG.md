# Changelog

## 0.4.0 — 2026-10-17

Add selected-plaintext SHA-256/UTF-8 integrity checks that preserve the host's payment original across failed delivery, plus creator-bound active registry payment terms that retain the selected original deployment and fail closed on unavailable or mismatched authority. Add failure-path regressions, offline examples and packed-consumer runtime/type checks for both exports. Trace the extraction against Keryx `50ad8e0ebdd65ba35da965dfb3e7ef8b0e6b3ed0`, including October 9 delivery integrity and October 12 registry-origin protections.

Existing payment/signing interfaces, SDK/dependency pins, original registry Solidity and testnet defaults remain unchanged. The new helpers do not authenticate publishers, prove settlement, implement durable custody/recovery or enable mainnet. Tests remain synthetic; no funded acceptance or npm publication is claimed. See [integration](docs/migration-0.4.md) and [provenance](docs/provenance.md).

## 0.3.0 - 2026-10-02

Breaking safety and forkability refresh: exact string/integer USDC, deterministic weighted allocation, durable seller/relay admission contracts, single submission with retained uncertainty, honest settled-but-undelivered responses, atomic in-memory reservation reference, strict burn signature/term and attestation binding, gas cap and exact prepared mint receipt identity, ordered/deduplicable registry events and bounded encoders. Pins Circle SDK 3.5.0 and tested dependency closure, adds generated ESM/types, clean install/pack-consumer CI and a no-network demo.

The registry Solidity contract is unchanged. Tests are synthetic; no funded/mainnet/deployment/npm publication is claimed. See [migration](docs/migration-0.3.md) and [provenance](docs/provenance.md).

## 0.2.0

July 2026 source extraction added gasless withdrawal and endpoint discovery. Its safety assumptions and APIs are superseded by 0.3.
