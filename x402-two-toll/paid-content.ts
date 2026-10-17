import { sha256 } from "viem";

export interface PlaintextCommitment {
  readonly bodyHash?: string;
  readonly plaintextBytes?: number;
}

/** Snapshot explicit item/manifest commitments before payment or delivery I/O.
 * A legacy preview/ciphertext length is not a plaintext commitment. Hash equality
 * establishes consistency only; publisher identity/signatures remain host-owned. */
export function selectPlaintextCommitment(
  ...inputs: readonly (PlaintextCommitment | undefined)[]
): Readonly<PlaintextCommitment> {
  let bodyHash: string | undefined, plaintextBytes: number | undefined;
  for (const input of inputs) {
    if (input === undefined) continue;
    if (!input || typeof input !== "object")
      throw new Error("invalid plaintext commitment");
    const hash = input.bodyHash,
      bytes = input.plaintextBytes;
    if (hash !== undefined) {
      if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash))
        throw new Error("invalid plaintext hash");
      const normalized = hash.toLowerCase();
      if (bodyHash !== undefined && normalized !== bodyHash)
        throw new Error("conflicting plaintext hashes");
      bodyHash = normalized;
    }
    if (bytes !== undefined) {
      if (
        typeof bytes !== "number" ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0
      )
        throw new Error("invalid plaintext byte count");
      if (plaintextBytes !== undefined && bytes !== plaintextBytes)
        throw new Error("conflicting plaintext byte counts");
      plaintextBytes = bytes;
    }
  }
  return Object.freeze({
    ...(bodyHash !== undefined ? { bodyHash } : {}),
    ...(plaintextBytes !== undefined ? { plaintextBytes } : {}),
  });
}

export type PaidTextResult<Payment> =
  | {
      readonly delivered: true;
      readonly body: string;
      readonly payment: Payment;
    }
  | {
      readonly delivered: false;
      readonly reason: string;
      readonly payment: Payment;
    };

/** Check delivery without changing the host's payment original or inferring settlement.
 * Failure supplies no usable body and authorizes no refund, cap release or paid retry.
 * The host must verify and persist payment evidence independently of this check. */
export function checkPaidText<Payment>(
  value: unknown,
  commitment: PlaintextCommitment,
  payment: Payment,
): PaidTextResult<Payment> {
  let selected: PlaintextCommitment;
  try {
    selected = selectPlaintextCommitment(commitment);
  } catch {
    return Object.freeze({
      delivered: false,
      reason: "invalid plaintext commitment",
      payment,
    });
  }
  if (typeof value !== "string" || !value.trim())
    return Object.freeze({
      delivered: false,
      reason: "paid body is missing, empty or not text",
      payment,
    });
  const bytes = new TextEncoder().encode(value);
  const reason =
    selected.bodyHash !== undefined && sha256(bytes) !== selected.bodyHash
      ? "paid body hash does not match selected commitment"
      : selected.plaintextBytes !== undefined &&
          bytes.length !== selected.plaintextBytes
        ? "paid body byte count does not match selected commitment"
        : undefined;
  return reason
    ? Object.freeze({ delivered: false, reason, payment })
    : Object.freeze({ delivered: true, body: value, payment });
}
