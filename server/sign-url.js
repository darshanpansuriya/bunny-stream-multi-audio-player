/**
 * OPTIONAL — only needed if the Stream library's pull zone has CDN token
 * authentication enabled. Leave it off while you're testing the player.
 *
 * Two things are easy to confuse:
 *   • Embed view token auth  — signs the *iframe* URL: SHA256_HEX(key + videoId + expires).
 *     Irrelevant here, because Option A doesn't use the iframe.
 *   • CDN token auth         — signs the *direct file* URLs. This is the one that
 *     matters for playing playlist.m3u8 yourself.
 *
 * IMPORTANT for HLS: a single HLS playback fetches the master playlist, one or
 * more media playlists, and hundreds of segments. A token signed for one exact
 * file path only authorises that file, so use the *directory* form
 * (`token_path`) — otherwise the master playlist loads and every segment 403s.
 *
 * Run it: node server/sign-url.js
 * Then POST /sign { videoId } and hand the returned params to the player.
 *
 * The exact byte order of the advanced-token message is Bunny's, not ours, and
 * their docs and reference repo phrase it slightly differently. Verify against
 * BunnyWay/BunnyCDN.TokenAuthentication for your zone before shipping; the
 * helper below follows the documented "path + expires + sorted params" order.
 */

import crypto from 'node:crypto';
import http from 'node:http';

const SECURITY_KEY = process.env.BUNNY_CDN_TOKEN_KEY || '';   // pull zone → Security → token key
const TTL_SECONDS = Number(process.env.BUNNY_TOKEN_TTL || 3600);
const PORT = Number(process.env.PORT || 8787);

const base64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

/**
 * Advanced (HS256) token over a directory prefix — the right shape for HLS.
 * @returns { token, expires, token_path }
 */
export function signDirectory(videoId, { key = SECURITY_KEY, ttl = TTL_SECONDS } = {}) {
  if (!key) throw new Error('BUNNY_CDN_TOKEN_KEY is not set');

  const expires = Math.floor(Date.now() / 1000) + ttl;
  const tokenPath = `/${videoId}/`;

  // Signed parameters: everything except `token` and `expires`, sorted
  // alphabetically and joined as key=value pairs with '&'. token_path is one of them.
  const params = { token_path: tokenPath };
  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  const message = `${tokenPath}${expires}${signingData}`;
  const mac = crypto.createHmac('sha256', key).update(message).digest();

  return { token: `HS256-${base64url(mac)}`, expires: String(expires), token_path: tokenPath };
}

/**
 * Basic (MD5) token over one exact file path. Documented and simple, but it
 * authorises a single file — fine for an MP4, NOT enough for HLS segments.
 */
export function signFileBasic(path, { key = SECURITY_KEY, ttl = TTL_SECONDS } = {}) {
  if (!key) throw new Error('BUNNY_CDN_TOKEN_KEY is not set');
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const hash = crypto.createHash('md5').update(`${key}${path}${expires}`).digest();
  return { token: base64url(hash), expires: String(expires) };
}

/* ------------------------------------------------------------------ */
/* Tiny dev server                                                     */
/* ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  http
    .createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

      if (req.method !== 'POST' || !req.url.startsWith('/sign')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'POST /sign { "videoId": "..." }' }));
        return;
      }

      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { videoId } = JSON.parse(body || '{}');
          if (!videoId) throw new Error('videoId is required');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(signDirectory(videoId)));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    })
    .listen(PORT, () => console.log(`token signer on http://localhost:${PORT}/sign`));
}
