/**
 * Language normalisation + audio-track matching for Bunny Stream HLS output.
 * No dependencies, no DOM — safe to unit-test in Node.
 *
 * Bunny copies whatever language metadata exists in the source file into the
 * HLS manifest, so real-world tracks look like "es", "spa", "es-419",
 * "Spanish", "Español" — or nothing at all ("Audio 2"). Normalise both sides
 * before comparing.
 *
 * Bunny's dashboard only has display names for a short list of languages. A
 * track tagged "yue" (Cantonese) is shown there as the bare word "Audio", but
 * the tag itself is still in the manifest — so match on the tag, not the label.
 */

const ISO3_TO_ISO1 = {
  eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de',
  ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', rus: 'ru', jpn: 'ja',
  kor: 'ko', zho: 'zh', chi: 'zh', cmn: 'zh', ara: 'ar', hin: 'hi',
  ben: 'bn', tam: 'ta', tel: 'te', mar: 'mr', guj: 'gu', kan: 'kn',
  mal: 'ml', pan: 'pa', urd: 'ur', tur: 'tr', pol: 'pl', swe: 'sv',
  nor: 'no', dan: 'da', fin: 'fi', ell: 'el', gre: 'el', heb: 'he',
  tha: 'th', vie: 'vi', ind: 'id', msa: 'ms', may: 'ms', ukr: 'uk',
  ces: 'cs', cze: 'cs', ron: 'ro', rum: 'ro', hun: 'hu', fil: 'tl',
  tgl: 'tl',
};

/**
 * ISO-639-3 codes that must NEVER be folded into their macrolanguage.
 * Cantonese ("yue") sits under the "zh" macrolanguage, so collapsing it to
 * "zh" would silently select the Mandarin track on a video that has both.
 */
const ISO3_STANDALONE = new Set([
  'yue', 'nan', 'hak', 'wuu', 'gan', 'hsn', 'cdo', 'cjy', 'cpx', 'czh',
  'mnp', 'lzh',
]);

/**
 * Tags where the region, not the primary subtag, decides what is spoken.
 * For an AUDIO track, zh-HK / zh-MO is Cantonese in practice.
 */
const TAG_OVERRIDES = {
  'zh-hk': 'yue',
  'zh-mo': 'yue',
  'zh-yue': 'yue',
};

const NAME_TO_ISO1 = {
  english: 'en', spanish: 'es', espanol: 'es', castellano: 'es',
  french: 'fr', francais: 'fr', german: 'de', deutsch: 'de',
  italian: 'it', italiano: 'it', portuguese: 'pt', portugues: 'pt',
  dutch: 'nl', nederlands: 'nl', russian: 'ru', japanese: 'ja',
  korean: 'ko', chinese: 'zh', mandarin: 'zh', putonghua: 'zh',
  guoyu: 'zh', arabic: 'ar',
  hindi: 'hi', bengali: 'bn', tamil: 'ta', telugu: 'te', marathi: 'mr',
  gujarati: 'gu', kannada: 'kn', malayalam: 'ml', punjabi: 'pa',
  urdu: 'ur', turkish: 'tr', polish: 'pl', swedish: 'sv',
  norwegian: 'no', danish: 'da', finnish: 'fi', greek: 'el',
  hebrew: 'he', thai: 'th', vietnamese: 'vi', indonesian: 'id',
  malay: 'ms', ukrainian: 'uk', czech: 'cs', romanian: 'ro',
  hungarian: 'hu', filipino: 'tl', tagalog: 'tl',

  // Chinese varieties Bunny has no display name for.
  cantonese: 'yue', yueyu: 'yue', hokkien: 'nan', 'min nan': 'nan',
  taiwanese: 'nan', hakka: 'hak', shanghainese: 'wuu',

  // Native spellings, for tracks labelled in Chinese rather than English.
  '粤语': 'yue',    // Cantonese, simplified
  '粵語': 'yue',    // Cantonese, traditional
  '广东话': 'yue',  // Guangdonghua, simplified
  '廣東話': 'yue',  // Guangdonghua, traditional
  '中文': 'zh',     // Chinese
  '普通话': 'zh',   // Putonghua, simplified
  '普通話': 'zh',   // Putonghua, traditional
  '國語': 'zh',     // Guoyu, traditional
  '国语': 'zh',     // Guoyu, simplified
};

