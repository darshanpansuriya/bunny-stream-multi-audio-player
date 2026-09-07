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
| `preferredAudioLang` | The user's preference. Changing it re-selects **live**, without reloading the video. Also accepts a track `NAME`, or `"#3"` to force a position. |
| `fallbackLangs` | Ordered fallbacks, default `['en']` |
| `trackAliases` | `{ yue: 'Audio' }` — points a language code at a track's `NAME`, `LANGUAGE` or `"#40"`, for tracks Bunny mis-tagged. See below. |
| `signedParams` | `{ token, expires, token_path }` when CDN token auth is on — sign server-side |
| `onAudioTrackChange` | `(track, index)` — fires on the initial selection and on every switch |
| `onDiagnostics` | `({ engine, src, tracks, chosen, reason })` — what the harness renders |
| `showAudioMenu` | Set `false` if you're supplying your own menu |

### How a track gets chosen

0. An explicit position — pass `"#1"` (or the number `1`) to force track 1 outright.
1. Exact tag match, region included — `pt-BR` beats plain `pt`.
2. Exact *name* match, for tracks Bunny published with no `LANGUAGE` at all.
3. Region disambiguation from the track name, when several tracks share one base
   language — see *Regions* below.
4. Base-language match on the manifest's `LANGUAGE` attribute (`es-419`, `spa`, `es` all → `es`).
5. Base-language match on the track *name*, for tracks with no `LANGUAGE`.
6. Each entry in `fallbackLangs`, in order.
7. The track flagged `DEFAULT=YES`.
8. Track 0.

Steps 7–8 mean the video never plays silent, whatever the preference. Every decision
comes back through `onDiagnostics` with a human-readable `reason` — worth logging in
staging so you can see which rule fired for real users.

#### When Bunny writes the *wrong* tag — `trackAliases`

Worse than a missing label: Bunny's encoder rejects language codes it does not know and
substitutes one it does. A real 43-track library came back like this:

```
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio_1/audio.m3u8",...,LANGUAGE="en",NAME="English",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio_41/audio.m3u8",...,LANGUAGE="en",NAME="Audio"    ← Cantonese
```

The Cantonese dub is tagged **`en`**. No language code can reach it, because as far as the
manifest is concerned it *is* English — `preferredAudioLang="yue"` correctly finds nothing
and falls back. Only the `NAME` is unique, so point at that:

```jsx
<BunnyMultiAudioPlayer
  preferredAudioLang="yue"                 // your app keeps clean language codes
  trackAliases={{ yue: 'Audio' }}          // …and this repairs the one bad track
/>
```

An alias maps a language code to a track's `NAME`, its `LANGUAGE`, or a position
(`'#40'`). It is checked before every other rule — it exists precisely for videos whose
tags cannot be trusted — and if the target is not in the manifest it falls through to the
normal chain rather than failing. `preferredAudioLang="Audio"` or `"#40"` also work
directly, without an alias map.

**An alias also names the menu entry.** The player's own audio dropdown is built from the
manifest, so without help it repeats Bunny's mistake. With the alias above, that row reads
**"Cantonese"** — the dropdown lists real language names and picking one Just Works, no
per-user configuration:

| track | manifest says | menu shows |
|---|---|---|
| `audio_41` | `LANGUAGE="en" NAME="Audio"` | **Cantonese** |
| `audio_29` | `LANGUAGE="pt" NAME="Portuguese 28"` | **Brazilian Portuguese** |
| `audio_30` | `LANGUAGE="pt" NAME="Portuguese"` | **Portuguese** |

Key matching is deliberately strict about regions. An unregioned key covers related
spellings — `yue` answers `zh-HK` and `Cantonese` — but a key that *names* a region never
answers the bare language: `{ 'pt-BR': … }` must not capture a plain `pt` request, or both
collapse back onto one track. So when two tracks share a tag, **alias both**:

```jsx
trackAliases={{ yue: 'Audio', pt: 'Portuguese', 'pt-BR': 'Portuguese 28' }}
```

