# Bazaar discovery metadata

`bazaarExtension` and `withBazaarInfo` advertise provider/request/response metadata on an x402 challenge. Metadata is additive, not payment authority or proof that a timed-out settlement failed.

For compatibility, `settleWithDiscoveryFallback` retains the original name, but **0.3 calls the supplied function exactly once**. It never strips metadata and repeats a possibly consumed debit. Prefer attaching metadata to challenges or read-only verification when facilitator support is uncertain. The host owns discovery publication/schema quality and explicit payment recovery.
