/**
 * Credential redaction.
 *
 * Upstream bodies are attacker-adjacent text that ends up in error messages and in
 * `WalmartApiError.body`. Walmart has no reason to echo a secret back, but "no reason to" is
 * not a guarantee — so every response body passes through here before it can reach an error.
 * The registry holds the client secret, the Basic credential derived from it, and every access
 * token the client has minted.
 */
export const REDACTED = "[redacted]";

/** Shortest value worth redacting; below this a match is noise, not a credential. */
const MIN_SECRET_LENGTH = 8;

export class SecretRegistry {
  readonly #secrets = new Set<string>();

  add(value: string | undefined): void {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) this.#secrets.add(value);
  }

  /** Replaces every known secret occurrence with {@link REDACTED}. */
  redact(text: string): string {
    let out = text;
    for (const secret of this.#secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out;
  }
}
