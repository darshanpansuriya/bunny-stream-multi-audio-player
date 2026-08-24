/**
 * BunnyMultiAudioPlayer — Bunny Stream multi-audio with a preselected language.
 *
 * Bunny's iframe player has no embed parameter and no Player.js method for
 * audio tracks, and it's cross-origin, so the only way to preselect a language
 * is to play Bunny's HLS output yourself. That's what this does.
 *
 * Two playback paths:
 *   A. hls.js         — Chrome, Firefox, Edge, Android. Full control.
 *   B. native HLS     — Safari desktop + iOS, where hls.js is inert.
 *                       Uses the video element's AudioTrackList.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { buildHlsUrl, labelForTrack, pickAudioTrack } from './audioLang.js';
import './BunnyMultiAudioPlayer.css';

export default function BunnyMultiAudioPlayer({
  cdnHostname,                 // "vz-1a2b3c4d-e5f.b-cdn.net"
  videoId,                     // Bunny video GUID
  preferredAudioLang,          // "es" | "es-419" | "spa" | "Spanish"
  fallbackLangs = ['en'],
  signedParams = null,         // { token, expires, token_path } — signed SERVER-SIDE
  poster,
  autoPlay = false,
  muted = false,
  controls = true,
  className = '',
  showAudioMenu = true,
  onAudioTrackChange,          // (track, index) => void
  onDiagnostics,               // (info) => void  — engine, tracks, chosen, reason
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const appliedRef = useRef(false);   // did we already set the initial track?

  const [engine, setEngine] = useState(null);        // 'hls.js' | 'native' | null
  const [tracks, setTracks] = useState([]);          // [{ lang, name, label, default }]
  const [activeIndex, setActiveIndex] = useState(-1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const src = useMemo(
    () => buildHlsUrl(cdnHostname, videoId, signedParams),
    [cdnHostname, videoId, signedParams],
  );

  // Latest preference in refs, so changing it doesn't tear down the player.
  const prefRef = useRef(preferredAudioLang);
  prefRef.current = preferredAudioLang;
  const fbRef = useRef(fallbackLangs);
  fbRef.current = fallbackLangs;

  const diagRef = useRef(onDiagnostics);
  diagRef.current = onDiagnostics;
  const changeRef = useRef(onAudioTrackChange);
  changeRef.current = onAudioTrackChange;

  const report = useCallback((info) => {
    if (diagRef.current) diagRef.current(info);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Set up playback                                                     */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cdnHostname || !videoId) return undefined;

    setError(null);
    setTracks([]);
    setActiveIndex(-1);
    setReason('');
    appliedRef.current = false;

    /* ---------- Path A: hls.js ---------- */
    if (Hls.isSupported()) {
      setEngine('hls.js');

      const hls = new Hls({
        // Bunny serves the playlist and segments with permissive CORS.
        // Signed URLs go in the query string, so no credentials are needed.
        xhrSetup: (xhr) => { xhr.withCredentials = false; },
      });
      hlsRef.current = hls;

      const syncTrackList = () => {
        const list = hls.audioTracks || [];
        const shaped = list.map((t, i) => ({
          lang: t.lang || '',
          name: t.name || '',
          default: t.default === true,
          label: labelForTrack({ lang: t.lang, name: t.name }, i),
        }));
        setTracks(shaped);
        return shaped;
      };

      const applyPreference = () => {
        const list = hls.audioTracks || [];
        if (list.length === 0) return;
        const shaped = syncTrackList();
        const { index, reason: why } = pickAudioTrack(list, prefRef.current, fbRef.current);
        setReason(why);
        if (index !== -1 && hls.audioTrack !== index) {
          // Setting it here — before the first audio segment is appended —
          // means playback STARTS on the chosen language with no audible switch.
          hls.audioTrack = index;
        }
        setActiveIndex(hls.audioTrack);
        appliedRef.current = true;
        report({ engine: 'hls.js', src, tracks: shaped, chosen: index, reason: why });
      };

      // audioTracks first exists at MANIFEST_PARSED; AUDIO_TRACKS_UPDATED covers
      // manifests whose audio group changes with the video rendition.
      hls.on(Hls.Events.MANIFEST_PARSED, applyPreference);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (!appliedRef.current) applyPreference();
        else syncTrackList();
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_evt, data) => {
        setActiveIndex(data.id);
        const t = (hls.audioTracks || [])[data.id];
        if (t && changeRef.current) changeRef.current({ lang: t.lang, name: t.name }, data.id);
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setError(`Network error (${data.details}) — retrying. Check the hostname, video ID, token auth and referrer rules.`);
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setError(`Media error (${data.details}) — recovering.`);
          hls.recoverMediaError();
        } else {
          setError(`Fatal error: ${data.details}`);
          hls.destroy();
        }
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      return () => { hls.destroy(); hlsRef.current = null; };
    }

    /* ---------- Path B: native HLS (Safari) ---------- */
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      setEngine('native');
      video.src = src;

      const applyNative = () => {
        const at = video.audioTracks; // AudioTrackList — Safari only
        if (!at || at.length === 0) return;
        const list = Array.from(at).map((t) => ({ lang: t.language || '', name: t.label || '' }));
        const shaped = list.map((t, i) => ({ ...t, default: false, label: labelForTrack(t, i) }));
        setTracks(shaped);

        const { index, reason: why } = pickAudioTrack(list, prefRef.current, fbRef.current);
        setReason(why);
        if (index !== -1) {
          for (let i = 0; i < at.length; i += 1) at[i].enabled = i === index;
          setActiveIndex(index);
          if (changeRef.current) changeRef.current(list[index], index);
        }
        appliedRef.current = true;
        report({ engine: 'native', src, tracks: shaped, chosen: index, reason: why });
      };

      const onErr = () => setError('Native HLS failed to load. Check the URL, token auth and referrer rules.');

      video.addEventListener('loadedmetadata', applyNative);
      video.addEventListener('error', onErr);
      if (video.audioTracks && video.audioTracks.addEventListener) {
        video.audioTracks.addEventListener('addtrack', applyNative);
      }

      return () => {
        video.removeEventListener('loadedmetadata', applyNative);
        video.removeEventListener('error', onErr);
        if (video.audioTracks && video.audioTracks.removeEventListener) {
          video.audioTracks.removeEventListener('addtrack', applyNative);
        }
        video.removeAttribute('src');
        video.load();
      };
    }

    setEngine(null);
    setError('This browser cannot play HLS.');
    return undefined;
  }, [src, cdnHostname, videoId, report]);

  /* ------------------------------------------------------------------ */
  /* Re-apply when the user's preference changes (no reload)             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const hls = hlsRef.current;
    const video = videoRef.current;

    if (hls && hls.audioTracks && hls.audioTracks.length) {
      const { index, reason: why } = pickAudioTrack(hls.audioTracks, preferredAudioLang, fallbackLangs);
      setReason(why);
      if (index !== -1 && index !== hls.audioTrack) hls.audioTrack = index;
      return;
    }
    const at = video && video.audioTracks;
    if (at && at.length) {
      const list = Array.from(at).map((t) => ({ lang: t.language || '', name: t.label || '' }));
      const { index, reason: why } = pickAudioTrack(list, preferredAudioLang, fallbackLangs);
      setReason(why);
      if (index !== -1) {
        for (let i = 0; i < at.length; i += 1) at[i].enabled = i === index;
        setActiveIndex(index);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredAudioLang]);

  /* ------------------------------------------------------------------ */
  /* Manual switching                                                    */
  /* ------------------------------------------------------------------ */
  const selectTrack = useCallback((index) => {
    const hls = hlsRef.current;
    const video = videoRef.current;

    if (hls) {
      hls.audioTrack = index;          // AUDIO_TRACK_SWITCHED updates state
      setReason('switched manually');
      return;
    }
    const at = video && video.audioTracks;
    if (at && at.length > index) {
      for (let i = 0; i < at.length; i += 1) at[i].enabled = i === index;
      setActiveIndex(index);
      setReason('switched manually');
      if (changeRef.current) {
        changeRef.current({ lang: at[index].language, name: at[index].label }, index);
      }
    }
  }, []);

  return (
    <div className={`bma ${className}`.trim()}>
      <video
        ref={videoRef}
        className="bma-video"
        poster={poster}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        crossOrigin="anonymous"
      />

      {error && <p className="bma-error" role="alert">{error}</p>}

      {showAudioMenu && tracks.length > 0 && (
        <div className="bma-bar">
          <label className="bma-field">
            <span>Audio</span>
            <select
              value={activeIndex}
              onChange={(e) => selectTrack(Number(e.target.value))}
              disabled={tracks.length < 2}
            >
              {tracks.map((t, i) => (
                <option key={`${t.lang || 'x'}-${i}`} value={i}>
                  {t.label}{t.lang ? ` (${t.lang})` : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="bma-note">
            {engine} · {tracks.length} track{tracks.length === 1 ? '' : 's'}
            {reason ? ` · ${reason}` : ''}
          </span>
        </div>
      )}

      {showAudioMenu && tracks.length === 0 && !error && (
        <p className="bma-note">
          {engine ? 'Loading manifest…' : 'No playback engine.'}
        </p>
      )}
    </div>
  );
}
