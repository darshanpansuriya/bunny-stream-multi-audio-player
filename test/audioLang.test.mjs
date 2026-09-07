/**
 * node test/audioLang.test.mjs
 * Covers the matching + fallback chain. No browser needed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeLang, pickAudioTrack, buildHlsUrl, labelForTrack, isGenericTrackName,
  regionSubtag, labelTracks, unreachableByLanguage, aliasTargetFor,
} from '../src/audioLang.js';
import LANGUAGES from '../src/languages.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

console.log('normalizeLang');
t('two-letter passthrough', () => assert.equal(normalizeLang('ES'), 'es'));
t('region subtag stripped', () => assert.equal(normalizeLang('es-419'), 'es'));
t('underscore subtag stripped', () => assert.equal(normalizeLang('pt_BR'), 'pt'));
t('ISO-639-2 mapped', () => assert.equal(normalizeLang('spa'), 'es'));
t('alt ISO-639-2 mapped', () => assert.equal(normalizeLang('ger'), 'de'));
t('english name mapped', () => assert.equal(normalizeLang('Spanish'), 'es'));
t('native accented name mapped', () => assert.equal(normalizeLang('Español'), 'es'));
t('label with extra words', () => assert.equal(normalizeLang('Spanish (Latin America)'), 'es'));
t('unknown -> null', () => assert.equal(normalizeLang('Klingon'), null));
t('empty -> null', () => assert.equal(normalizeLang(''), null));
t('null-safe', () => assert.equal(normalizeLang(undefined), null));

const FOUR = [
  { lang: 'eng', name: 'English', default: true },
  { lang: 'spa', name: 'Spanish' },
  { lang: 'fra', name: 'French' },
  { lang: 'deu', name: 'German' },
];

console.log('pickAudioTrack');
t('requested language wins', () => assert.equal(pickAudioTrack(FOUR, 'es').index, 1));
t('ISO-639-2 request works', () => assert.equal(pickAudioTrack(FOUR, 'spa').index, 1));
t('regional request degrades to base', () => assert.equal(pickAudioTrack(FOUR, 'es-419').index, 1));
t('name request works', () => assert.equal(pickAudioTrack(FOUR, 'German').index, 3));
t('missing language falls back to en', () => {
  const r = pickAudioTrack(FOUR, 'ja');
  assert.equal(r.index, 0);
  assert.match(r.reason, /fell back/);
});
t('no preference uses fallback', () => assert.equal(pickAudioTrack(FOUR, '').index, 0));
t('custom fallback order respected', () => assert.equal(pickAudioTrack(FOUR, 'zz', ['it', 'fr']).index, 2));
t('exact regional tag beats base', () => assert.equal(
  pickAudioTrack([{ lang: 'pt' }, { lang: 'pt-BR' }], 'pt-BR').index, 1));
t('base match when no exact tag', () => assert.equal(
  pickAudioTrack([{ lang: 'pt-PT' }, { lang: 'pt-BR' }], 'pt').index, 0));
t('untagged tracks matched by label', () => assert.equal(
  pickAudioTrack([{ lang: '', name: 'English' }, { lang: '', name: 'Spanish' }], 'es').index, 1));
t('DEFAULT=YES used when nothing matches', () => {
  const r = pickAudioTrack([{ lang: 'fr' }, { lang: 'de', default: true }], 'ja', ['ko']);
  assert.equal(r.index, 1);
  assert.match(r.reason, /DEFAULT=YES/);
});
t('first track as last resort', () => assert.equal(
  pickAudioTrack([{ lang: '', name: 'Audio 1' }, { lang: '', name: 'Audio 2' }], 'es').index, 0));
t('empty list -> -1, never throws', () => assert.equal(pickAudioTrack([], 'es').index, -1));
t('null list -> -1', () => assert.equal(pickAudioTrack(null, 'es').index, -1));
t('single track always chosen', () => assert.equal(pickAudioTrack([{ lang: 'eng' }], 'es').index, 0));

/**
 * Bunny has no display name for "yue", so its dashboard and its own player
 * show the track as the bare word "Audio". The manifest still carries the tag.
 */