// Longest key first, so "cantonese" wins over "chinese" and "malayalam" over
// "malay" when a label happens to contain both.
const NAME_KEYS = Object.keys(NAME_TO_ISO1).sort((a, b) => b.length - a.length);

/**
 * Words that identify a region in a track label. Bunny often drops the region
 * subtag — both Portuguese dubs come back tagged "pt" and only the NAME says
 * which one is Brazilian — so the label is the only thing left to match on.
 */
const REGION_HINTS = {
  br: ['brazil', 'brasil', 'brazilian', 'brasileiro', 'brasileira'],
  pt: ['portugal', 'european', 'europeu', 'iberian'],
  mx: ['mexico', 'mexican', 'mexicano'],
  es: ['spain', 'espana', 'castilian', 'castellano', 'iberian'],
  419: ['latin america', 'latin american', 'latam', 'latino', 'latinoamerica'],
  us: ['united states', 'american'],
  gb: ['united kingdom', 'british'],
  uk: ['united kingdom', 'british'],
  ca: ['canada', 'canadian', 'canadien', 'quebec', 'quebecois'],
  au: ['australia', 'australian'],
  ie: ['ireland', 'irish'],
  in: ['india', 'indian'],
  hk: ['hong kong', 'hongkong', 'cantonese'],
  mo: ['macau', 'macao'],
  tw: ['taiwan', 'taiwanese', 'traditional'],
  cn: ['china', 'mainland', 'simplified'],
  at: ['austria', 'austrian'],
  ch: ['switzerland', 'swiss'],
  za: ['south africa'],
  nz: ['new zealand'],
};

/** Display names for codes Intl.DisplayNames often cannot resolve. */
const EXTRA_DISPLAY_NAMES = {
  yue: 'Cantonese', nan: 'Min Nan Chinese', hak: 'Hakka Chinese',
  wuu: 'Wu Chinese', gan: 'Gan Chinese', hsn: 'Xiang Chinese',
};

/**
 * Placeholder track names. Bunny writes a bare "Audio" for every language it
 * cannot name, so such a label carries no information: never show it in the
 * menu, never match a language against it.
 */
const GENERIC_NAME =
  /^(?:audio(?:[\s_-]*track)?|track|stream|sound|default|main|original|undefined|null|unknown|und|none)?[\s_-]*\d*$/i;

/** true for "", "Audio", "Audio 2", "Track 1", "und", "2" — false for "Spanish". */
export function isGenericTrackName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return true;
  return GENERIC_NAME.test(s);
}

/** "es-419" | "SPA" | "Spanish" | "Español" | "zh-HK" -> "es" … "yue"  (null when unknown) */
export function normalizeLang(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  // Strip diacritics so "español" matches "espanol".
  const plain = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const subtags = plain.split(/[-_]/).filter(Boolean);
  const primary = subtags[0];

  // "yue", "zh-yue", "cmn-Hant-yue" — a standalone code anywhere wins outright.
  for (const tag of subtags) {
    if (ISO3_STANDALONE.has(tag)) return tag;
  }

  // "zh-HK", "zh-Hant-HK" -> yue
  if (subtags.length > 1) {
    const override = TAG_OVERRIDES[`${primary}-${subtags[subtags.length - 1]}`];
    if (override) return override;
  }

  // ASCII-only, so a two-character CJK label is not mistaken for a 2-letter code.
  if (NAME_TO_ISO1[primary]) return NAME_TO_ISO1[primary];
  if (/^[a-z]{2}$/.test(primary)) return primary;
  if (/^[a-z]{3}$/.test(primary) && ISO3_TO_ISO1[primary]) return ISO3_TO_ISO1[primary];

  // Labels like "spanish (latin america)" or "audio - cantonese"
  for (const name of NAME_KEYS) {
    if (plain.includes(name)) return NAME_TO_ISO1[name];
  }
  return null;
}

/**
 * "yue" -> "Cantonese", "pt-BR" -> "Brazilian Portuguese", "zh-HK" -> "Cantonese".
 *
 * A region is kept when it only narrows the language, because Intl says
 * "Brazilian Portuguese" for `pt-BR`. It is dropped when normalising changed the
 * language itself — `zh-HK` means Cantonese here, not "Chinese (Hong Kong)".
 */