Alias only one and the other language still matches the raw tag first — which, with two
tracks both tagged `pt`, is the same track you just aliased.

The durable fix is on Bunny's side — re-upload that audio track under a language Bunny
accepts, or rename it to something meaningful — but the alias unblocks you without a
re-encode.

##### The picker itself

[`src/languages.js`](src/languages.js) holds the 43 languages this library publishes —
one per audio track — and drives the harness dropdown. The test suite resolves every one
of them against the captured manifest and asserts that they land on **43 distinct tracks,
with none falling back**, so a language going missing or two of them colliding fails the
build rather than reaching a user. Only `yue` and `pt-br` need alias entries; the other 41
resolve on their own tags.

##### Building the map without typing it

`unreachableByLanguage(tracks)` reports exactly which tracks no language code can select —
the ones needing an alias — and `aliasTargetFor(tracks, index)` produces the target string
for one. On the real manifest:

```
#29  pt/Portuguese   shadowed by #28   target: "Portuguese"
#40  en/Audio        shadowed by #0    target: "Audio"
```

Both are *shadowed*: selection tries the exact tag first, so within a group sharing one
language only the first is ever reachable. That part is fully automatic. What is **not**
derivable is which language each shadowed track actually holds — Bunny overwrote it, and
nothing in the manifest brings it back. (The tracks are ordered by the code Bunny intended,
so the mis-tagged one sits between `vi` and `zh`; but `wo`, `xh`, `yi` and `yo` sort there
too. A guess would be a coin flip.)

So it is stated once, by ear. The harness turns that into two clicks: pick the language,
press **assign** on the track's row, and the alias is written for you and stored in
`localStorage` against that video GUID — reload, and it is still there. In your own app,
keep the finished map wherever the video's metadata lives:

```jsx
<BunnyMultiAudioPlayer
  trackAliases={video.audioAliases}   // { yue: 'Audio', pt: 'Portuguese', 'pt-BR': 'Portuguese 28' }
/>
```

#### Cantonese, and other languages Bunny cannot name

Bunny's dashboard and its own player only have display names for a short list of
languages. A track tagged `yue` (Cantonese) is shown there as the bare word **"Audio"** —
the tag is not lost, Bunny just has no label for it. Pass `preferredAudioLang="yue"`
(or `zh-HK`, or `Cantonese`) and the track is found on its manifest tag; the menu here
labels it "Cantonese" rather than repeating Bunny's placeholder.

Cantonese is deliberately *not* folded into `zh`. It is a separate language under the
`zh` macrolanguage, so `yue` → `zh` would silently play Mandarin on a video that carries
both. Same for `nan`, `hak`, `wuu`, `gan`, `hsn`. `cmn` and `zh-CN` do mean Mandarin, and
`zh-HK` / `zh-MO` are treated as Cantonese, which is what they mean for *audio*.

#### Regions: `pt` vs `pt-BR`

Bunny frequently drops the region subtag and publishes every Portuguese dub as
`LANGUAGE="pt"`, leaving the region in the track name only — so `pt` and `pt-BR` used to
resolve to the same track. When more than one track shares a base language, the region is
now matched against the label (`br` also matches "Brazil", "Brasil", "Brazilian";
`419` matches "Latin America", "LATAM"; and so on), and a request with a region no label
mentions stays on the *unregioned* track instead of grabbing an arbitrary sibling.

If Bunny published neither a region tag nor a usable name, no rule can tell the tracks
apart — the diagnostics panel says so, and `"#1"` selects by position.

This is worth checking before assuming a bug. The same real manifest above carries two
Portuguese tracks:

```
LANGUAGE="pt",NAME="Portuguese 28"
LANGUAGE="pt",NAME="Portuguese"
```

Neither says Brazil, so `pt` and `pt-BR` *correctly* resolve to the same track — there is
no Brazilian dub in the manifest to find, only two tracks someone uploaded as plain
Portuguese. Select them by name (`"Portuguese"` vs `"Portuguese 28"`) or fix the labels
in Bunny.

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
