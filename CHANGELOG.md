# Changelog

## 0.3.0 - 2026-10-02

Breaking safety and forkability refresh: exact string/integer USDC, deterministic weighted allocation, durable seller/relay admission contracts, single submission with retained uncertainty, honest settled-but-undelivered responses, atomic in-memory reservation reference, strict burn signature/term and attestation binding, gas cap and exact prepared mint receipt identity, ordered/deduplicable registry events and bounded encoders. Pins Circle SDK 3.5.0 and tested dependency closure, adds generated ESM/types, clean install/pack-consumer CI and a no-network demo.

The registry Solidity contract is unchanged. Tests are synthetic; no funded/mainnet/deployment/npm publication is claimed. See [migration](docs/migration-0.3.md) and [provenance](docs/provenance.md).

## 0.2.0

July 2026 source extraction added gasless withdrawal and endpoint discovery. Its safety assumptions and APIs are superseded by 0.3.