function displayLanguage(code, uiLocale) {
  const flat = flatten(code);
  if (!flat) return null;
  const base = normalizeLang(flat);
  if (!base) return null;

  const tag = flat.split(/[-_]/)[0] === base ? flat : base;
  if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
    try {
      const out = new Intl.DisplayNames([uiLocale || 'en'], { type: 'language' }).of(tag);
      // A browser that does not know the code echoes it back — that is not a name.
      if (out && out.toLowerCase() !== tag.toLowerCase()) return out;
    } catch { /* unsupported locale — fall through */ }
  }
  return EXTRA_DISPLAY_NAMES[base] || null;
}

/** Display label for the audio menu. Never surfaces Bunny's placeholder "Audio". */
export function labelForTrack(track, index, uiLocale) {
  if (track.name && !isGenericTrackName(track.name)) return track.name;

  const named = displayLanguage(track.lang, uiLocale) || displayLanguage(track.name, uiLocale);
  if (named) return named;

  return track.name || track.lang || `Audio ${index + 1}`;
}

/**
 * Label every track, keeping the labels distinct.
 *
 * Bunny can publish two tracks under one LANGUAGE — a real "en"/"English" plus
 * a dub whose language it failed to encode, written as "en"/"Audio". Labelled
 * one at a time both come out "English", so the menu offers the same word twice
 * and the second entry looks broken. Fall back to the raw NAME to separate them.
 */
export function labelTracks(tracks, uiLocale, aliases) {
  const list = tracks || [];

  // An alias is the only reliable statement about a mis-tagged track, so it
  // names the menu entry too: `{ yue: 'Audio' }` makes that row read "Cantonese"
  // instead of parroting whatever wrong language Bunny wrote into the manifest.
  const aliased = new Map();
  if (aliases) {
    for (const [code, target] of Object.entries(aliases)) {
      const i = resolveAlias(list, target);
      if (i !== -1 && !aliased.has(i)) aliased.set(i, code);
    }
  }

  const labels = list.map((t, i) => {
    const code = aliased.get(i);
    return (code && displayLanguage(code, uiLocale)) || labelForTrack(t, i, uiLocale);
  });

  const seen = new Map();
  labels.forEach((l) => seen.set(l, (seen.get(l) || 0) + 1));

  const used = new Map();
  return labels.map((l, i) => {
    if (seen.get(l) === 1) return l;

    const nth = (used.get(l) || 0) + 1;
    used.set(l, nth);
    if (nth === 1) return l;                       // first keeps the clean name

    const raw = String(list[i].name || '').trim();
    if (raw && raw.toLowerCase() !== l.toLowerCase()) return `${l} — ${raw}`;
    return `${l} (${i + 1})`;                      // nothing else to tell them apart
  });
}