const CHINESE = [
  { lang: 'eng', name: 'English', default: true },
  { lang: 'zh', name: 'Chinese' },
  { lang: 'yue', name: 'Audio' },
];

console.log('Cantonese / Chinese varieties');
t('yue stays yue', () => assert.equal(normalizeLang('yue'), 'yue'));
t('zh-yue is not Mandarin', () => assert.equal(normalizeLang('zh-yue'), 'yue'));
t('zh-HK audio is Cantonese', () => assert.equal(normalizeLang('zh-HK'), 'yue'));
t('zh-Hant-HK is Cantonese', () => assert.equal(normalizeLang('zh-Hant-HK'), 'yue'));
t('plain zh stays Mandarin', () => assert.equal(normalizeLang('zh'), 'zh'));
t('cmn is Mandarin', () => assert.equal(normalizeLang('cmn'), 'zh'));
t('Cantonese name mapped', () => assert.equal(normalizeLang('Cantonese'), 'yue'));
t('Cantonese beats Chinese in a label', () => assert.equal(
  normalizeLang('Chinese (Cantonese)'), 'yue'));
t('native spelling mapped', () => assert.equal(normalizeLang('粤语'), 'yue'));
t('two-char CJK is not a 2-letter code', () => assert.equal(normalizeLang('中文'), 'zh'));
t('yue picked over zh', () => assert.equal(pickAudioTrack(CHINESE, 'yue').index, 2));
t('zh does not steal the yue track', () => assert.equal(pickAudioTrack(CHINESE, 'zh').index, 1));
t('zh-HK request finds the yue track', () => assert.equal(
  pickAudioTrack(CHINESE, 'zh-HK').index, 2));
t('Cantonese by name finds the yue track', () => assert.equal(
  pickAudioTrack(CHINESE, 'Cantonese').index, 2));
t('yue tagged zh-yue in the manifest', () => assert.equal(
  pickAudioTrack([{ lang: 'zh' }, { lang: 'zh-yue' }], 'yue').index, 1));
t('missing yue falls back, does not grab zh', () => {
  const r = pickAudioTrack([{ lang: 'zh' }, { lang: 'en' }], 'yue', ['en']);
  assert.equal(r.index, 1);
});
t('untagged track matched by exact name', () => assert.equal(
  pickAudioTrack([{ lang: '', name: 'English' }, { lang: '', name: 'Audio' }], 'Audio').index, 1));
t('index override forces a track', () => {
  const r = pickAudioTrack(CHINESE, '#2');
  assert.equal(r.index, 2);
  assert.match(r.reason, /forced/);
});
t('numeric index override', () => assert.equal(pickAudioTrack(CHINESE, 1).index, 1));
t('out-of-range index falls through to matching', () => assert.equal(
  pickAudioTrack(CHINESE, '#9', ['en']).index, 0));

/**
 * Bunny often drops the region subtag and publishes every Portuguese dub as
 * LANGUAGE="pt", leaving the region in the label only — so "pt" and "pt-BR"
 * used to load the same track.
 */
const PT_SAME_TAG = [
  { lang: 'pt', name: 'Portuguese' },
  { lang: 'pt', name: 'Portuguese (Brazil)' },
];
const PT_DISTINCT = [
  { lang: 'pt', name: 'Portuguese' },
  { lang: 'pt-BR', name: 'Portuguese (Brazil)' },
];

