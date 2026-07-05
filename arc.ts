/**
 * Arc testnet constants — the single reference the circlefin/arc-* docs don't give you in one place.
 *
 * Footgun note: on Arc, native USDC (gas) is 18-decimal while the ERC-20 USDC at `usdc` below is
 * 6-decimal. Fund gas with parseEther(...), but transfer/x402 amounts with parseUnits(amount, 6).
 */
export const ARC = {
  chainId: 5042002,
  networkId: "eip155:5042002",        // x402 network identifier
  viemChainName: "arcTestnet",        // viem ships this chain built-in (import { arcTestnet } from "viem/chains")
  rpcUrl: "https://rpc.testnet.arc.network",
  usdc: "0x3600000000000000000000000000000000000000",     // ERC-20, 6 decimals
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", // Circle Gateway batched-settlement contract
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B", // GatewayMinter — mints USDC on-chain from a Circle transfer attestation (gatewayMint())
  explorer: "https://testnet.arcscan.app",
  gatewayTransferApi: "https://gateway-api-testnet.circle.com/v1/transfer", // POST a signed burn intent → mint attestation
  gatewayWalletEip712: { name: "GatewayWallet", version: "1" }, // burn-intent EIP-712 domain (name+version only ⇒ no chainId, no gas, no network switch)
  gatewayBalanceApi: "https://gateway-api-testnet.circle.com/v1/balances",
  cctpDomain: 26,
  /**
   * Circle's Gateway facilitator rejects an x402 payment unless the REMAINING authorization validity
   * at verify time is still >= 7 days (604800s). Signing→verify latency, second-truncation, and host
   * clock skew each shave the window, so a value equal to the floor fails intermittently under load.
   * Sign with ~8 days of margin. (Learned the hard way; documented here so you don't have to.)
   */
  x402ValiditySeconds: 691200,
} as const;
