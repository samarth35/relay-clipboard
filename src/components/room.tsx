"use client";

import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Code2, FileText, Link2, LoaderCircle, LockKeyhole, MoreHorizontal, QrCode, RefreshCw, Trash2, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { byteLength, MAX_TEXT_BYTES, remainingTime } from "@/lib/shared";
import { roomLink } from "@/lib/crypto";
import { useRoom, type Snippet } from "@/lib/use-room";
import { CopyButton, Modal, Shell } from "./shell";
import Surface, { GlassControl } from "./surface";
import GlassSurface from "./GlassSurface";

export default function Room({ id }: { id: string }) {
  const state = useRoom(id);
  const { room, snippets, pad, connection, fatal } = state;
  const [tab, setTab] = useState<"snippets" | "pad">("snippets");
  const [text, setText] = useState("");
  const textRef = useRef(text); textRef.current = text;
  const [expired, setExpired] = useState(false);
  const [origin, setOrigin] = useState("");
  const [share, setShare] = useState(false);
  const [menu, setMenu] = useState(false);
  const [destroy, setDestroy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [query, setQuery] = useState("");
  const filteredSnippets = useMemo(() => {
    if (!query) return snippets;
    const needle = query.toLowerCase();
    return snippets.filter((item) => item.text.toLowerCase().includes(needle));
  }, [snippets, query]);
  const menuRef = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    const deadline = room?.expiresAt;
    if (!deadline) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) setExpired(true);
      else timer = setTimeout(check, Math.min(remaining, 60000));
    };
    check();
    return () => clearTimeout(timer);
  }, [room?.expiresAt]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (textRef.current.trim()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  useEffect(() => {
    const event = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", event); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", event); document.removeEventListener("keydown", key); };
  }, []);
  const unavailable = expired || deleted || connection === "unavailable";
  const link = state.secrets && origin ? roomLink(origin, id, state.secrets) : "";
  const activeText = tab === "snippets" ? text : pad.text;
  const bytes = byteLength(activeText);
  const tooLarge = bytes > MAX_TEXT_BYTES;
  const offline = connection === "offline";
  async function send() {
    const value = textRef.current;
    if (!tooLarge && await state.send(value)) { if (textRef.current === value) setText(""); textarea.current?.focus(); }
  }
  const shareContent = <ShareContent link={link} disabled={unavailable} />;
  return <Shell><main className="room-main">
    <div className="room-heading">
      <div><p className="room-id">ROOM <span>/</span> {id.slice(0, 4).toUpperCase()}</p><h1>Your shared space.</h1></div>
      <div className="room-actions"><GlassControl><button className="button button-glass" onClick={() => setShare(true)} disabled={!link || unavailable}><QrCode size={17} /> Share room</button></GlassControl><div className="room-menu" ref={menuRef}><button className="icon-button button-glass more-button" aria-label="Room options" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={20} /></button>{menu && <div className="dropdown"><Link href="/">New room <ArrowRight size={15} /></Link><button className="danger" disabled={unavailable} onClick={() => { setMenu(false); setDestroy(true); }}>Delete room <Trash2 size={15} /></button></div>}</div></div>
    </div>
    <Surface className="status-strip" radius={14}><div className="status-items"><span><Clock3 size={16} />{room ? <Countdown expiresAt={room.expiresAt} /> : "Connecting…"}</span><span className="status-divider" /><span className={offline ? "status-offline" : ""}><i className={`connection-dot ${connection}`} />{unavailable ? "Unavailable" : offline ? "Reconnecting" : connection === "connected" ? "Connected" : "Connecting"}</span><span className="status-encryption"><LockKeyhole size={13} /> End-to-end encrypted</span></div></Surface>
    {(fatal || unavailable) && <div className="notice notice-unavailable" role="alert"><div><h2>{deleted ? "Room deleted." : expired ? "This room has expired." : "Room unavailable."}</h2><p>{fatal || "Create a new room to keep going."}</p></div><Link href="/" className="button button-glass"><ArrowLeft size={16} /> New room</Link></div>}
    {state.error && !fatal && <div className="notice" role="alert"><span>{offline && <WifiOff size={16} />}{state.error}</span><button className="icon-button" aria-label="Dismiss error" onClick={state.clearError}><X size={16} /></button></div>}
    <div className="room-grid"><div className="workspace-column">
      <Surface className={`editor-panel ${unavailable ? "is-disabled" : ""}`}>
        <div className="editor-toolbar"><div className="tab-list" data-active={tab} role="tablist" aria-label="Room content"><div className="tab-thumb" aria-hidden="true"><GlassSurface width="100%" height="100%" borderRadius={9} distortionScale={-65} displace={0.12} backgroundOpacity={0.025} saturation={1.1} className="tab-thumb-glass" /></div><button role="tab" id="snippets-tab" aria-selected={tab === "snippets"} aria-controls="snippets-panel" onClick={() => setTab("snippets")}>Snippets</button><button role="tab" id="pad-tab" aria-selected={tab === "pad"} aria-controls="pad-panel" onClick={() => setTab("pad")}>Shared pad</button></div><kbd title="Control or Command and Enter">Ctrl ↵</kbd></div>
        <div className="editor-stage" data-mode={tab}><div key={tab} className="tab-content" role="tabpanel" id={tab === "snippets" ? "snippets-panel" : "pad-panel"} aria-labelledby={tab === "snippets" ? "snippets-tab" : "pad-tab"}>
          <textarea ref={textarea} className={`composer ${tab === "pad" ? "pad-composer" : ""}`} aria-label={tab === "snippets" ? "Snippet text" : "Shared pad"} placeholder={tab === "snippets" ? "Paste text, a link, or code…" : "A shared place to write…"} value={activeText} onChange={(event) => tab === "snippets" ? setText(event.target.value) : state.editPad(event.target.value)} disabled={unavailable || !room} spellCheck={false} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (tab === "snippets") void send(); else void state.savePad(); } }} />
        </div></div>
        <div className="composer-footer"><span className={tooLarge ? "byte-count danger" : "byte-count"}>{tooLarge ? "Over 64 KB" : `${bytes.toLocaleString()} / 64 KB`}</span>{tab === "snippets" ? <button className="button button-primary" onClick={() => void send()} disabled={!text.trim() || tooLarge || unavailable || !room || state.sendBusy}>{state.sendBusy ? <><LoaderCircle size={16} className="spin" /> Sending…</> : <>Send snippet <ArrowRight size={17} /></>}</button> : <div className="pad-actions"><span className="save-status" aria-live="polite">{pad.saving ? "Saving…" : pad.conflict ? "Conflict" : pad.dirty ? "Unsaved" : <><Check size={13} /> Saved</>}</span><CopyButton compact label="Copy pad" text={pad.text} disabled={!pad.text || unavailable} />{pad.dirty && <button className="icon-button" aria-label="Retry saving pad" onClick={() => void state.savePad()} disabled={!!pad.conflict || pad.saving || tooLarge || unavailable}><RefreshCw size={15} /></button>}</div>}</div>
      </Surface>
      {pad.conflict && <Surface className="conflict-panel"><h2>Another device edited the pad.</h2><p>Both versions are safe here. Choose which to keep.</p><div className="conflict-versions"><div><h3>Your version</h3><pre>{pad.text}</pre></div><div><h3>Latest version</h3><pre>{pad.conflict.text}</pre></div></div><div className="conflict-actions"><button className="button button-glass" onClick={() => void state.resolve("latest")}>Use latest</button><button className="button button-glass" onClick={() => void state.resolve("snippet")}>Save mine as snippet</button><button className="button button-primary" onClick={() => void state.resolve("mine")}>Replace with mine</button></div></Surface>}
      <Surface className="history-panel"><div className="history-heading"><h2>Recent snippets</h2><span>{snippets.length} {snippets.length === 1 ? "item" : "items"}</span></div>{snippets.length > 5 && <input className="search-snippets" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in this room" aria-label="Find snippets" />}
        {snippets.length === 0 ? <div className="empty-snippets"><div className="empty-icon"><ArrowLeft size={21} /><ArrowRight size={21} /></div><p>{connection === "connecting" ? "Opening your room…" : "No snippets yet."}</p></div> : <div className="snippet-list">{filteredSnippets.map((item) => <SnippetRow key={item.id} item={item} disabled={unavailable} remove={state.removeSnippet} />)}{query && filteredSnippets.length === 0 && <p className="empty-search">No matching snippets.</p>}</div>}
      </Surface>
    </div><aside className="share-aside"><Surface className="share-panel">{shareContent}</Surface></aside></div>
    {room && <div className="room-capacity"><span>{Math.ceil(room.bytes / 1024)} KB / 2 MB</span><span>{snippets.length} / 50 snippets</span></div>}
    {share && <Modal title="Share room" onClose={() => setShare(false)}>{shareContent}</Modal>}
    {destroy && <Modal title="Delete this room?" onClose={() => setDestroy(false)}><p className="muted">This removes the pad and all snippets for everyone. It cannot be undone.</p><div className="modal-actions"><button className="button button-glass" onClick={() => setDestroy(false)}>Cancel</button><button className="button button-danger" disabled={deleting} onClick={async () => { setDeleting(true); if (await state.deleteRoom()) { setDeleted(true); setDestroy(false); } setDeleting(false); }}>{deleting ? "Deleting…" : "Delete room"}</button></div></Modal>}
  </main></Shell>;
}