console.log('region disambiguation');
t('region subtag extracted', () => {
  assert.equal(regionSubtag('pt-BR'), 'br');
  assert.equal(regionSubtag('es-419'), '419');
  assert.equal(regionSubtag('zh-Hant-HK'), 'hk');
  assert.equal(regionSubtag('pt'), null);
  assert.equal(regionSubtag('zh-Hant'), null);
});
t('pt-BR finds the Brazilian track despite the same LANGUAGE tag', () => {
  const r = pickAudioTrack(PT_SAME_TAG, 'pt-BR');
  assert.equal(r.index, 1);
  assert.match(r.reason, /region "br"/);
});
t('pt stays on the neutral track', () => assert.equal(
  pickAudioTrack(PT_SAME_TAG, 'pt').index, 0));
t('pt-PT stays on the neutral track', () => assert.equal(
  pickAudioTrack(PT_SAME_TAG, 'pt-PT').index, 0));
t('pt and pt-BR no longer collide', () => assert.notEqual(
  pickAudioTrack(PT_SAME_TAG, 'pt').index,
  pickAudioTrack(PT_SAME_TAG, 'pt-BR').index));
t('native label names the region', () => assert.equal(
  pickAudioTrack(
    [{ lang: 'pt', name: 'Português' }, { lang: 'pt', name: 'Português do Brasil' }],
    'pt-BR',
  ).index, 1));
t('exact tag still wins when Bunny keeps the region', () => assert.equal(
  pickAudioTrack(PT_DISTINCT, 'pt-BR').index, 1));
t('es-419 finds the Latin American track', () => assert.equal(
  pickAudioTrack(
    [{ lang: 'es', name: 'Spanish' }, { lang: 'es', name: 'Spanish (Latin America)' }],
    'es-419',
  ).index, 1));
t('unlabelled sibling cannot be disambiguated, but says so', () => {
  const r = pickAudioTrack([{ lang: 'pt', name: 'Portuguese' }, { lang: 'pt', name: 'Audio' }], 'pt-BR');
  assert.equal(r.index, 0);
  assert.match(r.reason, /no track names region/);
});
t('single track of that language is unaffected', () => assert.equal(
  pickAudioTrack(FOUR, 'es-419').index, 1));

console.log('labelForTrack');
t('placeholder names detected', () => {
  assert.equal(isGenericTrackName('Audio'), true);
  assert.equal(isGenericTrackName('Audio 2'), true);
  assert.equal(isGenericTrackName('track_1'), true);
  assert.equal(isGenericTrackName('und'), true);
  assert.equal(isGenericTrackName(''), true);
  assert.equal(isGenericTrackName('Spanish'), false);
});
t('"Audio" placeholder replaced by the language name', () => assert.equal(
  labelForTrack({ lang: 'yue', name: 'Audio' }, 2), 'Cantonese'));
t('real names kept', () => assert.equal(
  labelForTrack({ lang: 'yue', name: 'Cantonese dub' }, 2), 'Cantonese dub'));
t('no metadata at all still labelled', () => assert.equal(
  labelForTrack({ lang: '', name: '' }, 1), 'Audio 2'));

/**
 * The real 43-track manifest from a Bunny library, captured verbatim.
 * Two tracks in it cannot be reached by any language code:
 *   index 40 — the Cantonese dub, which Bunny encoded as LANGUAGE="en" NAME="Audio"
 *   index 28/29 — two Portuguese dubs, neither carrying a region
 */
const REAL = JSON.parse(
  readFileSync(new URL('./fixture-real-manifest.json', import.meta.url), 'utf8'),
);

console.log('real Bunny manifest (43 tracks)');
t('fixture shape unchanged', () => {
  assert.equal(REAL.length, 43);
  assert.deepEqual(REAL[40], { lang: 'en', name: 'Audio', default: false });
});
t('menu labels are all distinct', () => {
  const labels = labelTracks(REAL);
  assert.equal(new Set(labels).size, labels.length);
});
t('the mis-tagged dub does not become a second "English"', () => {
  const labels = labelTracks(REAL);
  assert.equal(labels[0], 'English');
  assert.equal(labels[40], 'English — Audio');
});
t('"yue" cannot match — Bunny tagged the track "en"', () => {
  const r = pickAudioTrack(REAL, 'yue', ['en']);
  assert.equal(r.index, 0);
  assert.match(r.reason, /fell back/);
});
t('the dub is reachable by its NAME', () => assert.equal(
  pickAudioTrack(REAL, 'Audio', ['en']).index, 40));
