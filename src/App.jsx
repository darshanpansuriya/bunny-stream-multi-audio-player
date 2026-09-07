/**
 * Test harness for BunnyMultiAudioPlayer.
 *
 * Fill in your library's CDN hostname + a video GUID, pick a language, hit Load.
 * The diagnostics panel shows every audio rendition Bunny published, which one
 * was selected and why — so you can verify the fallback chain without guessing.
 *
 * Config can also come from the URL:
 *   ?host=vz-xxxx.b-cdn.net&video=<guid>&lang=es
 *   ...&alias=yue%3DAudio   — repair a track Bunny mis-tagged
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import BunnyMultiAudioPlayer from './BunnyMultiAudioPlayer.jsx';
import { aliasTargetFor, buildHlsUrl, unreachableByLanguage } from './audioLang.js';
import LANGUAGES from './languages.js';
import './App.css';

const q = new URLSearchParams(window.location.search);

/** "yue=Audio, pt-BR=Portuguese 28" <-> { yue: 'Audio', 'pt-BR': 'Portuguese 28' } */
function parseAliases(text) {
  const out = {};
  for (const pair of String(text || '').split(',')) {
    const at = pair.indexOf('=');
    if (at === -1) continue;
    const code = pair.slice(0, at).trim();
    const target = pair.slice(at + 1).trim();
    if (code && target) out[code] = target;
  }
  return out;
}

function formatAliases(map) {
  return Object.entries(map).map(([code, target]) => `${code}=${target}`).join(', ');
}

/**
 * Which language lives on a mis-tagged track is not in the manifest — Bunny
 * overwrote it — so it is stated once, by ear, and kept per video from then on.
 */
const aliasStoreKey = (guid) => `bma-aliases:${guid}`;

function readStoredAliases(guid) {
  try { return window.localStorage.getItem(aliasStoreKey(guid)) || ''; } catch { return ''; }
}

function writeStoredAliases(guid, text) {
  try {
    if (text) window.localStorage.setItem(aliasStoreKey(guid), text);
    else window.localStorage.removeItem(aliasStoreKey(guid));
  } catch { /* private mode — the box still works for this session */ }
}

const LANG_CHOICES = [
  { code: '', label: '(none — use fallback)' },
  ...LANGUAGES.map(({ name, code }) => ({ code, label: `${name} (${code})` })),
  { code: 'zz', label: 'Unavailable language (zz) — tests fallback' },
];

