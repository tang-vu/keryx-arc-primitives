/** Exact integer micro-USDC; no rounding or floating-point budget arithmetic. */
export function parseUsdc(value: string): bigint {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)
  )
    throw new Error(
      "USDC must be a non-negative decimal string with at most six decimals",
    );
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
export function formatUsdc(micros: bigint): string {
  if (micros < 0n) throw new Error("negative amount");
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
}
/** Largest remainder allocation. Ties resolve by caller order; sums exactly to total. */
export function allocateMicros(
  total: bigint,
  weights: readonly bigint[],
): bigint[] {
  if (total < 0n || !weights.length || weights.some((w) => w < 0n))
    throw new Error("invalid allocation");
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("positive weight required");
  const result = weights.map((w) => (total * w) / sum);
  const order = weights
    .map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.i - b.i
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  const left = total - result.reduce((a, b) => a + b, 0n);
  for (let i = 0; i < Number(left); i++) result[order[i]!.i]! += 1n;
  return result;
}
