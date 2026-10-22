import { describe, expect, test } from "bun:test";
import { PATTERNS, redact } from "../src/redact";

describe("redact", () => {
  test("replaces a key and an assigned value, keeping kebab words", () => {
    const key = ["sk-", "proj-", "Ab3defghijklmnopqrstuvwx"].join("");
    const out = redact(`token: abcdefghijklmnop1234 and ${key} and desk-workflow-thing-long`);
    expect(out).not.toContain("abcdefghijklmnop1234");
    expect(out).not.toContain("Ab3def");
    expect(out).toContain("token: [REDACTED]");
    expect(out).toContain("[REDACTED:openai]");
    expect(out).toContain("desk-workflow-thing-long");
  });

  test("leaves a commit sha alone", () => {
    const sha = "655dd9ff4a1b2c3d4e5f60718293a4b5c6d7e8f9";
    expect(redact(`fixed in ${sha}`)).toBe(`fixed in ${sha}`);
  });

  test("knows every reviewed pattern", () => {
    expect(Object.keys(PATTERNS)).toEqual([
      "anthropic",
      "openai",
      "github",
      "slack",
      "aws_key_id",
      "google_api",
      "npm",
      "private_key_block",
      "jwt",
      "bearer_header",
      "wireguard_private",
      "ansible_vault",
    ]);
  });
});