const ShareContent = memo(function ShareContent({ link, disabled }: { link: string; disabled: boolean }) {
  return <div className="share-content"><h2>Continue on<br />another device.</h2><div className={`qr-frame ${disabled ? "qr-disabled" : ""}`}>{link && !disabled ? <QRCodeSVG value={link} size={180} level="M" marginSize={0} title="Scan to open this room" /> : <QrCode size={90} color="#72796b" />}</div><CopyButton text={link} label="Copy room link" disabled={!link || disabled} /><p className="link-warning"><LockKeyhole size={12} /> Anyone with the link can access this room.</p></div>;
});
const SnippetRow = memo(function SnippetRow({ item, disabled, remove }: { item: Snippet; disabled: boolean; remove: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const url = /^https?:\/\/\S+$/i.test(item.text.trim()) ? item.text.trim() : null;
  const isCode = !url && /[{};]|^(const|let|function|import|def|class)\b/m.test(item.text);
  const Icon = url ? Link2 : isCode ? Code2 : FileText;
  return <article className={`snippet-row ${item.broken ? "broken-snippet" : ""}`}><div className="snippet-type"><Icon size={20} strokeWidth={1.5} /></div><div className="snippet-body"><pre className={`${expanded ? "expanded" : ""} ${isCode ? "code-text" : ""}`}>{item.text}</pre><div className="snippet-meta"><SnippetAge createdAt={item.createdAt} />{url && !item.broken && <a href={url} target="_blank" rel="noopener noreferrer">Open <ArrowRight size={10} /></a>}{(item.text.length > 120 || item.text.includes("\n")) && <button className="text-button expand-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Less" : "More"}<ChevronDown size={11} /></button>}</div></div><div className="snippet-actions"><CopyButton text={item.text} label="Copy snippet" compact disabled={disabled || item.broken} /><button className="icon-button delete-snippet" onClick={() => remove(item.id)} disabled={disabled} aria-label="Delete snippet"><Trash2 size={16} /></button></div></article>;
});

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <span>{remainingTime(expiresAt, now)}</span>;
}
function SnippetAge({ createdAt }: { createdAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const age = Math.max(0, Math.floor((now - createdAt) / 60000));
  return <time dateTime={new Date(createdAt).toISOString()}>{age < 1 ? "Just now" : age < 60 ? `${age} min ago` : age < 1440 ? `${Math.floor(age / 60)}h ago` : `${Math.floor(age / 1440)}d ago`}</time>;
}
