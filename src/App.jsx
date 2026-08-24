/**
 * Test harness for BunnyMultiAudioPlayer.
 *
 * Fill in your library's CDN hostname + a video GUID, pick a language, hit Load.
 * The diagnostics panel shows every audio rendition Bunny published, which one
 * was selected and why — so you can verify the fallback chain without guessing.
 *
 * Config can also come from the URL:
 *   ?host=vz-xxxx.b-cdn.net&video=<guid>&lang=es
 */

import { useCallback, useMemo, useState } from 'react';
import BunnyMultiAudioPlayer from './BunnyMultiAudioPlayer.jsx';
import { buildHlsUrl } from './audioLang.js';
import './App.css';

const q = new URLSearchParams(window.location.search);

const LANG_CHOICES = [
  { code: '', label: '(none — use fallback)' },
  { code: 'en', label: 'English (en)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'de', label: 'German (de)' },
  { code: 'pt-BR', label: 'Portuguese, Brazil (pt-BR)' },
  { code: 'hi', label: 'Hindi (hi)' },
  { code: 'ja', label: 'Japanese (ja)' },
  { code: 'zz', label: 'Unavailable language (zz) — tests fallback' },
];

export default function App() {
  const [host, setHost] = useState(q.get('host') || '');
  const [video, setVideo] = useState(q.get('video') || '');
  const [lang, setLang] = useState(q.get('lang') ?? 'es');
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

  const src = useMemo(
    () => (host && video ? buildHlsUrl(host, video, signedParams) : ''),
    [host, video, signedParams],
  );

  const load = useCallback((e) => {
    e.preventDefault();
    setDiag(null);
    setLoaded(true);
    setNonce((n) => n + 1);
  }, []);

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
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANG_CHOICES.map((c) => (
              <option key={c.code || 'none'} value={c.code}>{c.label}</option>
            ))}
          </select>
          <small>Changes apply live — no reload, no restart.</small>
        </label>

        <label>
          <span>Fallback chain</span>
          <input value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="en" />
          <small>Comma-separated, tried in order.</small>
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
            preferredAudioLang={lang}
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
          <table>
            <thead>
              <tr><th>#</th><th>LANGUAGE</th><th>NAME</th><th>DEFAULT</th><th>selected</th></tr>
            </thead>
            <tbody>
              {diag.tracks.map((t, i) => (
                <tr key={i} className={i === diag.chosen ? 'hit' : undefined}>
                  <td>{i}</td>
                  <td>{t.lang || <em>none</em>}</td>
                  <td>{t.name || <em>none</em>}</td>
                  <td>{t.default ? 'yes' : ''}</td>
                  <td>{i === diag.chosen ? '←' : ''}</td>
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
