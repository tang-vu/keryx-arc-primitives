import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodePacked,
  concatHex,
  sliceHex,
  size,
  keccak256,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ARC } from "../arc.js";
import {
  verifyWithdrawIntent,
  type SignedWithdrawIntent,
  type WithdrawPolicy,
} from "./withdraw-intent.js";

const ABI = [
  {
    name: "gatewayMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
export type VerifiedWithdraw = Awaited<ReturnType<typeof verifyWithdrawIntent>>;
export interface MintAttestation {
  transferId: string;
  attestation: Hex;
  signature: Hex;
  expirationBlock: string;
}
export interface RelayJournal {
  /** Atomic durable unique claim by BurnIntent digest AND TransferSpec hash/salt.
   * Persist request + authenticated policy; otherwise changed maxFee/height reuses the spec. */
  claim(
    verified: VerifiedWithdraw,
    transferSpecHash: Hex,
    policy: WithdrawPolicy & { maxGasCostAtomic: bigint },
  ): Promise<boolean>;
  submitted(id: Hex): Promise<void>;
  attested(id: Hex, attestation: MintAttestation): Promise<void>;
  /** Persist signed raw transaction and its hash BEFORE broadcasting. Recovery uses this exact
   * transaction or on-chain observations; never fresh treasury nonce/intent automatically. */
  mintPrepared(id: Hex, rawTransaction: Hex, hash: Hex): Promise<void>;
  confirmed(id: Hex, hash: Hex): Promise<void>;
}
export interface RelayOpts extends SignedWithdrawIntent {
  treasuryKey: Hex;
  policy: WithdrawPolicy;
  journal: RelayJournal;
  /** Host-reviewed treasury gas ceiling, 18-decimal native Arc units. */
  maxGasCostAtomic: bigint;
  rpcUrl?: string;
  timeoutMs?: number;
}
export interface RelayResult {
  id: Hex;
  mintTxHash: Hex;
  amountMicros: string;
  recipient: string;
  explorerUrl: string;
}
function encodeSpec(v: VerifiedWithdraw): Hex {
  const s = v.request.burnIntent.spec;
  return concatHex([
    encodePacked(
      ["bytes4", "uint32", "uint32", "uint32"],
      ["0xca85def7", s.version, s.sourceDomain, s.destinationDomain],
    ),
    s.sourceContract,
    s.destinationContract,
    s.sourceToken,
    s.destinationToken,
    s.sourceDepositor,
    s.destinationRecipient,
    s.sourceSigner,
    s.destinationCaller,
    encodePacked(
      ["uint256", "bytes32", "uint32"],
      [BigInt(s.value), s.salt, 0],
    ),
  ]);
}
/** Structure + exact request binding, not proof of mint. Contract simulation authenticates it. */
export function matchMintAttestation(
  verified: VerifiedWithdraw,
  value: unknown,
): MintAttestation {
  const r = value as MintAttestation & { success?: boolean; error?: unknown };
  if (
    !r ||
    typeof r !== "object" ||
    (r.success !== undefined && r.success !== true) ||
    typeof r.transferId !== "string" ||
    typeof r.attestation !== "string" ||
    typeof r.signature !== "string" ||
    typeof r.expirationBlock !== "string" ||
    r.error ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      r.transferId,
    ) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(r.attestation) ||
    !/^0x[0-9a-fA-F]{130}$/.test(r.signature) ||
    !/^[1-9][0-9]{0,77}$/.test(r.expirationBlock)
  )
    throw new Error("invalid mint attestation");
  let payload = r.attestation.toLowerCase() as Hex;
  if (sliceHex(payload, 0, 4) === "0x1e12db71") {
    if (size(payload) !== 388 || sliceHex(payload, 4, 8) !== "0x00000001")
      throw new Error("unexpected attestation set");
    payload = sliceHex(payload, 8);
  }
  if (
    size(payload) !== 380 ||
    sliceHex(payload, 0, 4) !== "0xff6fb334" ||
    BigInt(sliceHex(payload, 4, 36)).toString() !== r.expirationBlock ||
    sliceHex(payload, 36, 40) !== "0x00000154" ||
    sliceHex(payload, 40) !== encodeSpec(verified).toLowerCase()
  )
    throw new Error("attestation does not match withdrawal");
  return {
    transferId: r.transferId,
    attestation: r.attestation,
    signature: r.signature,
    expirationBlock: r.expirationBlock,
  };
}
/** No implicit retry. Host must authenticate policy, serialize treasury nonce use, rate-limit
 * sponsorship and provide transactional durable storage. Ambiguous transfer/mint stays held.
 */
export async function relayGaslessWithdraw(
  opts: RelayOpts,
): Promise<RelayResult> {
  const selected = { ...opts, policy: { ...opts.policy } };
  if (
    !selected.journal ||
    typeof selected.maxGasCostAtomic !== "bigint" ||
    selected.maxGasCostAtomic <= 0n
  )
    throw new RelayError(
      "durable relay journal and gas cap required",
      400,
      "unsubmitted",
    );
  let verified: VerifiedWithdraw;
  try {
    verified = await verifyWithdrawIntent(
      { burnIntent: selected.burnIntent, signature: selected.signature },
      selected.policy,
    );
  } catch {
    throw new RelayError("invalid signed withdrawal", 400, "unsubmitted");
  }
  const journal = selected.journal,
    account = privateKeyToAccount(selected.treasuryKey);
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(selected.rpcUrl ?? ARC.rpcUrl, { retryCount: 0 }),
  });
  const wallet = createWalletClient({
    chain: arcTestnet,
    account,
    transport: http(selected.rpcUrl ?? ARC.rpcUrl, { retryCount: 0 }),
  });
  if ((await publicClient.getChainId()) !== ARC.chainId)
    throw new RelayError(
      "RPC is not Arc testnet",
      400,
      "unsubmitted",
      verified.id,
    );
  if (
    (await publicClient.getBlockNumber()) >=
    BigInt(verified.request.burnIntent.maxBlockHeight)
  )
    throw new RelayError(
      "burn intent expired before submission",
      400,
      "unsubmitted",
      verified.id,
    );
  try {
    if (
      (await journal.claim(
        structuredClone(verified),
        keccak256(encodeSpec(verified)),
        { ...selected.policy, maxGasCostAtomic: selected.maxGasCostAtomic },
      )) !== true
    )
      throw new RelayError(
        "withdrawal already claimed; recover original",
        409,
        "retained",
        verified.id,
      );
    await journal.submitted(verified.id);
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError(
      "admission acknowledgement unavailable; recover original",
      503,
      "retained",
      verified.id,
    );
  }
  let hash: Hex | undefined;
  try {
    const response = await fetch(ARC.gatewayTransferApi, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([verified.request]),
      redirect: "error",
      signal: AbortSignal.timeout(selected.timeoutMs ?? 90_000),
    });
    if (!response.ok) throw new Error("transfer response unavailable");
    const attestation = matchMintAttestation(verified, await response.json());
    await journal.attested(verified.id, structuredClone(attestation));
    if (
      (await publicClient.getBlockNumber()) >=
      BigInt(attestation.expirationBlock)
    )
      throw new Error("attestation expired; recovery required");
    await publicClient.simulateContract({
      account,
      address: ARC.gatewayMinter,
      abi: ABI,
      functionName: "gatewayMint",
      args: [attestation.attestation, attestation.signature],
    });
    const tx = await wallet.prepareTransactionRequest({
      account,
      to: ARC.gatewayMinter,
      data: encodeFunctionData({
        abi: ABI,
        functionName: "gatewayMint",
        args: [attestation.attestation, attestation.signature],
      }),
    });
    const unitPrice = tx.maxFeePerGas ?? tx.gasPrice;
    if (
      tx.chainId !== ARC.chainId ||
      !tx.gas ||
      !unitPrice ||
      tx.gas * unitPrice > selected.maxGasCostAtomic
    )
      throw new Error("treasury gas cap exceeded");
    const raw = await wallet.signTransaction(tx);
    hash = keccak256(raw);
    await journal.mintPrepared(verified.id, raw, hash);
    const sent = await publicClient.sendRawTransaction({
      serializedTransaction: raw,
    });
    if (sent !== hash) throw new Error("broadcast identity mismatch");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: selected.timeoutMs ?? 90_000,
    });
    if (
      receipt.status !== "success" ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      receipt.to?.toLowerCase() !== ARC.gatewayMinter.toLowerCase() ||
      receipt.from.toLowerCase() !== account.address.toLowerCase()
    )
      throw new Error("mint not confirmed successful");
    await journal.confirmed(verified.id, hash);
    return {
      id: verified.id,
      mintTxHash: hash,
      amountMicros: verified.amountMicros,
      recipient: verified.recipient,
      explorerUrl: `${ARC.explorer}/tx/${hash}`,
    };
  } catch {
    throw new RelayError(
      "withdrawal outcome retained; recover original request/transaction",
      202,
      "pending",
      verified.id,
      hash,
    );
  }
}
export class RelayError extends Error {
  constructor(
    message: string,
    public status: number,
    public state: "unsubmitted" | "retained" | "pending",
    public id?: Hex,
    public mintTxHash?: Hex,
  ) {
    super(message);
    this.name = "RelayError";
  }
}
