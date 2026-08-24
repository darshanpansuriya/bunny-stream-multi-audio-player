# Bunny Stream multi-audio — preselect the user's audio language

Working implementation of **Option A**: play Bunny Stream's HLS output in your own
player so you can choose the audio track programmatically. Bunny's iframe player has no
embed parameter and no Player.js method for audio tracks, and it's cross-origin, so this
is the only way to preselect a language on a single multi-audio video.

```
src/audioLang.js               matching + fallback logic (no DOM, unit-tested)
src/BunnyMultiAudioPlayer.jsx   the drop-in component
src/BunnyMultiAudioPlayer.css   minimal styles
src/App.jsx                     test harness: config form + diagnostics + manifest inspector
server/sign-url.js              OPTIONAL token signer, only if CDN token auth is on
test/audioLang.test.mjs         29 assertions, `npm test`, no browser needed
```

There is also a **single-file, zero-build tester** (`bunny-audio-test.html`) delivered
alongside this project — open it in a browser, paste your hostname and video ID, done.
Use that first; use this project when you're ready to integrate.

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # matcher unit tests
```

You need two values from the Bunny dashboard:

| Value | Where |
|---|---|
| **CDN hostname** — `vz-xxxxxxxx-xxx.b-cdn.net` | Stream → your library → **API** / Delivery. This is the pull-zone host, *not* `player.mediadelivery.net`. |
| **Video ID** — a GUID | The video's page, or the Manage Videos API. |

The playback URL the player builds is:

```
https://{cdn_hostname}/{video_id}/playlist.m3u8
```

You can also deep-link the harness: `http://localhost:5173/?host=vz-xxxx.b-cdn.net&video=<guid>&lang=es`

---

## 2. Prerequisites on the Bunny side

1. **Library → Encoding → "Enable Multi Audio Track Support"** must be on, and the video
   must have been encoded *after* that. Existing videos need a re-encode — the player can
   only pick between renditions Bunny actually published.
2. The source file must carry language metadata on its audio streams, or the manifest has
   no `LANGUAGE` attribute and the menu shows "Audio 1 / Audio 2". Fix it before upload:

   ```bash
   ffmpeg -i in.mp4 -map 0 -c copy \
     -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa out.mp4
   ```
3. **Check what got published before debugging anything else.** Either hit *Inspect
   manifest* in the harness, or:

   ```bash
   curl -s https://vz-xxxx.b-cdn.net/<videoId>/playlist.m3u8 | grep EXT-X-MEDIA
   ```

   One `TYPE=AUDIO` line means one audio track — the problem is the encode, not the code.
4. **Security.** Bunny has two unrelated token mechanisms. *Embed view token
   authentication* signs the iframe and is irrelevant here. *CDN token authentication*
   signs direct file URLs and does apply — see `server/sign-url.js`, and note that HLS
   needs a **directory** token (`token_path`), not a per-file one, or the playlist loads
   and every segment 403s. Referrer allow-lists must include your app's origin. Leave both
   off while you're first testing.
5. **MediaCage DRM** changes the player, not the logic: DRM playback needs Shaka or
   Bitmovin. The matching code transfers as-is; only the setup differs.

---

## 3. Use it in your app

```jsx
import BunnyMultiAudioPlayer from './BunnyMultiAudioPlayer.jsx';

<BunnyMultiAudioPlayer
  cdnHostname="vz-1a2b3c4d-e5f.b-cdn.net"
  videoId={video.guid}
  preferredAudioLang={user.audioLanguage}   // "es" | "es-419" | "spa" | "Spanish"
  fallbackLangs={['en']}
  onAudioTrackChange={(track) => savePreference(track.lang)}
/>
```

| Prop | Meaning |
|---|---|
| `cdnHostname` | Pull-zone host, with or without `https://` |
| `videoId` | Bunny video GUID |
| `preferredAudioLang` | The user's preference. Changing it re-selects **live**, without reloading the video. |
| `fallbackLangs` | Ordered fallbacks, default `['en']` |
| `signedParams` | `{ token, expires, token_path }` when CDN token auth is on — sign server-side |
| `onAudioTrackChange` | `(track, index)` — fires on the initial selection and on every switch |
| `onDiagnostics` | `({ engine, src, tracks, chosen, reason })` — what the harness renders |
| `showAudioMenu` | Set `false` if you're supplying your own menu |

