"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { context, decrypt, encrypt, parseSecrets } from "./crypto";
import { byteLength, MAX_TEXT_BYTES, type RoomRead, type RoomSecrets, type RoomSnapshot } from "./shared";

export type Snippet = { id: string; text: string; createdAt: number; broken: boolean };
type PadModel = { text: string; base: number; dirty: boolean; saving: boolean; conflict: { text: string; revision: number } | null };

export function useRoom(id: string) {
  const [secrets, setSecrets] = useState<RoomSecrets | null>(null);
  const secretRef = useRef<RoomSecrets | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline" | "unavailable">("connecting");
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState("");
  const [pad, setPad] = useState<PadModel>({ text: "", base: 0, dirty: false, saving: false, conflict: null });
  const model = useRef(pad);
  const revision = useRef(-1);
  const loading = useRef(false);
  const mounted = useRef(false);
  const failures = useRef(0);
  const blockedUntil = useRef(0);
  const closed = useRef(false);
  const transientError = useRef(false);
  const [sendBusy, setSendBusy] = useState(false);
  const sending = useRef(false);

  const publish = useCallback(() => { if (mounted.current) setPad({ ...model.current }); }, []);
  const report = useCallback((reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error("Something went wrong. Please try again.");
    if (!mounted.current) return;
    transientError.current = err instanceof ApiError && [0, 429, 503].includes(err.status);
    setError(err.message);
    if (err instanceof ApiError && err.status === 404) { closed.current = true; setConnection("unavailable"); setFatal(err.message); }
    else if (err instanceof ApiError && (err.status === 0 || err.status === 503)) setConnection("offline");
    if (err instanceof ApiError && err.status === 429) blockedUntil.current = Date.now() + (err.retryAfter ?? 60) * 1000;
  }, []);

  const refresh = useCallback(async (force = false) => {
    const secret = secretRef.current;
    if (!secret || closed.current || loading.current || !mounted.current || Date.now() < blockedUntil.current) return;
    loading.current = true;
    try {
      const result = await api<RoomRead>(`/${id}?revision=${force ? -1 : revision.current}`, secret.token);
      if (!mounted.current) return;
      failures.current = 0;
      setConnection("connected");
      if (transientError.current) { setError(""); transientError.current = false; }
      if ("unchanged" in result) return;
      if (result.revision < revision.current) return;
      const [nextSnippets, padText] = await Promise.all([
        Promise.all(Object.values(result.snippets).map(async (item): Promise<Snippet> => {
          try { return { id: item.id, createdAt: item.createdAt, text: await decrypt(item.envelope, secret.key, context(id, "snippet", item.id)), broken: false }; }
          catch { return { id: item.id, createdAt: item.createdAt, text: "Could not decrypt this snippet.", broken: true }; }
        })),
        result.pad ? decrypt(result.pad, secret.key, context(id, "pad", result.padRevision)) : Promise.resolve(""),
      ]);
      if (!mounted.current || result.revision < revision.current) return;
      revision.current = result.revision;
      setRoom(result);
      setSnippets(nextSnippets.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)));
      const current = model.current;
      if (!current.saving && result.padRevision > current.base) {
        if (!current.dirty || current.text === padText) {
          Object.assign(current, { text: padText, base: result.padRevision, dirty: false, conflict: null });
        } else current.conflict = { text: padText, revision: result.padRevision };
        publish();
      }
    } catch (reason) { failures.current += 1; report(reason); }
    finally { loading.current = false; }
  }, [id, publish, report]);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    try {
      if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid room link.");
      const secret = parseSecrets(window.location.hash);
      secretRef.current = secret;
      setSecrets(secret);
      const poll = async () => {
        if (!document.hidden) await refresh();
        if (alive && mounted.current) timer = setTimeout(poll, Math.min(30000, 3000 * 2 ** Math.min(failures.current, 4)));
      };
      void poll();
    } catch {
      setFatal("Open the full room link, including everything after #.");
      setConnection("unavailable");
    }
    const focus = () => { if (!document.hidden) void refresh(); };
    // Fragment-only navigation does not remount a Next route. Reopen from a
    // clean document so corrected links cannot retain old keys or pad drafts.
    const reopen = () => window.location.reload();
    const leave = (event: BeforeUnloadEvent) => {
      if (model.current.dirty || sending.current) { event.preventDefault(); event.returnValue = ""; }
    };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("online", focus);
    window.addEventListener("beforeunload", leave);
    window.addEventListener("hashchange", reopen);
    return () => {
      alive = false;
      mounted.current = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("hashchange", reopen);
    };
  }, [id, refresh]);

  // Keep an id and its encrypted payload stable across ambiguous network failures.
  const pending = useRef<{ text: string; id: string; envelope: Awaited<ReturnType<typeof encrypt>> } | null>(null);
  const send = useCallback(async (text: string): Promise<boolean> => {
    const secret = secretRef.current;
    if (!secret || !text.trim() || sending.current) return false;
    sending.current = true;
    setSendBusy(true);
    setError("");
    try {
      if (!pending.current || pending.current.text !== text) {
        const snippetId = crypto.randomUUID().replaceAll("-", "");
        pending.current = { text, id: snippetId, envelope: await encrypt(text, secret.key, context(id, "snippet", snippetId)) };
      }
      const item = pending.current;
      await api(`/${id}/snippets`, secret.token, "POST", { id: item.id, envelope: item.envelope });
      pending.current = null;
      await refresh(true);
      return true;
    } catch (reason) { report(reason); return false; }
    finally { sending.current = false; if (mounted.current) setSendBusy(false); }
  }, [id, refresh, report]);

  const savePad = useCallback(async () => {
    const current = model.current;
    const secret = secretRef.current;
    if (!secret || !current.dirty || current.saving || current.conflict || byteLength(current.text) > MAX_TEXT_BYTES || Date.now() < blockedUntil.current) return;
    const text = current.text, base = current.base;
    current.saving = true;
    publish();
    setError("");
    try {
      const envelope = await encrypt(text, secret.key, context(id, "pad", base + 1));
      const result = await api<{ padRevision: number }>(`/${id}/pad`, secret.token, "PUT", { expectedRevision: base, envelope });
      current.base = result.padRevision;
      current.dirty = current.text !== text;
    } catch (reason) { report(reason); }
    finally { current.saving = false; publish(); await refresh(true); }
  }, [id, publish, refresh, report]);

  useEffect(() => {
    if (!room || !pad.dirty || pad.saving || pad.conflict || fatal || connection !== "connected" || error) return;
    const timer = setTimeout(() => { void savePad(); }, 1000);
    return () => clearTimeout(timer);
  }, [pad, room, savePad, fatal, connection, error]);

  const editPad = (text: string) => {
    model.current.text = text;
    model.current.dirty = true;
    setError("");
    publish();
  };
  const resolve = async (choice: "latest" | "mine" | "snippet") => {
    const current = model.current, conflict = current.conflict;
    if (!conflict) return;
    if (choice === "snippet" && !(await send(current.text))) return;
    if (choice !== "mine") current.text = conflict.text;
    current.base = conflict.revision;
    current.dirty = choice === "mine";
    current.conflict = null;
    setError("");
    publish();
  };
  const removeSnippet = async (snippetId: string) => {
    if (!secretRef.current) return;
    try { await api(`/${id}/snippets/${snippetId}`, secretRef.current.token, "DELETE"); await refresh(true); }
    catch (reason) { report(reason); }
  };
  const deleteRoom = async () => {
    if (!secretRef.current) return false;
    try { await api(`/${id}`, secretRef.current.token, "DELETE"); return true; }
    catch (reason) { report(reason); return false; }
  };
  return { secrets, room, snippets, pad, editPad, savePad, resolve, send, sendBusy, removeSnippet, deleteRoom, connection, error, fatal, refresh, clearError: () => setError("") };
}
