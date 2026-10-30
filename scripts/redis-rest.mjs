// Loopback-only REST bridge for local development and browser tests.
// Production always uses Upstash; this process never runs in Vercel Functions.
import http from 'node:http';
import { createClient } from 'redis';
const client = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6389' });
client.on('error', () => console.error('Local Redis connection failed.'));
await client.connect();
const token = process.env.LOCAL_REDIS_TOKEN;
if (!token) throw new Error('Set LOCAL_REDIS_TOKEN for the local REST bridge.');
const port = Number(process.env.LOCAL_REDIS_REST_PORT || 8079);
const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(403).end(JSON.stringify({ error: 'Forbidden' })); return;
  }
  try {
    const parts = []; let length = 0;
    for await (const part of request) { length += part.length; if (length > 3 * 1024 * 1024) throw new Error(); parts.push(part); }
    const command = JSON.parse(Buffer.concat(parts).toString());
    const run = async (cmd) => {
      if (!Array.isArray(cmd) || !cmd.every((part) => ['string', 'number'].includes(typeof part))) throw new Error();
      try { return { result: await client.sendCommand(cmd.map(String)) }; }
      catch { return { error: 'Redis command failed' }; }
    };
    if (request.url === '/pipeline') response.end(JSON.stringify(await Promise.all(command.map(run))));
    else response.end(JSON.stringify(await run(command)));
  } catch { response.writeHead(400).end(JSON.stringify({ error: 'Invalid request' })); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local Redis REST bridge listening on 127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { server.close(); await client.quit(); process.exit(0); });
