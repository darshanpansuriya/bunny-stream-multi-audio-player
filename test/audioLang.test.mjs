/**
 * node test/audioLang.test.mjs
 * Covers the matching + fallback chain. No browser needed.
 */
import assert from 'node:assert/strict';
import { normalizeLang, pickAudioTrack, buildHlsUrl } from '../src/audioLang.js';

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
