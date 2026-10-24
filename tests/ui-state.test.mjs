import test from 'node:test';
import assert from 'node:assert/strict';
import { UpcomingNotice } from '../js/ui-state.js';

const state = (overrides = {}) => ({
  slot: 'channel-1:clip-a:1000',
  remaining: 100,
  playing: true,
  enabled: true,
  now: 0,
  ...overrides
});

test('Upcoming stays hidden until the final 27 seconds of a song', () => {
  const notice = new UpcomingNotice();
  for (const remaining of [300, 200, 100, 60, 28, 27]) {
    assert.equal(notice.visible(state({ remaining })), false, `remaining=${remaining}`);
  }
  assert.equal(notice.visible(state({ remaining: 26.999, now: 1000 })), true);
});

test('Upcoming is visible for at most ten seconds and ticks cannot reopen it', () => {
  const notice = new UpcomingNotice();
  assert.equal(notice.visible(state({ remaining: 26, now: 1000 })), true);
  assert.equal(notice.visible(state({ remaining: 16.001, now: 10999 })), true);
  assert.equal(notice.visible(state({ remaining: 16, now: 11000 })), false);
  for (let remaining = 15.5; remaining > 0; remaining -= 0.5) {
    const now = 1000 + (26 - remaining) * 1000;
    assert.equal(notice.visible(state({ remaining, now })), false, `remaining=${remaining}`);
  }
});

test('a new scheduled slot gets its own Upcoming cue, including the same video on another channel', () => {
  const notice = new UpcomingNotice();
  assert.equal(notice.visible(state({ remaining: 20 })), true);
  assert.equal(notice.visible(state({ remaining: 9, now: 11000 })), false);
  const nextSlot = 'channel-2:clip-a:1000';
  assert.equal(notice.visible(state({ slot: nextSlot, remaining: 100, now: 12000 })), false);
  assert.equal(notice.visible(state({ slot: nextSlot, remaining: 20, now: 92000 })), true);
});

test('pause and disabled preference hide Upcoming without consuming a cue before it starts', () => {
  const notice = new UpcomingNotice();
  assert.equal(notice.visible(state({ remaining: 25, playing: false })), false);
  assert.equal(notice.visible(state({ remaining: 24, enabled: false, now: 1000 })), false);
  assert.equal(notice.visible(state({ remaining: 23, now: 2000 })), true);
  assert.equal(notice.visible(state({ remaining: 22, playing: false, now: 3000 })), false);
  assert.equal(notice.visible(state({ remaining: 21, enabled: false, now: 4000 })), false);
  assert.equal(notice.visible(state({ remaining: 20, now: 5000 })), true);
  assert.equal(notice.visible(state({ remaining: 12, now: 13000 })), false);
});

test('tuning into the final five seconds shows Upcoming only until the clip ends', () => {
  const notice = new UpcomingNotice();
  assert.equal(notice.visible(state({ remaining: 5, now: 1000 })), true);
  assert.equal(notice.visible(state({ remaining: 0.001, now: 5999 })), true);
  assert.equal(notice.visible(state({ remaining: 0, now: 6000 })), false);
  assert.equal(notice.visible(state({ remaining: -1, now: 7000 })), false);
});

test('an already ended clip never starts an Upcoming cue', () => {
  const notice = new UpcomingNotice();
  assert.equal(notice.visible(state({ remaining: 0 })), false);
  assert.equal(notice.visible(state({ remaining: -1, now: 1000 })), false);
});


test('clock corrections away from the ending hide an already active cue', () => {
  const notice = new UpcomingNotice();
  assert.equal(notice.visible(state({ remaining: 20 })), true);
  assert.equal(notice.visible(state({ remaining: 60, now: 1000 })), false);
});
