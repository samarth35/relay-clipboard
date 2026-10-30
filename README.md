# Relay

A private space between your devices. Move text, links, and code through end-to-end encrypted rooms. No accounts.

[Open Relay](https://relay-clipboard-phi.vercel.app)

## Features

- Snippet history and a shared pad with autosave and conflict protection.
- Secret links and locally generated QR codes.
- Room lifetimes from 10 minutes to 30 days.
- Liquid-glass surfaces, self-hosted typography, responsive layouts, and keyboard controls.
- AES-256-GCM encryption in the browser; the server stores ciphertext.

## Run locally

Requires Node.js 22 or newer and Redis storage.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and a random `RATE_LIMIT_SALT` in `.env.local`. The Vercel integration's `KV_REST_API_URL` and `KV_REST_API_TOKEN` names are also supported. Keep credentials out of Git.

For entirely local storage, start Redis on loopback port 6389 with persistence disabled. Set `REDIS_URL=redis://127.0.0.1:6389`, choose a local token, set both `LOCAL_REDIS_TOKEN` and `UPSTASH_REDIS_REST_TOKEN` to it, and use `UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079`. Run `npm run redis:local` alongside the app. This REST adapter is for local development only.

## Deploy on Vercel

1. Import this repository as a Next.js project.
2. Add Upstash for Redis from Vercel Marketplace. Connect the database to **Production**.
3. Set `RATE_LIMIT_SALT` as a secret. Generate a value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Deploy. Use a separate database for cloud Preview environments; unconfigured room APIs fail closed. Local development and CI use isolated Redis.

No application data is stored in Git or the Vercel filesystem. Redis TTL enforces expiry without a scheduled job. Rooms keep their original expiry when edited.

## Checks

```sh
npm test
npm run test:integration
npm run build
npm run typecheck
npm run test:e2e
```

Integration tests require Redis at `REDIS_URL` (default `redis://127.0.0.1:6389`). Browser tests require a production server at `RELAY_BASE_URL` (default `http://127.0.0.1:3001`) and its configured Redis REST endpoint. They use isolated browser contexts. GitHub Actions starts all test services without production credentials.

## Security

Anyone with the **complete room link** can read, write, and delete the room. Keep it private. Lost links cannot be recovered, and removing one device requires replacing the room. Expiry removes live server access; content already copied to a device cannot be recalled.

See [SECURITY.md](SECURITY.md) for the encryption protocol, API boundary, and limitations.

## Credits

[GlassSurface](https://reactbits.dev/components/glass-surface) by David Haz / React Bits provides refraction and frosted fallbacks. Its [MIT + Commons Clause license](licenses/react-bits.md) is included. Fonts are DM Sans, Space Grotesk, and JetBrains Mono, distributed through Fontsource under their respective open font licenses.

