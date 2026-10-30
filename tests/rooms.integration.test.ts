import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "redis";
import { Redis } from "@upstash/redis";
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { context, encrypt, newSecrets, tokenDigest } from "../src/lib/crypto";
import { RoomStore, StoreError, type Eval } from "../src/server/store";
import { handle } from "../src/server/http";

config({ path: ".env.local", quiet: true });
const testPrefix = `relay:test:${randomBytes(12).toString("hex")}`;
let evaluate: Eval;
let store: RoomStore;
let cleanup: () => Promise<void>;
let index = 0;
const secrets = newSecrets();
const digest = await tokenDigest(secrets.token);
const roomId = () => randomBytes(16).toString("hex");
const snippet = async (id: string, text = "test") => { const item = roomId(); return { id: item, envelope: await encrypt(text, secrets.key, context(id, "snippet", item)) }; };
async function create(ttl = 600) {
  const id = roomId();
  const room = await store.run<{ id: string; expiresAt: number }>("create", id, digest, { id, ttl });
  return room;
}
function request(path: string[], method = "GET", data?: unknown, extra: Record<string, string> = {}) {
  return handle(new Request(`http://localhost/api/rooms/${path.join("/")}`, {
    method, headers: { Authorization: `Bearer ${secrets.token}`, ...(data ? { "Content-Type": "application/json" } : {}), ...extra },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }), path, () => store);
}

beforeAll(async () => {
  process.env.RATE_LIMIT_SALT ||= randomBytes(32).toString("hex");
  if (process.env.TEST_UPSTASH === "1") {
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN!, automaticDeserialization: false });
    evaluate = (script, keys, args) => redis.eval(script, keys, args);
    cleanup = async () => {
      const keys = await redis.keys(`${testPrefix}:*`);
      if (keys.length && keys.every((key) => key.startsWith(`${testPrefix}:`))) await redis.del(...keys);
    };
  } else {
    const client = createClient({ url: process.env.REDIS_URL || "redis://127.0.0.1:6389" });
    client.on("error", () => {});
    await client.connect();
    evaluate = (script, keys, args) => client.eval(script, { keys, arguments: args.map(String) });
    cleanup = async () => {
      const keys = await client.keys(`${testPrefix}:*`);
      if (keys.length && keys.every((key) => key.startsWith(`${testPrefix}:`))) await client.del(keys);
      await client.quit();
    };
  }
});
beforeEach(() => { store = new RoomStore(evaluate, `${testPrefix}:${index++}`); });
afterAll(async () => { if (cleanup) await cleanup(); });

