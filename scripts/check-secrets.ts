// Guards against committing credentials:
// 1. .gitignore must exclude .env
// 2. If a local .env exists, none of its secret values may appear in any scanned file
//    (including the Basic credential derived from the key pair).
// 3. Generic scan for credential-looking values next to Authorization / clientSecret markers.
//
// IMPORTANT: the scan list is the WORKING TREE (`git ls-files -co --exclude-standard`,
// i.e. tracked + untracked-but-not-ignored files). Do NOT narrow this back to plain
// `git ls-files`: in a repo with nothing committed/staged that scans zero files and
// the check passes hollowly while secrets sit in soon-to-be-committed files.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
let failures = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

// Obvious placeholders used in docs, fixtures and tests. Real credentials never look like this.
const DOC_DUMMIES: ReadonlySet<string> = new Set([
  "YOUR_CLIENT_ID",
  "YOUR_CLIENT_SECRET",
  "test-client-id",
  "test-client-secret",
  "test-access-token",
]);

const gitignore = existsSync(join(root, ".gitignore"))
  ? readFileSync(join(root, ".gitignore"), "utf8")
  : "";
if (!/^\.env$/m.test(gitignore)) fail(".gitignore does not exclude .env");

// Tracked + untracked-unignored — the set of files that could ever reach a commit.
const scanned = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter((f) => f && !f.startsWith("package-lock"));

// Values from the developer's real .env, plus the Basic credential the SDK derives from them —
// a leaked `base64(id:secret)` is just as damaging as the raw pair.
const localSecrets: string[] = [];
if (existsSync(join(root, ".env"))) {
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*WALMART_(CLIENT_ID|CLIENT_SECRET)\s*=\s*(.+?)\s*$/);
    const key = m?.[1];
    const raw = m?.[2];
    if (key === undefined || raw === undefined) continue;
    const value = raw.replace(/^["']|["']$/g, "");
    if (value.length < 4 || DOC_DUMMIES.has(value)) continue;
    if (key === "CLIENT_ID") clientId = value;
    else clientSecret = value;
    localSecrets.push(value);
  }
  if (clientId !== undefined && clientSecret !== undefined) {
    localSecrets.push(Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64"));
  }
}

for (const file of scanned) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue; // binary
  }
  for (const secret of localSecrets) {
    if (text.includes(secret)) fail(`${file} contains a value from your local .env`);
  }
  // A hardcoded Basic credential.
  for (const m of text.matchAll(/Authorization["'\s:=]+Basic\s+([A-Za-z0-9+/=]{16,})/g)) {
    const value = m[1];
    if (value !== undefined)
      fail(`${file} contains a hardcoded Basic credential: ${value.slice(0, 6)}…`);
  }
  // A long opaque LITERAL assigned to a credential-shaped name. The value must be quoted:
  // `clientSecret: process.env.WALMART_CLIENT_SECRET` is how the code is supposed to read it,
  // and flagging that would train everyone to ignore this check.
  for (const m of text.matchAll(
    /(?:clientSecret|client_secret|accessToken|WALMART_CLIENT_SECRET|WM_SEC\.ACCESS_TOKEN)\s*[:=]\s*["'`]([A-Za-z0-9_\-.+/=]{20,})["'`]/g,
  )) {
    const value = m[1];
    if (value !== undefined && !DOC_DUMMIES.has(value))
      fail(`${file} contains a secret-looking literal: ${value.slice(0, 6)}…`);
  }
  // A raw value in an env-file-shaped assignment (e.g. a real secret pasted into .env.example).
  for (const m of text.matchAll(/^\s*WALMART_CLIENT_(?:ID|SECRET)\s*=\s*(\S{20,})\s*$/gm)) {
    const value = m[1]?.replace(/^["']|["']$/g, "");
    if (value !== undefined && value.length >= 20 && !DOC_DUMMIES.has(value))
      fail(`${file} assigns a credential-looking value to a WALMART_CLIENT_* variable`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} secret check(s) failed`);
  process.exit(1);
}
console.log(`Secret checks passed (${scanned.length} files scanned)`);