t('the dub is reachable by position', () => assert.equal(
  pickAudioTrack(REAL, '#40', ['en']).index, 40));
t('an alias makes "yue" reach it', () => {
  const r = pickAudioTrack(REAL, 'yue', ['en'], { yue: 'Audio' });
  assert.equal(r.index, 40);
  assert.match(r.reason, /alias/);
});
t('an alias is keyed by language, not by exact spelling', () => {
  const aliases = { yue: 'Audio' };
  assert.equal(pickAudioTrack(REAL, 'zh-HK', ['en'], aliases).index, 40);
  assert.equal(pickAudioTrack(REAL, 'Cantonese', ['en'], aliases).index, 40);
});
t('an alias can point at a position', () => assert.equal(
  pickAudioTrack(REAL, 'yue', ['en'], { yue: '#40' }).index, 40));
t('an alias for an absent track falls through, never throws', () => {
  const r = pickAudioTrack(REAL, 'yue', ['en'], { yue: 'Nonexistent' });
  assert.equal(r.index, 0);
});
t('aliases leave every other language alone', () => {
  const aliases = { yue: 'Audio' };
  assert.equal(pickAudioTrack(REAL, 'zh', ['en'], aliases).index, 41);
  assert.equal(pickAudioTrack(REAL, 'ja', ['en'], aliases).index, 20);
});
t('both Portuguese tracks are reachable by NAME', () => {
  assert.equal(pickAudioTrack(REAL, 'Portuguese', ['en']).index, 29);
  assert.equal(pickAudioTrack(REAL, 'Portuguese 28', ['en']).index, 28);
});
t('no region tag anywhere, so pt-BR says why it could not resolve', () => {
  const r = pickAudioTrack(REAL, 'pt-BR', ['en']);
  assert.match(r.reason, /no track names region/);
});

/** Both Portuguese dubs are tagged "pt"; only an alias each can separate them. */
const FULL_ALIASES = { yue: 'Audio', pt: 'Portuguese', 'pt-BR': 'Portuguese 28' };

console.log('alias key matching');
t('a regional key never answers the bare language', () => {
  // The bug: { 'pt-BR': … } matched a plain "pt" request on base language,
  // collapsing both onto one track — the very thing aliases exist to fix.
  const r = pickAudioTrack(REAL, 'pt', ['en'], { 'pt-BR': 'Portuguese 28' });
  assert.doesNotMatch(r.reason, /alias/);
});
t('pt and pt-BR reach different tracks', () => {
  assert.equal(pickAudioTrack(REAL, 'pt', ['en'], FULL_ALIASES).index, 29);
  assert.equal(pickAudioTrack(REAL, 'pt-BR', ['en'], FULL_ALIASES).index, 28);
});
t('exact key wins regardless of declaration order', () => {
  const reversed = { 'pt-BR': 'Portuguese 28', pt: 'Portuguese' };
  assert.equal(pickAudioTrack(REAL, 'pt', ['en'], reversed).index, 29);
  assert.equal(pickAudioTrack(REAL, 'pt-BR', ['en'], reversed).index, 28);
});
t('an unregioned key still covers related spellings', () => {
  assert.equal(pickAudioTrack(REAL, 'zh-HK', ['en'], FULL_ALIASES).index, 40);
  assert.equal(pickAudioTrack(REAL, 'Cantonese', ['en'], FULL_ALIASES).index, 40);
});
t('unaliased languages are untouched', () => {
  assert.equal(pickAudioTrack(REAL, 'zh', ['en'], FULL_ALIASES).index, 41);
  assert.equal(pickAudioTrack(REAL, 'es', ['en'], FULL_ALIASES).index, 9);
});