/** Lowercased, diacritic-free, for substring work. */
function flatten(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** "pt-BR" -> "br", "es-419" -> "419", "zh-Hant-HK" -> "hk", "pt" -> null */
export function regionSubtag(value) {
  const parts = flatten(value).split(/[-_]/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return /^[a-z]{2}$/.test(last) || /^\d{3}$/.test(last) ? last : null;
}

/** Does this track's label name the region? "Portuguese (Brazil)" + "br" -> true */
function nameMentionsRegion(track, region) {
  if (isGenericTrackName(track.name)) return false;
  const hay = flatten(track.name);
  if (!hay) return false;
  // The bare code counts too, for labels like "Portuguese BR".
  const words = [region, ...(REGION_HINTS[region] || [])];
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(hay));
}

/** `2` | "#2" | "index:2" -> 2, for manifests whose tracks carry no metadata at all. */
function explicitIndex(pref) {
  if (typeof pref === 'number') return Number.isInteger(pref) && pref >= 0 ? pref : null;
  const m = /^(?:#|index\s*[:=]\s*)(\d+)$/i.exec(String(pref == null ? '' : pref).trim());
  return m ? Number(m[1]) : null;
}

/**
 * Which alias key answers this request?
 *
 * Exact spelling wins outright, across every key, before any loose matching —
 * otherwise `{ 'pt-BR': …, pt: … }` would resolve "pt" against whichever key
 * happened to be declared first.
 *
 * Only then does an *unregioned* key answer a related request, so `yue` still
 * covers "zh-HK" and "Cantonese". A key that names a region (`pt-BR`) never
 * answers the bare language (`pt`) — it claims something narrower than was
 * asked for, and letting it through collapses both onto one track.
 */
function matchAliasKey(keys, want, wantBase) {
  const exact = keys.find((k) => flatten(k) === want);
  if (exact !== undefined) return exact;
  if (!wantBase) return undefined;
  return keys.find((k) => normalizeLang(k) === wantBase && !regionSubtag(k));
}

/** Resolve one alias target — an index, a NAME, or a LANGUAGE tag — to a position. */
function resolveAlias(tracks, target) {
  const byIndex = explicitIndex(target);
  if (byIndex !== null) return byIndex < tracks.length ? byIndex : -1;

  const wanted = flatten(target);
  if (!wanted) return -1;
  const byName = tracks.findIndex((t) => flatten(t.name) === wanted);
  if (byName !== -1) return byName;
  return tracks.findIndex((t) => flatten(t.lang) === wanted);
}

/**
 * Decide which audio track should play.
 *
 * @param tracks  array of { lang, name, default? } — works for the hls.js
 *                audioTracks array and for a normalised Safari AudioTrackList.
 * @param preferredLang  the user's preference: "es" | "es-419" | "spa" |
 *                       "Spanish" | "yue" | "zh-HK", or "#1" to force an index.
 * @param fallbackLangs  ordered fallbacks, default ['en']
 * @param aliases  per-video repair map for tracks Bunny mis-tagged, e.g.
 *                 { yue: 'Audio' } — a language code pointing at the track's
 *                 NAME, its LANGUAGE, or "#40". Checked before everything else,
 *                 because it exists precisely when the tags cannot be trusted.
 * @returns { index, reason }  index is -1 only when `tracks` is empty.
 */
export function pickAudioTrack(tracks, preferredLang, fallbackLangs = ['en'], aliases = null) {
  if (!tracks || tracks.length === 0) return { index: -1, reason: 'no audio tracks in manifest' };

  // 0. Escape hatch: an explicit position, for manifests with no language tags.
  const forced = explicitIndex(preferredLang);
  if (forced !== null && forced < tracks.length) {
    return { index: forced, reason: `forced track index ${forced}` };
  }

  const want = String(preferredLang == null ? '' : preferredLang).trim().toLowerCase();
  const wantBase = normalizeLang(want);

  // 0b. Caller-supplied repair for a track whose manifest tags are wrong.
  const aliasKey = aliases && want
    ? matchAliasKey(Object.keys(aliases), want, wantBase)
    : undefined;
  if (aliasKey !== undefined) {
    const i = resolveAlias(tracks, aliases[aliasKey]);
    if (i !== -1) return { index: i, reason: `alias "${aliasKey}" -> "${aliases[aliasKey]}"` };
  }

  // Someone has stated what these tracks hold, so they stop answering to the
  // wrong tag Bunny gave them. Without this, a dub identified as Cantonese
  // would still satisfy an "en" request whenever it happens to come first.
  const spokenFor = claimedByOtherAliases(tracks, aliases, aliasKey);
  const find = (pred) => tracks.findIndex((t, i) => !spokenFor.has(i) && pred(t, i));

  // 1. Exact tag match — region included, so "pt-BR" beats plain "pt".
  if (want) {
    const i = find((t) => String(t.lang || '').trim().toLowerCase() === want);
    if (i !== -1) return { index: i, reason: `exact match on "${want}"` };

    // 2. Exact label match, for tracks Bunny published with no LANGUAGE at all.
    const n = find((t) => String(t.name || '').trim().toLowerCase() === want);
    if (n !== -1) return { index: n, reason: `exact match on track name "${want}"` };
  }

  // 3. Region disambiguation. Bunny frequently publishes every Portuguese dub
  //    as LANGUAGE="pt" and puts the region in the label only, so "pt-BR" and
  //    "pt" would otherwise both land on whichever track comes first.
  const wantRegion = regionSubtag(want);
  if (wantRegion && wantBase) {
    const sameBase = [];
    tracks.forEach((t, i) => {
      if (spokenFor.has(i)) return;
      if (normalizeLang(t.lang) === wantBase || normalizeLang(t.name) === wantBase) {
        sameBase.push({ t, i });
      }
    });
    if (sameBase.length > 1) {
      const hit = sameBase.find(({ t }) => nameMentionsRegion(t, wantRegion));
      if (hit) {
        return { index: hit.i, reason: `region "${wantRegion}" matched via track name` };
      }
      // No label names the region, so the unregioned track is the neutral one:
      // "pt-BR" must not silently take the plain-"pt" track when a sibling exists.
      const generic = sameBase.find(({ t }) => !regionSubtag(t.lang));
      if (generic && !sameBase.some(({ t }) => regionSubtag(t.lang) === wantRegion)) {
        return {
          index: generic.i,
          reason: `no track names region "${wantRegion}" — used the unregioned "${wantBase}" track`,
        };
      }
    }
  }

  // 4. Base-language match on the LANGUAGE attribute. "yue" stays "yue" here,
  //    so a Cantonese request can never land on the Mandarin track.
  if (wantBase) {
    const i = find((t) => normalizeLang(t.lang) === wantBase);
    if (i !== -1) return { index: i, reason: `language match "${wantBase}" via LANGUAGE attribute` };

    // 5. Base-language match on the human label (tracks with no LANGUAGE).
    const j = find(
      (t) => !isGenericTrackName(t.name) && normalizeLang(t.name) === wantBase,
    );
    if (j !== -1) return { index: j, reason: `language match "${wantBase}" via track name` };
  }

  // 6. Fallback languages, in order.
  for (const fb of fallbackLangs || []) {
    const base = normalizeLang(fb);
    if (!base) continue;
    const i = find(
      (t) => normalizeLang(t.lang) === base
        || (!isGenericTrackName(t.name) && normalizeLang(t.name) === base),
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

  // 7. The track the manifest flags DEFAULT=YES.
  const d = find((t) => t.default === true);
  if (d !== -1) return { index: d, reason: 'no match — used manifest DEFAULT=YES track' };

  // 8. Any track at all. Never leave the video silent — an alias claim is a
  //    preference, not a reason to play nothing.
  const any = find(() => true);
  return any !== -1
    ? { index: any, reason: 'no match — used first unclaimed track' }
    : { index: 0, reason: 'no match — used first track' };
}

/**
 * Positions already spoken for by an alias other than the one being served.
 *
 * An alias is a statement of fact about a track — "this one is Cantonese" —
 * made by someone who listened to it. Once made, the wrong tag Bunny wrote
 * should stop attracting other languages, or the identified dub goes on
 * satisfying `en` requests purely because it sits earlier in the manifest.
 */
function claimedByOtherAliases(tracks, aliases, servingKey) {
  const out = new Set();
  if (!aliases) return out;
  for (const [code, target] of Object.entries(aliases)) {
    if (code === servingKey) continue;
    const i = resolveAlias(tracks, target);
    if (i !== -1) out.add(i);
  }
  return out;
}

/**
 * Which tracks can no language code ever reach?
 *
 * Selection tries the exact tag first, so within a group of tracks sharing one
 * language only the first is reachable — every later one is dead to any code a
 * user could type, however correct that code is. Those are exactly the tracks
 * that need an alias, and there is no way to infer *which* language each one
 * holds: Bunny overwrote that. Someone has to listen once and say so.
 *
 * @returns [{ index, lang, name, takenBy, reachableByName }]
 */
export function unreachableByLanguage(tracks) {
  const list = tracks || [];
  const names = list.map((t) => flatten(t.name));
  const claimed = new Map();
  const out = [];

  list.forEach((t, i) => {
    const base = normalizeLang(t.lang) || normalizeLang(t.name);
    if (base && !claimed.has(base)) {
      claimed.set(base, i);
      return;
    }
    out.push({
      index: i,
      lang: t.lang || '',
      name: t.name || '',
      takenBy: base ? claimed.get(base) : -1,
      reachableByName: Boolean(names[i]) && names.filter((n) => n === names[i]).length === 1,
    });
  });
  return out;
}

/**
 * The most durable way to point an alias at one track: its NAME when that is
 * unique — placeholder names included, since an alias target is matched
 * literally — falling back to the position, which a re-encode can shift.
 */
export function aliasTargetFor(tracks, index) {
  const list = tracks || [];
  const track = list[index];
  if (!track) return null;

  const name = String(track.name || '').trim();
  if (name) {
    const flat = flatten(name);
    if (list.filter((t) => flatten(t.name) === flat).length === 1) return name;
  }
  return `#${index}`;
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
