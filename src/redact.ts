// Known-format credential patterns. The Librarian redacts with these BEFORE storing any
// text. An entropy rule is deliberately absent: it flags ~62,000 distinct strings in the
// transcripts, nearly all encoded data (see research.md, "Secrets in transcripts").
// Forgejo tokens are out of scope by operator decision (2026-10-22): they share a git
// sha's shape and only context separates them.

export const PATTERNS: Record<string, RegExp> = {
  anthropic: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  // A word boundary plus a digit and a capital: `desk-`/`task-` words and kebab ids are not keys.
  openai: /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:proj-)?(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{20,}/g,
  github: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g,
  slack: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  aws_key_id: /\bAKIA[0-9A-Z]{16}\b/g,
  google_api: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  npm: /\bnpm_[A-Za-z0-9]{36}\b/g,
  private_key_block: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  bearer_header: /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  wireguard_private: /PrivateKey\s*=\s*[A-Za-z0-9+/]{42,43}=/g,
  ansible_vault: /\$ANSIBLE_VAULT;[^\n]*(?:\n[0-9a-f]+)*/g,
};

// `password: <value>`: keep the key so the text still says what was there.
const ASSIGNMENT =
  /\b((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)([A-Za-z0-9+/_=.-]{16,})/gi;

export function redact(text: string): string {
  let out = text;
  for (const [name, re] of Object.entries(PATTERNS)) out = out.replace(re, `[REDACTED:${name}]`);
  return out.replace(ASSIGNMENT, "$1[REDACTED]");
}
