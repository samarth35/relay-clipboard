import { MAX_ROOM_BYTES, MAX_SNIPPETS, type RoomRead, type RoomSnapshot } from "../lib/shared";

export type Eval = (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>;
export class StoreError extends Error {
  constructor(public code: "missing" | "conflict" | "quota" | "rate" | "collision", public retryAfter?: number) { super(code); }
}

// Each operation authenticates and mutates one room in a single Redis transaction.
// Redis TIME, rather than a caller clock, controls the absolute room lifetime.
export const ROOM_SCRIPT = `
local op, digest = ARGV[1], ARGV[2]
local args = cjson.decode(ARGV[3])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local raw = redis.call('GET', KEYS[1])
if op == 'create' then
  if raw then return cjson.encode({error='collision'}) end
  local state = {id=args.id, authHash=digest, expiresAt=now + args.ttl * 1000, revision=0, padRevision=0, pad=cjson.null, snippets={}, bytes=0}
  redis.call('SET', KEYS[1], cjson.encode(state), 'PX', args.ttl * 1000)
  return cjson.encode({id=state.id, expiresAt=state.expiresAt})
end
if not raw then return cjson.encode({error='missing'}) end
local state = cjson.decode(raw)
if state.authHash ~= digest or state.expiresAt <= now then return cjson.encode({error='missing'}) end
local count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('PEXPIRE', KEYS[2], 60000) end
if count > tonumber(ARGV[6]) then return cjson.encode({error='rate', retryAfter=math.ceil(redis.call('PTTL', KEYS[2])/1000)}) end
if op == 'delete' then
  redis.call('DEL', KEYS[1])
  return cjson.encode({deleted=true})
end
if op == 'read' then
  if args.revision == state.revision then return cjson.encode({unchanged=true, revision=state.revision, expiresAt=state.expiresAt}) end
  state.authHash = nil
  return cjson.encode(state)
end
if op == 'snippet' then
  if state.snippets[args.id] then return cjson.encode({saved=true, revision=state.revision}) end
  local n = 0
  for _ in pairs(state.snippets) do n = n + 1 end
  if n >= tonumber(ARGV[5]) then return cjson.encode({error='quota'}) end
  state.snippets[args.id] = {id=args.id, envelope=args.envelope, createdAt=now}
elseif op == 'removeSnippet' then
  state.snippets[args.id] = nil
elseif op == 'pad' then
  if args.expectedRevision ~= state.padRevision then return cjson.encode({error='conflict'}) end
  state.padRevision = state.padRevision + 1
  state.pad = args.envelope
else
  return redis.error_reply('Unknown operation')
end
local bytes = 0
for _, item in pairs(state.snippets) do bytes = bytes + string.len(cjson.encode(item)) end
if state.pad ~= cjson.null then bytes = bytes + string.len(cjson.encode(state.pad)) end
if bytes > tonumber(ARGV[4]) then return cjson.encode({error='quota'}) end
state.bytes = bytes
state.revision = state.revision + 1
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', math.max(1, math.floor(state.expiresAt - now)))
return cjson.encode({saved=true, revision=state.revision, padRevision=state.padRevision})
`;

export const LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
if count > tonumber(ARGV[1]) then return redis.call('TTL', KEYS[1]) end
return 0
`;

export class RoomStore {
  constructor(private evaluate: Eval, public namespace: string) {}
  key(id: string) { return `${this.namespace}:room:${id}`; }
  async limit(key: string, limit: number, seconds: number) {
    const retry = Number(await this.evaluate(LIMIT_SCRIPT, [`${this.namespace}:limit:${key}`], [limit, seconds]));
    if (retry > 0) throw new StoreError("rate", retry);
  }
  async run<T = RoomSnapshot>(op: string, id: string, digest: string, args: object = {}): Promise<T> {
    const read = op === "read";
    const result = await this.evaluate(ROOM_SCRIPT, [this.key(id), `${this.namespace}:limit:room:${id}:${read ? "read" : "write"}`],
      [op, digest, JSON.stringify(args), MAX_ROOM_BYTES, MAX_SNIPPETS, read ? 300 : 60]);
    const data = (typeof result === "string" ? JSON.parse(result) : result) as T & { error?: StoreError["code"]; retryAfter?: number };
    if (data.error) throw new StoreError(data.error, data.retryAfter);
    return data;
  }
  read(id: string, digest: string, revision = -1) { return this.run<RoomRead>("read", id, digest, { revision }); }
}