console.log('aliases name the menu entries');
t('the mis-tagged dub is labelled Cantonese, not English', () => {
  const labels = labelTracks(REAL, undefined, FULL_ALIASES);
  assert.equal(labels[40], 'Cantonese');
  assert.equal(labels[0], 'English');
});
t('a regional alias keeps its region in the label', () => {
  const labels = labelTracks(REAL, undefined, FULL_ALIASES);
  assert.equal(labels[28], 'Brazilian Portuguese');
  assert.equal(labels[29], 'Portuguese');
});
t('labels stay distinct with aliases applied', () => {
  const labels = labelTracks(REAL, undefined, FULL_ALIASES);
  assert.equal(new Set(labels).size, labels.length);
});
t('an alias pointing nowhere leaves the labels alone', () => {
  const labels = labelTracks(REAL, undefined, { yue: 'Nonexistent' });
  assert.equal(labels[40], 'English — Audio');
});
t('labelTracks works with no aliases at all', () => {
  assert.equal(labelTracks(REAL)[41], 'Chinese');
  assert.equal(labelTracks(REAL, undefined, null)[41], 'Chinese');
});

console.log('finding the tracks that need an alias');
t('exactly the shadowed tracks are reported', () => {
  const out = unreachableByLanguage(REAL);
  assert.deepEqual(out.map((u) => u.index), [29, 40]);
});
t('each names the track that shadows it', () => {
  const [pt, dub] = unreachableByLanguage(REAL);
  assert.equal(pt.takenBy, 28);   // the first "pt" wins every pt request
  assert.equal(dub.takenBy, 0);   // the real English track wins every en request
});
t('a shadowed track can still say it is reachable by name', () => {
  const [pt, dub] = unreachableByLanguage(REAL);
  assert.equal(pt.reachableByName, true);
  assert.equal(dub.reachableByName, true);
});
t('a clean manifest reports nothing', () => assert.deepEqual(
  unreachableByLanguage(FOUR), []));
t('untagged tracks count as unreachable', () => {
  const out = unreachableByLanguage([{ lang: '', name: 'Audio 1' }, { lang: '', name: 'Audio 2' }]);
  assert.deepEqual(out.map((u) => u.index), [0, 1]);
});
t('empty and null are safe', () => {
  assert.deepEqual(unreachableByLanguage([]), []);
  assert.deepEqual(unreachableByLanguage(null), []);
});

console.log('alias targets');
t('a unique name is preferred over a position', () => {
  assert.equal(aliasTargetFor(REAL, 40), 'Audio');
  assert.equal(aliasTargetFor(REAL, 28), 'Portuguese 28');
  assert.equal(aliasTargetFor(REAL, 29), 'Portuguese');
});
t('a duplicated name falls back to the position', () => assert.equal(
  aliasTargetFor([{ lang: 'pt', name: 'Portuguese' }, { lang: 'pt', name: 'Portuguese' }], 1),
  '#1'));
t('a nameless track falls back to the position', () => assert.equal(
  aliasTargetFor([{ lang: 'en', name: '' }, { lang: 'en', name: '' }], 1), '#1'));
t('out of range is null, never throws', () => {
  assert.equal(aliasTargetFor(REAL, 99), null);
  assert.equal(aliasTargetFor(null, 0), null);
});
t('every generated target actually selects its own track', () => {
  // The whole point: assigning by click must round-trip through pickAudioTrack.
  for (const u of unreachableByLanguage(REAL)) {
    const aliases = { xx: aliasTargetFor(REAL, u.index) };
    assert.equal(pickAudioTrack(REAL, 'xx', ['en'], aliases).index, u.index);
  }
});

/**
 * The picker the app actually ships, resolved against the real manifest.
 *
 * Two entries need an alias because Bunny destroyed their tags. Which of the
 * two "pt" tracks is the Brazilian one was decided by ear — what is pinned here
 * is that the mechanism gives all 43 languages their own track, not that guess.
 */
