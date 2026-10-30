import { describe, expect, it } from "vitest";
import { context, decode, decrypt, encode, encrypt, newSecrets, parseSecrets, roomLink, tokenDigest } from "../src/lib/crypto";
import { MAX_TEXT_BYTES } from "../src/lib/shared";
import { createSchema, envelopeSchema, snippetSchema } from "../src/lib/validation";

describe("browser encryption", () => {
  it("round-trips Unicode, multiline code, and HTML as text", async () => {
    const { key } = newSecrets();
    const text = 'नमस्ते 👋\nconst text = "<script>alert(1)</script>";';
    const encrypted = await encrypt(text, key, context("room", "snippet", "a"));
    expect(await decrypt(encrypted, key, context("room", "snippet", "a"))).toBe(text);
    expect(JSON.stringify(encrypted)).not.toContain("नमस्ते");
  });
  it("uses independent secrets and fresh IVs", async () => {
    const { key, token } = newSecrets();
    expect(key).not.toBe(token);
    expect(decode(key)).toHaveLength(32);
    const a = await encrypt("hello", key, "a"), b = await encrypt("hello", key, "a");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decode(a.iv)).toHaveLength(12);
  });
  it("rejects modified ciphertext, wrong keys, and cross-room/revision replay", async () => {
    const { key } = newSecrets();
    const aad = context("a", "pad", 1);
    const envelope = await encrypt("secret", key, aad);
    const bytes = decode(envelope.ciphertext); bytes[0] ^= 1;
    await expect(decrypt({ ...envelope, ciphertext: encode(bytes) }, key, aad)).rejects.toThrow();
    await expect(decrypt(envelope, newSecrets().key, aad)).rejects.toThrow();
    await expect(decrypt(envelope, key, context("b", "pad", 1))).rejects.toThrow();
    await expect(decrypt(envelope, key, context("a", "pad", 2))).rejects.toThrow();
  });
  it("measures the text limit in UTF-8 bytes", async () => {
    const { key } = newSecrets();
    const envelope = await encrypt("a".repeat(MAX_TEXT_BYTES), key, "limit");
    expect(envelopeSchema.safeParse(envelope).success).toBe(true);
    await expect(encrypt("😀".repeat(MAX_TEXT_BYTES / 4 + 1), key, "limit")).rejects.toThrow("64 KB");
  });
  it("keeps both secrets in the fragment, outside the page request", () => {
    const secrets = newSecrets();
    const url = new URL(roomLink("https://relay.example", "a".repeat(32), secrets));
    expect(url.pathname + url.search).not.toContain(secrets.key);
    expect(url.pathname + url.search).not.toContain(secrets.token);
    expect(parseSecrets(url.hash)).toEqual(secrets);
    expect(() => parseSecrets("#key=short")).toThrow();
    expect(() => decode("AB")).toThrow();
  });
  it("produces the SHA-256 authentication verifier expected by the server", async () => {
    const { createHash } = await import("node:crypto");
    const { token } = newSecrets();
    expect(await tokenDigest(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });
});

describe("API validation", () => {
  it("only permits the published expiry choices", () => {
    const accessTokenHash = "a".repeat(64);
    for (const expiresIn of [600, 3600, 86400, 604800, 2592000]) expect(createSchema.safeParse({ accessTokenHash, expiresIn }).success).toBe(true);
    for (const expiresIn of [0, -1, 60, Infinity, 2592001]) expect(createSchema.safeParse({ accessTokenHash, expiresIn }).success).toBe(false);
  });
  it("rejects plaintext fields, malformed IVs, unsupported versions and oversized ciphertext", async () => {
    const envelope = await encrypt("hello", newSecrets().key, "a");
    expect(snippetSchema.safeParse({ id: "a".repeat(32), envelope, text: "secret" }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...envelope, iv: "short" }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...envelope, v: 2 }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...envelope, ciphertext: "a".repeat(100000) }).success).toBe(false);
  });
});