describe("actual Redis room operations", () => {
  it("authenticates every read/write and never returns the access verifier", async () => {
    const { id } = await create();
    await store.run("snippet", id, digest, await snippet(id, "private payload"));
    await expect(store.read(id, "wrong")).rejects.toMatchObject({ code: "missing" });
    await expect(store.run("delete", id, "wrong")).rejects.toMatchObject({ code: "missing" });
    const data = await store.read(id, digest);
    expect(JSON.stringify(data)).not.toContain(digest);
    expect(JSON.stringify(data)).not.toContain("private payload");
    expect(JSON.stringify(data)).not.toContain(secrets.key);
    expect(JSON.stringify(data)).not.toContain(secrets.token);
  });
  it("makes concurrent snippet retries idempotent", async () => {
    const { id } = await create(); const item = await snippet(id);
    await Promise.all(Array.from({ length: 8 }, () => store.run("snippet", id, digest, item)));
    const data = await store.read(id, digest);
    expect("snippets" in data && Object.keys(data.snippets)).toHaveLength(1);
    expect(data.revision).toBe(1);
  });
  it("accepts exactly one of two competing pad writes", async () => {
    const { id } = await create();
    const a = await encrypt("device A", secrets.key, context(id, "pad", 1));
    const b = await encrypt("device B", secrets.key, context(id, "pad", 1));
    const results = await Promise.allSettled([store.run("pad", id, digest, { expectedRevision: 0, envelope: a }), store.run("pad", id, digest, { expectedRevision: 0, envelope: b })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(StoreError);
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe("conflict");
  });
  it("returns only revision metadata when content has not changed", async () => {
    const { id } = await create();
    expect(await store.read(id, digest, 0)).toMatchObject({ unchanged: true, revision: 0 });
  });
  it("does not revive an expired room on a late write", async () => {
    const { id } = await create(0.06);
    await new Promise((resolve) => setTimeout(resolve, 110));
    await expect(store.run("snippet", id, digest, await snippet(id))).rejects.toMatchObject({ code: "missing" });
  });
  it("keeps absolute expiry through writes and deletes all room content", async () => {
    const { id, expiresAt } = await create();
    await store.run("snippet", id, digest, await snippet(id));
    const data = await store.read(id, digest);
    expect(data.expiresAt).toBe(expiresAt);
    await store.run("delete", id, digest);
    await expect(store.read(id, digest)).rejects.toMatchObject({ code: "missing" });
  });
  it("enforces the snippet-count quota even during concurrent writes", async () => {
    const { id } = await create();
    const items = await Promise.all(Array.from({ length: 52 }, () => snippet(id)));
    const results = await Promise.allSettled(items.map((item) => store.run("snippet", id, digest, item)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(50);
    expect(results.filter((r) => r.status === "rejected" && r.reason.code === "quota")).toHaveLength(2);
  });
  it("enforces the room byte quota atomically before accepting a write", async () => {
    const { id } = await create();
    const items = await Promise.all(Array.from({ length: 25 }, () => snippet(id, "a".repeat(65536))));
    const results = await Promise.allSettled(items.map((item) => store.run("snippet", id, digest, item)));
    expect(results.some((r) => r.status === "rejected" && r.reason.code === "quota")).toBe(true);
    const data = await store.read(id, digest);
    expect("bytes" in data && data.bytes).toBeLessThanOrEqual(2097152);
  });
  it("limits room writes and provides retry timing", async () => {
    const { id } = await create();
    for (let i = 0; i < 60; i++) await store.run("removeSnippet", id, digest, { id: roomId() });
    await expect(store.run("removeSnippet", id, digest, { id: roomId() })).rejects.toMatchObject({ code: "rate", retryAfter: expect.any(Number) });
  });
});

describe("HTTP boundary with actual Redis", () => {
  it("handles create, authenticated read, add, delete and missing authorization", async () => {
    const response = await request([], "POST", { accessTokenHash: digest, expiresIn: 600 });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect((await request([id])).status).toBe(200);
    expect((await request([id], "GET", undefined, { Authorization: "" })).status).toBe(404);
    expect((await request([id, "snippets"], "POST", await snippet(id))).status).toBe(201);
    expect((await request([id], "DELETE")).status).toBe(200);
    expect((await request([id])).status).toBe(404);
  });
  it("rejects cross-origin requests, plaintext, invalid lifetimes and oversized bodies", async () => {
    expect((await request([], "POST", { accessTokenHash: digest, expiresIn: 600 }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await request([], "POST", { accessTokenHash: digest, expiresIn: 1 })).status).toBe(400);
    const { id } = await create();
    expect((await request([id, "snippets"], "POST", { ...(await snippet(id)), text: "plaintext" })).status).toBe(400);
    expect((await request([id, "snippets"], "POST", { data: "x".repeat(100000) })).status).toBe(413);
  });
  it("uses the browser-facing Host when Next normalizes its internal URL", async () => {
    const result = await request([], "POST", { accessTokenHash: digest, expiresIn: 600 }, { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" });
    expect(result.status).toBe(201);
    expect((await request([], "POST", { accessTokenHash: digest, expiresIn: 600 }, { host: "127.0.0.1:3001", origin: "http://localhost:3001" })).status).toBe(403);
  });
  it("returns 409 for stale pads and 429 with Retry-After for excess creation", async () => {
    const { id } = await create();
    const envelope = await encrypt("pad", secrets.key, context(id, "pad", 1));
    expect((await request([id, "pad"], "PUT", { expectedRevision: 0, envelope })).status).toBe(200);
    expect((await request([id, "pad"], "PUT", { expectedRevision: 0, envelope })).status).toBe(409);
    for (let i = 0; i < 10; i++) expect((await request([], "POST", { accessTokenHash: digest, expiresIn: 600 })).status).toBe(201);
    const result = await request([], "POST", { accessTokenHash: digest, expiresIn: 600 });
    expect(result.status).toBe(429); expect(Number(result.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("fails closed without exposing upstream credentials", async () => {
    const result = await handle(new Request("http://localhost/api/rooms", { method: "POST" }), [], () => { throw new Error("secret upstream token"); });
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("secret upstream token");
  });
});
