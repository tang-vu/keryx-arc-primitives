# Standalone maintenance instructions

Read README.md, docs/provenance.md and docs/migration-0.3.md before changing payment interfaces. This library is a reviewed subset of Keryx, not its deployed runtime. Keep Arc testnet default; never activate mainnet or spend funds without explicit authorization.

Use exact integer micro-USDC, source-owned payees, durable atomic nonce/digest admission before effects, and honest settlement evidence. Uncertain outcomes retain exposure; expiry/HTTP errors cannot release or authorize fresh payment. No implicit paid retry. Keep modules small and readable for builders, and document host-owned durability/custody/recovery boundaries.

Use Node 22.19+ or 24+ and npm 11.19.0. CI pins Node 24.21.0. Run npm run check and npm run test:package; run clean npm ci after dependency changes. Never commit local environment files, keys, private runtime/evidence or generated dist/tarballs. Preserve unrelated changes.

For relevant upstream changes, pin a concrete Keryx commit and review applicability independently; update source, tests, migration/changelog and provenance together. Do not copy unfinished mainnet domains. Library/API/browser primitives are applicable here; web/desktop/CLI/MCP/extensions/bots remain upstream products and must never be described as synchronized by a library-only release.

Work on a focused feature branch, commit/push/open PR, require CI and independent review before merge. Before ending a session, record durable user-confirmed facts/decisions in docs/provenance.md and read them back. Maintenance is session work, not an autonomous scheduler. Never create fake activity/momentum commits or claim synthetic tests as funded acceptance.