### How a track gets chosen

1. Exact tag match, region included — `pt-BR` beats plain `pt`.
2. Base-language match on the manifest's `LANGUAGE` attribute (`es-419`, `spa`, `es` all → `es`).
3. Base-language match on the track *name*, for tracks with no `LANGUAGE`.
4. Each entry in `fallbackLangs`, in order.
5. The track flagged `DEFAULT=YES`.
6. Track 0.

Steps 5–6 mean the video never plays silent, whatever the preference. Every decision
comes back through `onDiagnostics` with a human-readable `reason` — worth logging in
staging so you can see which rule fired for real users.

---

## 4. Things that bite

- **Set the track before the first segment is appended.** The component does this on
  `MANIFEST_PARSED` / `AUDIO_TRACKS_UPDATED`, so playback *starts* in the right language.
  Setting `hls.audioTrack` after `play()` flushes and refills the audio buffer — audible
  on slow connections.
- **hls.js ≥ 1.7 often reports `audioTracks` as empty at `MANIFEST_PARSED`** and fills it
  a tick later on `AUDIO_TRACKS_UPDATED`. Verified here against hls.js 1.7.1. If you write
  your own version, listen to *both* events or you'll silently never select anything.
- **`hls.audioTrack` is an index** into `hls.audioTracks`, not a language string.
- **Safari** plays HLS natively and hls.js is inert there, so the component switches to the
  `video.audioTracks` `AudioTrackList` (`track.enabled = true`). `HTMLMediaElement.audioTracks`
  is Safari-only — which is fine, since other browsers take the hls.js path.
- **Autoplay with sound still needs a user gesture**, unrelated to audio-track logic.
- **Direct HLS playback bypasses Bunny's embed-level view counting.** If those numbers
  matter, add your own beacons, or keep the iframe for analytics-sensitive placements.
- **A CORS error on the manifest** almost always means token auth or a referrer allow-list,
  not a code problem.

---

## 5. How this was verified

Rather than trusting a manifest I couldn't see, I built one: a two-language HLS stream
(English flagged `DEFAULT=YES`, Spanish second) and drove both the React app and the
single-file tester against it in headless Chromium.

```bash
ffmpeg -f lavfi -i "testsrc=size=320x180:rate=15:duration=6" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -f lavfi -i "sine=frequency=880:duration=6" \
  -map 0:v -map 1:a -map 2:a \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa \
  -c:v libvpx-vp9 -b:v 300k -deadline realtime -cpu-used 8 -g 30 -c:a libopus -b:a 48k \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -master_pl_name playlist.m3u8 \
  -var_stream_map "v:0,agroup:aud a:0,agroup:aud,default:yes,language:eng,name:English a:1,agroup:aud,language:spa,name:Spanish" \
  -hls_fmp4_init_filename "init_%v.mp4" -hls_segment_filename "s_%v_%03d.m4s" "out_%v.m3u8"
```

Serve that directory with an `Access-Control-Allow-Origin` header (Bunny sends one) and
point the harness at it. Results:

- `lang=es` selected index 1 (Spanish) **before playback**, overriding `DEFAULT=YES` on English.
- `lang=zz` fell back to English with the reason `"zz" unavailable — fell back to "en"`.
- Changing the preference live re-selected without reloading; the manual menu switched
  tracks and `AUDIO_TRACK_SWITCHED` confirmed each change.
- Video decoded and advanced; zero console errors.
- `npm test` — 29 assertions on the matcher.

VP9/Opus is used only because headless Chromium ships without H.264/AAC. Bunny's real
output is H.264/AAC and takes the identical code path.

---

## 6. If you'd rather not leave Bunny's player

Ask Bunny support for an `audio` / `audioLanguage` embed parameter — the player already
parses the renditions, so it's a small addition on their side. Until it exists, this is the
way. The alternative that keeps their player is one video per language, selecting the video
ID instead of the audio track: simpler, but N× storage and no mid-playback switching.