export default function App() {
  const [host, setHost] = useState(q.get('host') || '');
  const [video, setVideo] = useState(q.get('video') || '');
  const [lang, setLang] = useState(q.get('lang') ?? 'es');
  const [customLang, setCustomLang] = useState('');
  const [aliasText, setAliasText] = useState(
    q.get('alias') || readStoredAliases(q.get('video') || ''),
  );
  const [aliasVideo, setAliasVideo] = useState(q.get('video') || '');
  const [fallback, setFallback] = useState('en');
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState('');
  const [tokenPath, setTokenPath] = useState('');

  const [loaded, setLoaded] = useState(Boolean(q.get('host') && q.get('video')));
  const [nonce, setNonce] = useState(0);          // force a remount on Load
  const [diag, setDiag] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [manifestErr, setManifestErr] = useState(null);

  const signedParams = useMemo(() => {
    if (!token || !expires) return null;
    const p = { token, expires };
    if (tokenPath) p.token_path = tokenPath;
    return p;
  }, [token, expires, tokenPath]);

  const fallbackLangs = useMemo(
    () => fallback.split(',').map((s) => s.trim()).filter(Boolean),
    [fallback],
  );

  // A typed code always wins, so any tag Bunny publishes can be targeted —
  // including ones missing from the dropdown, and "#1" to force a position.
  const effectiveLang = customLang.trim() || lang;

  const trackAliases = useMemo(() => {
    const map = parseAliases(aliasText);
    return Object.keys(map).length ? map : null;
  }, [aliasText]);

  // Remember the map against the video it describes, so a language only has to
  // be identified by ear once.
  useEffect(() => {
    if (aliasVideo) writeStoredAliases(aliasVideo, aliasText);
  }, [aliasVideo, aliasText]);

  /** Point the currently selected language at one track — the assign buttons. */
  const assignAlias = useCallback((index) => {
    const code = effectiveLang.trim();
    if (!code || code.startsWith('#') || !diag) return;
    const target = aliasTargetFor(diag.tracks, index);
    if (!target) return;
    setAliasText((prev) => formatAliases({ ...parseAliases(prev), [code]: target }));
  }, [effectiveLang, diag]);

  const assignable = Boolean(effectiveLang.trim()) && !effectiveLang.trim().startsWith('#');

  /** Tracks that no language code can select — the ones that need assigning. */
  const unreachable = useMemo(
    () => (diag ? unreachableByLanguage(diag.tracks) : []),
    [diag],
  );

  const src = useMemo(
    () => (host && video ? buildHlsUrl(host, video, signedParams) : ''),
    [host, video, signedParams],
  );

  const load = useCallback((e) => {
    e.preventDefault();
    // Loading a different video swaps in whatever was identified for that one.
    if (video !== aliasVideo) {
      setAliasText(readStoredAliases(video));
      setAliasVideo(video);
    }
    setDiag(null);
    setLoaded(true);
    setNonce((n) => n + 1);
  }, [video, aliasVideo]);

  /** Fetch the manifest and show the audio renditions Bunny actually published. */
  const inspect = useCallback(async () => {
    setManifest(null);
    setManifestErr(null);
    if (!src) return;
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      const media = text.split('\n').filter((l) => l.startsWith('#EXT-X-MEDIA'));
      setManifest({
        audio: media.filter((l) => l.includes('TYPE=AUDIO')),
        other: media.filter((l) => !l.includes('TYPE=AUDIO')),
        raw: text.slice(0, 4000),
      });
    } catch (err) {
      setManifestErr(
        `${err.message}. If this is a CORS or 403 error, the pull zone has token authentication or a referrer allow-list — see the README.`,
      );
    }
  }, [src]);

  return (
    <main className="wrap">
      <h1>Bunny Stream — default audio language test</h1>
      <p className="lede">
        Plays Bunny&apos;s HLS output in hls.js (or Safari&apos;s native player) and preselects an
        audio track, which the Bunny iframe player cannot do.
      </p>

      <form className="card grid" onSubmit={load}>
        <label>
          <span>CDN hostname</span>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="vz-1a2b3c4d-e5f.b-cdn.net"
            required
          />
          <small>Stream → your library → API / Delivery. Not the iframe host.</small>
        </label>

        <label>
          <span>Video ID (GUID)</span>
          <input
            value={video}
            onChange={(e) => setVideo(e.target.value)}
            placeholder="8f3b0d7e-1c2a-4f55-9a10-6b7c8d9e0f11"
            required
          />
        </label>

        <label>
          <span>User&apos;s preferred language</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={Boolean(customLang.trim())}
          >
            {LANG_CHOICES.map((c) => (
              <option key={c.code || 'none'} value={c.code}>{c.label}</option>
            ))}
          </select>
          <small>Changes apply live — no reload, no restart.</small>
        </label>

        <label>
          <span>…or any tag from the manifest</span>
          <input
            value={customLang}
            onChange={(e) => setCustomLang(e.target.value)}
            placeholder="yue, zh-HK, pt-BR, #1"
          />
          <small>
            Overrides the dropdown. Matches the manifest&apos;s LANGUAGE, then its NAME;
            <code>#1</code> forces the track at that position when Bunny published no
            language metadata at all.
          </small>
        </label>

        <label>
          <span>Fallback chain</span>
          <input value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="en" />
          <small>Comma-separated, tried in order.</small>
        </label>

        <label className="span2">
          <span>Track aliases — repair tracks Bunny mis-tagged</span>
          <input
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder="yue=Audio, pt=Portuguese, pt-BR=Portuguese 28"
          />
          <small>
            <code>code=NAME</code> pairs, comma-separated. Points a language code at a
            track&apos;s manifest NAME (or <code>#40</code>) when Bunny wrote the wrong
            LANGUAGE — check the NAME column below for what to point at. Aliased tracks
            are renamed in the player&apos;s own Audio menu too, so it lists real language
            names. Alias <em>both</em> tracks when two share a tag, or the unaliased one
            still wins on the raw tag.
          </small>
        </label>

        <details className="span2">
          <summary>CDN token authentication (only if enabled on the pull zone)</summary>
          <div className="grid inner">
            <label>
              <span>token</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <label>
              <span>expires</span>
              <input value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
            <label>
              <span>token_path</span>
              <input
                value={tokenPath}
                onChange={(e) => setTokenPath(e.target.value)}
                placeholder="/<videoId>/"
              />
              <small>
                HLS loads many files, so sign the <em>directory</em>, not one file.
                Generate all of this server-side — see <code>server/sign-url.js</code>.
              </small>
            </label>
          </div>
        </details>

        <div className="span2 row">
          <button type="submit">Load video</button>
          <button type="button" onClick={inspect} disabled={!src}>Inspect manifest</button>
        </div>
      </form>

      {src && <p className="mono break">{src}</p>}

      {loaded && host && video && (
        <div className="card">
          <BunnyMultiAudioPlayer
            key={nonce}
            cdnHostname={host}
            videoId={video}
            preferredAudioLang={effectiveLang}
            trackAliases={trackAliases}
            fallbackLangs={fallbackLangs}
            signedParams={signedParams}
            onDiagnostics={setDiag}
            onAudioTrackChange={(t, i) => console.log('audio track ->', i, t)}
          />
        </div>
      )}

      {diag && (
        <section className="card">
          <h2>Diagnostics</h2>
          <p>
            Engine <strong>{diag.engine}</strong> · selected index{' '}
            <strong>{diag.chosen}</strong> · <em>{diag.reason}</em>
          </p>
          {unreachable.length > 0 && (
            <p className="warn">
              {unreachable.length} track{unreachable.length === 1 ? '' : 's'} cannot be
              reached by <em>any</em> language code — each shares its tag with an earlier
              track, so the earlier one always wins:{' '}
              {unreachable.map((u) => `#${u.index} ${u.lang || '?'}/${u.name || '?'}`).join(', ')}.
              Bunny overwrote what language they hold, so play each one, pick the right
              language above, and press <strong>assign</strong> on its row. That is stored
              against this video — you only do it once.
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>#</th><th>LANGUAGE</th><th>NAME</th><th>menu label</th>
                <th>DEFAULT</th><th>selected</th><th>assign</th>
              </tr>
            </thead>
            <tbody>
              {diag.tracks.map((t, i) => (
                <tr key={i} className={i === diag.chosen ? 'hit' : undefined}>
                  <td>{i}</td>
                  <td>{t.lang || <em>none</em>}</td>
                  <td>{t.name || <em>none</em>}</td>
                  <td>{t.label}</td>
                  <td>{t.default ? 'yes' : ''}</td>
                  <td>{i === diag.chosen ? '←' : ''}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => assignAlias(i)}
                      disabled={!assignable}
                      title={assignable
                        ? `This track is ${effectiveLang}`
                        : 'Pick a language above first'}
                    >
                      = {assignable ? effectiveLang : '…'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {diag.tracks.length < 2 && (
            <p className="warn">
              Only one audio rendition. Enable “Enable Multi Audio Track Support” in the
              library&apos;s Encoding settings and re-encode the video — the player can only
              choose between tracks Bunny actually published.
            </p>
          )}
        </section>
      )}

      {manifestErr && <p className="warn">{manifestErr}</p>}

      {manifest && (
        <section className="card">
          <h2>Manifest audio renditions</h2>
          {manifest.audio.length === 0
            ? <p className="warn">No <code>#EXT-X-MEDIA:TYPE=AUDIO</code> lines — this video has no separate audio tracks.</p>
            : <pre>{manifest.audio.join('\n')}</pre>}
          {manifest.other.length > 0 && (
            <>
              <h3>Other EXT-X-MEDIA (subtitles etc.)</h3>
              <pre>{manifest.other.join('\n')}</pre>
            </>
          )}
        </section>
      )}
    </main>
  );
}
