import "server-only";
import { Redis } from "@upstash/redis";
import { RoomStore } from "./store";

let store: RoomStore | undefined;
export function getStore(): RoomStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token || !process.env.RATE_LIMIT_SALT) throw new Error("Storage is not configured.");
  const redis = new Redis({ url, token, automaticDeserialization: false, retry: { retries: 1, backoff: () => 200 } });
  const namespace = process.env.VERCEL_ENV === "preview"
    ? `relay:preview:${process.env.VERCEL_URL}`
    : (process.env.REDIS_NAMESPACE || (process.env.VERCEL_ENV === "production" ? "relay:production" : "relay:development"));
  store = new RoomStore((script, keys, args) => redis.eval(script, keys, args), namespace);
  return store;
}
