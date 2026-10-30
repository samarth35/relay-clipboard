import { byteLength, MAX_TEXT_BYTES, type Envelope, type RoomSecrets } from "./shared";

export function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid secret format.");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Invalid secret format.");
  return bytes;
}
export function newSecrets(): RoomSecrets {
  return { key: encode(crypto.getRandomValues(new Uint8Array(32))), token: encode(crypto.getRandomValues(new Uint8Array(32))) };
}
export function parseSecrets(fragment: string): RoomSecrets {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const key = params.get("key") ?? "";
  const token = params.get("token") ?? "";
  if (decode(key).length !== 32 || decode(token).length !== 32) throw new Error("This link is incomplete. Open the full room link, including everything after #.");
  return { key, token };
}
export function roomLink(origin: string, id: string, secrets: RoomSecrets): string {
  return `${origin}/r/${id}#${new URLSearchParams(secrets).toString()}`;
}
export async function tokenDigest(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function context(roomId: string, kind: "snippet" | "pad", idOrRevision: string | number): string {
  return JSON.stringify(["relay", 1, roomId, kind, idOrRevision]);
}
async function importKey(key: string) {
  const bytes = decode(key);
  if (bytes.length !== 32) throw new Error("Invalid encryption key.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encrypt(text: string, key: string, aad: string): Promise<Envelope> {
  if (byteLength(text) > MAX_TEXT_BYTES) throw new Error("Keep each snippet or pad under 64 KB.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    await importKey(key), new TextEncoder().encode(text),
  );
  return { v: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
export async function decrypt(envelope: Envelope, key: string, aad: string): Promise<string> {
  if (envelope.v !== 1 || decode(envelope.iv).length !== 12) throw new Error("Unsupported encrypted content.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(envelope.iv), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
      await importKey(key), decode(envelope.ciphertext),
    );
    if (plaintext.byteLength > MAX_TEXT_BYTES) throw new Error("Content too large.");
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error("Could not decrypt this content. The key may be wrong or the content was altered.");
  }
}
