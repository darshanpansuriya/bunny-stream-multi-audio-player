/**
 * Language normalisation + audio-track matching for Bunny Stream HLS output.
 * No dependencies, no DOM — safe to unit-test in Node.
 *
 * Bunny copies whatever language metadata exists in the source file into the
 * HLS manifest, so real-world tracks look like "es", "spa", "es-419",
 * "Spanish", "Español" — or nothing at all ("Audio 2"). Normalise both sides
 * before comparing.
 */

const ISO3_TO_ISO1 = {
  eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de',
  ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', rus: 'ru', jpn: 'ja',
  kor: 'ko', zho: 'zh', chi: 'zh', ara: 'ar', hin: 'hi', ben: 'bn',
  tam: 'ta', tel: 'te', mar: 'mr', guj: 'gu', kan: 'kn', mal: 'ml',
  pan: 'pa', urd: 'ur', tur: 'tr', pol: 'pl', swe: 'sv', nor: 'no',
  dan: 'da', fin: 'fi', ell: 'el', gre: 'el', heb: 'he', tha: 'th',
  vie: 'vi', ind: 'id', msa: 'ms', may: 'ms', ukr: 'uk', ces: 'cs',
  cze: 'cs', ron: 'ro', rum: 'ro', hun: 'hu', fil: 'tl', tgl: 'tl',
};

const NAME_TO_ISO1 = {
  english: 'en', spanish: 'es', espanol: 'es', castellano: 'es',
  french: 'fr', francais: 'fr', german: 'de', deutsch: 'de',
  italian: 'it', italiano: 'it', portuguese: 'pt', portugues: 'pt',
  dutch: 'nl', nederlands: 'nl', russian: 'ru', japanese: 'ja',
  korean: 'ko', chinese: 'zh', mandarin: 'zh', arabic: 'ar',
  hindi: 'hi', bengali: 'bn', tamil: 'ta', telugu: 'te', marathi: 'mr',
  gujarati: 'gu', kannada: 'kn', malayalam: 'ml', punjabi: 'pa',
  urdu: 'ur', turkish: 'tr', polish: 'pl', swedish: 'sv',
  norwegian: 'no', danish: 'da', finnish: 'fi', greek: 'el',
  hebrew: 'he', thai: 'th', vietnamese: 'vi', indonesian: 'id',
  malay: 'ms', ukrainian: 'uk', czech: 'cs', romanian: 'ro',
  hungarian: 'hu', filipino: 'tl', tagalog: 'tl',
};

/** "es-419" | "SPA" | "Spanish" | "Español" -> "es"   (null when unknown) */
export function normalizeLang(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  // Strip diacritics so "español" matches "espanol".
  const plain = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const primary = plain.split(/[-_]/)[0];

  if (primary.length === 2) return primary;
  if (primary.length === 3 && ISO3_TO_ISO1[primary]) return ISO3_TO_ISO1[primary];
  if (NAME_TO_ISO1[primary]) return NAME_TO_ISO1[primary];

  // Labels like "spanish (latin america)" or "audio - spanish"
  for (const name of Object.keys(NAME_TO_ISO1)) {
    if (plain.includes(name)) return NAME_TO_ISO1[name];
  }
  return null;
}

/** Display label for the audio menu. */
export function labelForTrack(track, index, uiLocale) {
  if (track.name) return track.name;
  const base = normalizeLang(track.lang);
  if (base && typeof Intl !== 'undefined' && Intl.DisplayNames) {
    try {
      const dn = new Intl.DisplayNames([uiLocale || 'en'], { type: 'language' });
      const out = dn.of(base);
      if (out) return out;
    } catch { /* unsupported locale — fall through */ }
  }
  return track.lang || `Audio ${index + 1}`;
}

/**
 * Decide which audio track should play.
 *
 * @param tracks  array of { lang, name, default? } — works for the hls.js
 *                audioTracks array and for a normalised Safari AudioTrackList.
 * @param preferredLang  the user's preference: "es" | "es-419" | "spa" | "Spanish"
 * @param fallbackLangs  ordered fallbacks, default ['en']
 * @returns { index, reason }  index is -1 only when `tracks` is empty.
 */
export function pickAudioTrack(tracks, preferredLang, fallbackLangs = ['en']) {
  if (!tracks || tracks.length === 0) return { index: -1, reason: 'no audio tracks in manifest' };

  const want = String(preferredLang || '').trim().toLowerCase();
  const wantBase = normalizeLang(want);

  // 1. Exact tag match — region included, so "pt-BR" beats plain "pt".
  if (want) {
    const i = tracks.findIndex((t) => String(t.lang || '').trim().toLowerCase() === want);
    if (i !== -1) return { index: i, reason: `exact match on "${want}"` };
  }

  // 2. Base-language match on the LANGUAGE attribute.
  if (wantBase) {
    const i = tracks.findIndex((t) => normalizeLang(t.lang) === wantBase);
    if (i !== -1) return { index: i, reason: `language match "${wantBase}" via LANGUAGE attribute` };

    // 3. Base-language match on the human label (tracks with no LANGUAGE).
    const j = tracks.findIndex((t) => normalizeLang(t.name) === wantBase);
    if (j !== -1) return { index: j, reason: `language match "${wantBase}" via track name` };
  }

  // 4. Fallback languages, in order.
  for (const fb of fallbackLangs || []) {
    const base = normalizeLang(fb);
    if (!base) continue;
    const i = tracks.findIndex(
      (t) => normalizeLang(t.lang) === base || normalizeLang(t.name) === base,
    );
    if (i !== -1) {
      return {
        index: i,
        reason: want
          ? `"${want}" unavailable — fell back to "${base}"`
          : `no preference given — used fallback "${base}"`,
      };
    }
  }

  // 5. The track the manifest flags DEFAULT=YES.
  const d = tracks.findIndex((t) => t.default === true);
  if (d !== -1) return { index: d, reason: 'no match — used manifest DEFAULT=YES track' };

  // 6. Primary track. Never leave the video silent.
  return { index: 0, reason: 'no match — used first track' };
}

/** Back-compat convenience: just the index. */
export function pickAudioTrackIndex(tracks, preferredLang, fallbackLangs = ['en']) {
  return pickAudioTrack(tracks, preferredLang, fallbackLangs).index;
}

/** Build the Bunny HLS playlist URL. `signedParams` = { token, expires, token_path? } */
export function buildHlsUrl(cdnHostname, videoId, signedParams) {
  const host = String(cdnHostname || '').trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  const base = `${withScheme}/${String(videoId || '').trim()}/playlist.m3u8`;
  if (!signedParams || Object.keys(signedParams).length === 0) return base;
  return `${base}?${new URLSearchParams(signedParams).toString()}`;
}
