"use client";

import { ArrowRight, ArrowUpRight, Clock3, Link2, LoaderCircle, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { newSecrets, parseSecrets, roomLink, tokenDigest } from "@/lib/crypto";
import { EXPIRIES } from "@/lib/shared";
import Surface from "./surface";
import { Shell } from "./shell";

export default function Home() {
  const [expiry, setExpiry] = useState(86400);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const secrets = newSecrets();
      const result = await api<{ id: string }>("", undefined, "POST", { accessTokenHash: await tokenDigest(secrets.token), expiresIn: expiry });
      window.location.assign(roomLink(window.location.origin, result.id, secrets));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create a room."); setBusy(false); }
  }
  function join(event: React.FormEvent) {
    event.preventDefault();
    try {
      const url = new URL(link.trim(), window.location.origin);
      if (url.origin !== window.location.origin || !/^\/r\/[a-f0-9]{32}$/.test(url.pathname)) throw new Error();
      parseSecrets(url.hash);
      window.location.assign(`${url.pathname}${url.hash}`);
    } catch { setError("Paste a full room link from this site."); }
  }
  return <Shell><main className="home-main">
    <section className="home-hero">
      <div className="home-intro"><h1>Your clipboard.<br /><span>Everywhere.</span></h1><p>Text, links, code.<br />One private link. Any device.</p>
        <div className="hero-assurances"><span><LockKeyhole size={15} /> End-to-end encrypted</span><span><Clock3 size={15} /> Yours until it expires</span></div>
      </div>
      <Surface className="create-panel"><div className="create-panel-inner">
        <div className="panel-symbol"><ArrowUpRight size={24} strokeWidth={1.5} /></div>
        <h2>Create a room</h2>
        <fieldset className="expiry-field"><legend>Keep it for</legend><div className="expiry-options">{EXPIRIES.map((item) => <button type="button" aria-pressed={expiry === item.seconds} className={expiry === item.seconds ? "expiry-option selected" : "expiry-option"} key={item.seconds} onClick={() => setExpiry(item.seconds)}>{item.short}</button>)}</div></fieldset>
        <button className="button button-primary create-button" disabled={busy} onClick={() => void create()}>{busy ? <><LoaderCircle className="spin" size={18} /> Creating…</> : <>Create room <ArrowRight size={18} /></>}</button>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <form onSubmit={join} className="join-form"><label htmlFor="room-link">Have a room link?</label><div className="join-input-wrap"><Link2 size={16} /><input type="text" id="room-link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste your room link" autoComplete="off" spellCheck={false} /><button aria-label="Open room" disabled={!link.trim()}><ArrowRight size={18} /></button></div></form>
        <p className="small-note"><LockKeyhole size={12} /> No account needed.</p>
      </div></Surface>
    </section>
    <section className="steps" aria-label="How to use Relay"><div><span className="step-number">01</span><span>Create a room</span></div><span className="step-line" /><div><span className="step-number">02</span><span>Share the link</span></div><span className="step-line" /><div><span className="step-number">03</span><span>Pick up anywhere</span></div></section>
  </main></Shell>;
}
