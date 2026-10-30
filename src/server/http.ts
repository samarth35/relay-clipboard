import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { createSchema, idSchema, padSchema, snippetSchema, tokenSchema } from "../lib/validation";
import { StoreError, type RoomStore } from "./store";

const MAX_BODY = 96 * 1024;
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
export function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { ...headers, ...extra } });
}
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "Send JSON content.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BODY) { await reader.cancel(); throw new HttpError(413, "This content is too large."); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON content.");
  } finally { reader.releaseLock(); }
}

export async function handle(request: Request, path: string[], storeFactory: () => RoomStore): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    // Next's Node server may normalize request.url to localhost even when the
    // browser used 127.0.0.1. The HTTP Host is the browser-facing authority.
    const expectedOrigin = new URL(`${url.protocol}//${request.headers.get("host") || url.host}`).origin;
    // Bearer authentication is still required; this blocks browser cross-origin abuse.
    if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Use this site's own room page.");
    if (path.length > 3) throw new HttpError(404, "Not found.");
    const store = storeFactory();
    const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : "local";
    if (process.env.VERCEL === "1" && !ip) throw new HttpError(503, "Connection identity unavailable. Try again.");
    const salt = process.env.RATE_LIMIT_SALT;
    if (!salt) throw new HttpError(503, "Room storage is not available yet.");
    const ipHash = createHmac("sha256", salt).update(ip ?? "unknown").digest("hex");
    await store.limit(`request:${ipHash}`, 600, 60);
    if (!path.length && request.method === "POST") {
      const data = createSchema.parse(await body(request));
      await store.limit(`create:${ipHash}`, 10, 3600);
      const id = randomBytes(16).toString("hex");
      const created = await store.run("create", id, data.accessTokenHash, { id, ttl: data.expiresIn });
      return json(created, 201);
    }
    const id = idSchema.parse(path[0]);
    const authorization = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match || !tokenSchema.safeParse(match[1]).success) throw new HttpError(404, "Room unavailable. Check the full link; it may have expired or been deleted.");
    const digest = createHash("sha256").update(match[1]).digest("hex");
    if (path.length === 1 && request.method === "GET") {
      const revision = z.coerce.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get("revision") ?? -1);
      return json(await store.read(id, digest, revision));
    }
    if (path.length === 1 && request.method === "DELETE") return json(await store.run("delete", id, digest));
    if (path.length === 2 && path[1] === "snippets" && request.method === "POST") {
      return json(await store.run("snippet", id, digest, snippetSchema.parse(await body(request))), 201);
    }
    if (path.length === 3 && path[1] === "snippets" && request.method === "DELETE") {
      const snippetId = idSchema.parse(path[2]);
      return json(await store.run("removeSnippet", id, digest, { id: snippetId }));
    }
    if (path.length === 2 && path[1] === "pad" && request.method === "PUT") {
      return json(await store.run("pad", id, digest, padSchema.parse(await body(request))));
    }
    throw new HttpError(405, "This action is not supported.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "Invalid request. Check the content size, link, and expiry." }, 400);
    if (error instanceof StoreError) {
      const messages = {
        missing: "Room unavailable. Check the full link; it may have expired or been deleted.",
        conflict: "The pad changed on another device. Your version is still here.",
        quota: "This room is full. Delete a snippet to make space (50 snippets, 2 MB total).",
        rate: "A little too fast. Wait a moment and try again.",
        collision: "Could not create a room. Please try again.",
      };
      const status = { missing: 404, conflict: 409, quota: 409, rate: 429, collision: 503 }[error.code];
      return json({ error: messages[error.code], code: error.code }, status, error.code === "rate" ? { "Retry-After": String(Math.max(1, error.retryAfter ?? 60)) } : {});
    }
    // Never log request bodies, Authorization headers, links, or upstream credentials.
    return json({ error: "Room storage is temporarily unavailable. Your unsaved text is still here." }, 503);
  }
}
