"use client";

import Link from "next/link";
import { ArrowLeftRight, ArrowUpRight, Check, Copy, LockKeyhole, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GlassControl } from "./surface";

export function Shell({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState(false);
  return <div className="site-shell">
    <div className="ambient ambient-one" aria-hidden="true" /><div className="ambient ambient-two" aria-hidden="true" />
    <header className="site-header">
      <Link href="/" className="wordmark" aria-label="Relay home"><ArrowLeftRight aria-hidden="true" /><span>relay</span><span className="brand-period">.</span></Link>
      <nav aria-label="Main navigation"><button className="text-button" onClick={() => setHelp(true)}>How it works</button><span className="nav-divider" /><span className="encrypted-label"><LockKeyhole size={14} /> Encrypted</span></nav>
    </header>
    {children}
    <footer className="site-footer"><span><LockKeyhole size={13} /> A private space between devices.</span><button className="text-button" onClick={() => setHelp(true)}>Privacy <ArrowUpRight size={13} /></button></footer>
    {help && <Modal title="One link. Any device." onClose={() => setHelp(false)}>
      <ol className="help-steps"><li>Create a room and choose its lifetime.</li><li>Open the full link or scan the QR code on another device.</li><li>Send snippets or use the shared pad.</li></ol>
      <div className="privacy-detail"><h3>Private by design</h3><p>Your browser encrypts content before upload. The key stays in your room link. Anyone with that link can read, edit, or delete the room.</p><p>Lost links cannot be recovered. Expiry ends access and removes live room data; provider backups may remain temporarily.</p><p>Use devices you trust. A leaked link or compromised device or website can expose content. Connection metadata is visible to hosting providers.</p></div>
    </Modal>}
  </div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    element?.addEventListener("cancel", cancel);
    return () => { element?.removeEventListener("cancel", cancel); element?.close(); };
  }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="modal-heading" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-heading"><h2 id="modal-heading">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>
    {children}
  </dialog>;
}

export function CopyButton({ text, label, compact = false, disabled = false }: { text: string; label: string; compact?: boolean; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch { setFallback(true); }
  }
  const button = <button className={compact ? "icon-button" : "button button-glass copy-room-button"} onClick={() => void copy()} disabled={disabled} aria-label={copied ? "Copied" : label} title={label}>
      {copied ? <Check size={17} /> : <Copy size={17} />}{!compact && <span>{copied ? "Copied" : label}</span>}
    </button>;
  return <>
    {compact ? button : <GlassControl stretch>{button}</GlassControl>}
    {fallback && <Modal title="Copy manually" onClose={() => setFallback(false)}><p className="muted">Select the text and use your device’s copy action.</p><textarea className="manual-copy" readOnly value={text} aria-label="Text to copy" onFocus={(event) => event.currentTarget.select()} autoFocus /></Modal>}
  </>;
}