const VIDEO_ALIASES = { yue: 'Audio', pt: 'Portuguese', 'pt-br': 'Portuguese 28' };

console.log('the full 43-language picker');
t('one language per published track', () => assert.equal(LANGUAGES.length, REAL.length));
t('every code resolves, and no two land on the same track', () => {
  const claimed = new Map();
  for (const { name, code } of LANGUAGES) {
    const r = pickAudioTrack(REAL, code, ['en'], VIDEO_ALIASES);
    assert.notEqual(r.index, -1, `${name} (${code}) resolved to nothing`);
    assert.ok(
      !claimed.has(r.index),
      `${name} (${code}) collides with ${claimed.get(r.index)} on track #${r.index}`,
    );
    claimed.set(r.index, `${name} (${code})`);
  }
  // 43 languages, 43 tracks, each claimed exactly once.
  assert.equal(claimed.size, REAL.length);
});
t('no language silently falls back to another', () => {
  for (const { name, code } of LANGUAGES) {
    const { reason } = pickAudioTrack(REAL, code, ['en'], VIDEO_ALIASES);
    assert.doesNotMatch(
      reason, /fell back|DEFAULT=YES|first track/, `${name} (${code}) — ${reason}`,
    );
  }
});
t('unaliased codes land on a track whose own tag agrees', () => {
  for (const { name, code } of LANGUAGES) {
    if (code in VIDEO_ALIASES) continue;
    const { index } = pickAudioTrack(REAL, code, ['en'], VIDEO_ALIASES);
    assert.equal(
      normalizeLang(REAL[index].lang), normalizeLang(code),
      `${name} (${code}) landed on ${REAL[index].lang}/${REAL[index].name}`,
    );
  }
});
t('Cantonese and Mandarin stay apart', () => {
  const yue = pickAudioTrack(REAL, 'yue', ['en'], VIDEO_ALIASES).index;
  const zh = pickAudioTrack(REAL, 'zh', ['en'], VIDEO_ALIASES).index;
  assert.equal(yue, 40);
  assert.equal(zh, 41);
});
t('en-us takes the real English track, not the mis-tagged dub', () => assert.equal(
  pickAudioTrack(REAL, 'en-us', ['en'], VIDEO_ALIASES).index, 0));
t('an aliased track stops answering the tag Bunny gave it', () => {
  // Same manifest with the mis-tagged dub emitted first — ordering must not
  // decide whether "en" gets English or the Cantonese dub.
  const flipped = [REAL[40], ...REAL.slice(0, 40), ...REAL.slice(41)];
  assert.equal(pickAudioTrack(flipped, 'en', ['en'], { yue: 'Audio' }).index, 1);
  assert.equal(pickAudioTrack(flipped, 'yue', ['en'], { yue: 'Audio' }).index, 0);
});
t('the menu shows all 43 as distinct names', () => {
  const labels = labelTracks(REAL, undefined, VIDEO_ALIASES);
  assert.equal(labels.length, 43);
  assert.equal(new Set(labels).size, 43);
  assert.equal(labels[40], 'Cantonese');
});

console.log('buildHlsUrl');
t('bare hostname gets https', () => assert.equal(
  buildHlsUrl('vz-a.b-cdn.net', 'GUID'),
  'https://vz-a.b-cdn.net/GUID/playlist.m3u8'));
t('scheme preserved, trailing slash trimmed', () => assert.equal(
  buildHlsUrl('https://vz-a.b-cdn.net/', 'GUID'),
  'https://vz-a.b-cdn.net/GUID/playlist.m3u8'));
t('signed params appended', () => assert.equal(
  buildHlsUrl('vz-a.b-cdn.net', 'GUID', { token: 'abc', expires: '1' }),
  'https://vz-a.b-cdn.net/GUID/playlist.m3u8?token=abc&expires=1'));

console.log(`\n${pass} assertions passed`);
