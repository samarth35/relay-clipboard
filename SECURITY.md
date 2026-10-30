# Security

## Room capability

A room uses a random 128-bit identifier, a random 256-bit access token, and an independent random 256-bit encryption key. All randomness comes from the platform cryptographic generator.

Links contain `#key=…&token=…`. The fragment is processed in the browser, not included in the page request. API calls send the token as a bearer authorization header. The server compares its SHA-256 digest with the verifier stored for that room; the encryption key is never sent to the server.

The full link grants equal access to everyone holding it, including room deletion. There are no accounts, owners, passwords, recovery mechanisms, or per-device permissions. Revocation means deleting the room and creating another. Sharing a link also shares its secrets with the application used to transmit it.

## Content encryption

Text is UTF-8 encoded and encrypted using Web Crypto AES-256-GCM with a fresh random 96-bit IV and a 128-bit authentication tag for every encryption. Each envelope contains only `v`, `iv`, and `ciphertext`, encoded using canonical base64url. Encryption keys are imported as non-extractable CryptoKeys for each operation.

Authenticated additional data is the UTF-8 encoding of the JSON array `["relay",1,roomId,kind,idOrRevision]`. Snippets use their immutable client-generated identifier. The pad uses its target revision (`expectedRevision + 1`). Modified ciphertext or a mismatched key, room, item, or revision fails decryption.

Room IDs, expiry, timestamps, item counts, revisions, and approximate sizes are metadata visible to the server. Content is decrypted only in browser memory. No plaintext, keys, or room tokens are written to localStorage, sessionStorage, or IndexedDB. The fragment remains in the address bar and may appear in browser history, bookmarks, browser synchronization, or extensions. Clipboard actions happen explicitly; system clipboard retention is outside the application's control.

## Server boundary

Every room operation requires the bearer capability. Unauthorized and missing rooms return the same public error. Redis Lua scripts atomically authenticate, check expiry and limits, and perform changes. Writes preserve absolute expiry, enforce 50 snippets and 2 MiB per room, and compare pad revisions. Snippet retry IDs prevent duplicate inserts. Rate counters are shared across server instances; IP keys use an HMAC with the server's secret salt. In Vercel, only the platform's forwarded client-IP header is used.

HTTP inputs are strictly validated. JSON bodies are capped while streaming; encrypted content is capped at 64 KiB of plaintext plus encryption overhead. Text is never rendered as HTML. Link previews are not fetched; single HTTP(S) links open with `noopener noreferrer`. API responses and room HTML are not cached.

The site uses HTTPS in production, a per-response nonce for scripts, self-hosted fonts, frame blocking, a no-referrer policy, and no third-party scripts, analytics, or external QR services. Inline styles remain allowed for controlled component styling; inline scripts require a nonce. Same-origin checks supplement, rather than replace, bearer authentication.

Redis access failure returns a service error. There is no in-memory production fallback, local-disk persistence, plaintext fallback, or successful-save indication before server acknowledgment. Local drafts remain in memory and leaving with an unsaved draft prompts the browser's native warning. Pad conflicts retain both versions until explicitly resolved.

## Expiry and deletion

The supported lifetimes are 10 minutes, 1 hour, 24 hours, 7 days, and 30 days. TTL and a server expiry check enforce the room's fixed deadline. A room deletion removes its content key and ends future authenticated access. Rate-limit metadata expires separately.

Provider backups, operational metadata, copies on other devices, screenshots, and previously downloaded content may outlive deletion or expiry. The UI does not promise secure erasure from those locations.

## Deployment

Keep Redis tokens and the rate-limit salt in Vercel's secret environment variables. The public repository must never contain runtime credentials, room links, logs with authorization headers, or real clipboard data. Use a separate datastore for cloud previews. A separate namespace is also enforced for every Vercel preview deployment as defense in depth.

CI uses a local Redis service and a loopback-only REST adapter with disposable test credentials. The adapter is a development process and is not exposed through any application route.

## Limitations

This is browser-based end-to-end encryption, not a guarantee against a malicious or compromised website operator, hosting provider that replaces delivered JavaScript, browser extension, or compromised device. Such code can read plaintext or keys after the page loads. CSP reduces injection risk but cannot prevent deliberate replacement of trusted code. Link holders are not authenticated people and can intentionally overwrite or delete shared content. A malicious storage server can withhold or replay an older complete state; revision checks protect normal concurrent edits, not all rollback attacks by a hostile server.

No independent security audit is claimed. Report security issues privately to the repository owner; do not post secrets or room links in public issues.
