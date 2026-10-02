import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Runs after build. No credentials, chain RPC or signed payments are used.
const workspace = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "keryx-primitives-package-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("run through npm run test:package");
function run(args, cwd = workspace) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  if (result.status !== 0)
    throw new Error(`${args[0]} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const [packed] = JSON.parse(
    run([
      npmCli,
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporary,
    ]),
  );
  const allowed = new Set([
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "package.json",
    "source-registry/SourceRegistry.sol",
  ]);
  if (
    packed.files.some(
      (file) =>
        !allowed.has(file.path) &&
        !file.path.startsWith("dist/") &&
        !file.path.startsWith("docs/"),
    )
  )
    throw new Error("unexpected package artifact contents");
  const pkg = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    [
      npmCli,
      "install",
      join(temporary, packed.filename),
      "typescript@5.9.3",
      "viem@2.47.1",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    temporary,
  );
  const modules = Object.keys(pkg.exports).map(
    (key) => `${pkg.name}/${key.slice(2)}`,
  );
  writeFileSync(
    join(temporary, "smoke.mjs"),
    `for (const name of ${JSON.stringify(modules)}) { await import(name); }\nconst { parseUsdc } = await import("keryx-arc-primitives/amounts");\nif (parseUsdc("0.000001") !== 1n) throw new Error("bad packed export");\n`,
  );
  run(["smoke.mjs"], temporary);
  writeFileSync(
    join(temporary, "smoke.ts"),
    `import { parseUsdc, allocateMicros } from "keryx-arc-primitives/amounts";\nimport { buildRequirements, type SellerJournal } from "keryx-arc-primitives/x402-two-toll/seller";\nimport { MemoryGrantStore } from "keryx-arc-primitives/browser-cosign/session-grant";\nimport { verifyWithdrawIntent, type WithdrawPolicy } from "keryx-arc-primitives/gasless-cashout/withdraw-intent";\nconst money: bigint = parseUsdc("0.004");\nconst splits: bigint[] = allocateMicros(money, [1n, 2n]);\nnew MemoryGrantStore();\nbuildRequirements({priceUsdc:"0.004",payTo:"0x1111111111111111111111111111111111111111",resourceUrl:"https://example.invalid"});\n`,
  );
  run(
    [
      join(temporary, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "smoke.ts",
    ],
    temporary,
  );
  console.log(
    `Packed consumer passed: ${modules.length} ESM exports, TypeScript declarations, ${packed.files.length} allowlisted files.`,
  );
} finally {
  const target = resolve(temporary),
    parent = resolve(tmpdir()) + sep;
  if (
    !target.startsWith(parent) ||
    !target.includes("keryx-primitives-package-")
  )
    throw new Error("unsafe temporary cleanup target");
  rmSync(target, { recursive: true, force: true });
}
