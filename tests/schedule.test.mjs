import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Schedule, selectChannel, shuffle, channelNames } from '../js/schedule.js';
import { parseEpoch, SyncedClock } from '../js/clock.js';
const catalog = JSON.parse(await readFile(new URL('../data/videos.json', import.meta.url)));
const epoch = Date.parse('2026-10-24T12:00:00Z') / 1000;
const tiny = [{ id: 'aaaaaaaaaaa', time: 10 }, { id: 'bbbbbbbbbbb', time: 20 }];

test('all 854 videos from the final catalog have valid metadata', () => {
  assert.equal(catalog.length, 854);
  assert.equal(new Set(catalog.map(v => v.id)).size, catalog.length);
  assert(catalog.every(v => /^[\w-]{11}$/.test(v.id) && Number.isInteger(v.time) && v.time > 0));
});
test('two independent viewers agree on every channel at every sampled instant', () => {
  const a = new Schedule(catalog), b = new Schedule(catalog);
  for (let ch = 0; ch <= 20; ch++) for (const now of [epoch, epoch + 1, epoch + 90000]) {
    assert.deepEqual(a.current(ch, now), b.current(ch, now));
  }
});
test('zero epoch, exact boundaries and playlist wrap always select one clip', () => {
  const schedule = new Schedule(tiny);
  const list = schedule.playlist(11, 0).videos;
  assert.equal(schedule.current(11, 0).id, list[0].id);
  assert.equal(schedule.current(11, list[0].time).id, list[1].id);
  assert.equal(schedule.current(11, 30).id, list[0].id);
  assert.equal(schedule.current(11, 30).offset, 0);
});
test('lineup contains the current clip and stays continuous across wrap', () => {
  const schedule = new Schedule(tiny);
  const rows = schedule.lineup(11, 0);
  assert.equal(rows[1].current, true);
  assert.equal(rows[1].start, 0);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i - 1].end, rows[i].start);
});
test('daily shuffle resets on UTC midnight without corrupting the catalog', () => {
  const schedule = new Schedule(catalog);
  const before = JSON.stringify(catalog);
  const first = schedule.playlist(7, epoch).videos.map(v => v.id);
  const second = schedule.playlist(7, epoch + 86400).videos.map(v => v.id);
  assert.notDeepEqual(first, second);
  assert.equal(JSON.stringify(catalog), before);
  assert.deepEqual(shuffle(tiny, 'seed'), shuffle(tiny, 'seed'));
});
test('FRESH selects releases from 2023 onward on channel 12', () => {
  const entries = [{ year: 2022 }, { year: 2023 }, { year: 2025 }, {}, { year: 1997 }];
  assert.deepEqual(selectChannel(entries, 11, epoch), [entries[1], entries[2]]);
  assert.equal(channelNames[11], 'FRESH');
  assert.equal(selectChannel(catalog, 11, epoch).length, 6);
  assert(selectChannel(catalog, 11, epoch).every(v => v.year >= 2023));
});
test('final catalog preserves corrected lengths, removals and new releases', () => {
  const byId = new Map(catalog.map(v => [v.id, v]));
  assert.equal(catalog.at(-1).id, 'Rml7EpipZ8s');
  assert.equal(catalog.find(v => v.title === 'Liam Gallagher — Wall Of Glass').time, 230);
  assert.equal(catalog.find(v => v.title === 'Sailor & I — Tough Love').time, 227);
  for (const removed of ['Ooq23i-QGBM', 'T_aiaYkcSDo', '0OmtRTqeW2s']) assert(!byId.has(removed));
  assert(catalog.every((v, i) => v.key === i && v.allkey === i));
});
test('genre case bug and unknown-year classic bug are fixed', () => {
  const hiphop = selectChannel(catalog, 7, epoch);
  assert(hiphop.length > 0);
  assert(hiphop.every(v => [v.mainGenre, v.secGenre].includes('hip-hop')));
  assert(selectChannel(catalog, 6, epoch).every(v => v.year >= 1967 && v.year <= 2008));
});
test('exclusions affect every viewer identically; invalid entries cannot poison epoch math', () => {
  const schedule = new Schedule([...tiny, { id: 'bad', time: 0 }], ['aaaaaaaaaaa']);
  assert.equal(schedule.current(11, epoch).id, 'bbbbbbbbbbb');
});
test('virtual search stations have bounded cache usage', () => {
  const schedule = new Schedule(catalog);
  for (let ch = 21; ch < 100; ch++) schedule.current(ch, epoch);
  assert(schedule.cache.size <= 30);
});
test('UTC time parsing does not depend on client timezone', () => {
  assert.equal(parseEpoch({ dateTime: '2026-10-24T12:00:00.1259876' }, 'timeapi'), epoch * 1000 + 125);
  assert.equal(parseEpoch({ unixtime: epoch }, 'worldtime'), epoch * 1000);
});
test('clock keeps a trusted anchor when all sources fail and never writes cookies', async () => {
  const clock = new SyncedClock([], 1);
  clock.anchorEpoch = epoch * 1000;
  clock.anchorMono = performance.now();
  clock.synchronized = true;
  await clock.sync();
  assert(clock.now() >= epoch && clock.now() < epoch + 1);
  assert.equal(clock.synchronized, true);
});
