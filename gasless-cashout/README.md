# Browser-signed, treasury-relayed withdrawal

Arc-testnet-only, same-chain, empty-hook burn intents. The owner signs; a separate treasury pays mint gas. The required policy binds authenticated owner, approved recipient, value and fee ceilings. Signature recovery, strict canonical addresses/contracts/domain and exact binary attestation matching precede mint sponsorship.

`RelayJournal` must atomically persist unique claims by **both BurnIntent digest and TransferSpec hash/salt**, original signed request and its selected policy before returning true. Preserve claims after uncertain results. `submitted` is acknowledged before Circle; `attested` stores the exact matched response; `mintPrepared` stores signed raw transaction and local hash before broadcast; `confirmed` records only the exact successful receipt from the expected sender/minter. No method releases exposure or retries an ambiguous call.

Production hosts must implement durable storage/backups, authenticated policy selection, finite-height draft persistence before signing, current fee/available balance checks, treasury nonce serialization and sponsorship rate/gas limits. This library supplies interfaces rather than a recovery daemon. The browser builder requires a finite block-height ceiling; Circle fee reserves must be explicitly quoted, not guessed from an example.

A relay error after submission is `202 pending`, with the original request digest and prepared mint hash when available. A duplicate claim is `409 retained`. Recovery examines original Circle/chain evidence and resends no fresh nonce automatically. A replacement or cancellation transaction receipt cannot confirm the original mint. Reverted receipts remain retained here; host recovery may classify exact terminal observations separately.

Only a real verified mint transaction hash belongs in an explorer `/tx/` URL. Test mocks and the offline demo do not prove real withdrawal. See [provenance and open acceptance](../docs/provenance.md).
