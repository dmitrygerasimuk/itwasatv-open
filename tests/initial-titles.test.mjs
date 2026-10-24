import test from 'node:test';
import assert from 'node:assert/strict';
import { InitialTitles } from '../js/ui-state.js';

const state = (overrides = {}) => ({
  slot: 'channel-1:clip-a:1000',
  offset: 6,
  playing: true,
  enabled: true,
  now: 0,
  ...overrides
});

test('initial titles enter strictly after five and before twenty playback seconds', () => {
  for (const offset of [0, 4.999, 5, 20, 20.001, 120]) {
    assert.equal(new InitialTitles().visible(state({ offset })), false, `offset=${offset}`);
  }
  for (const offset of [5.001, 6, 19, 19.999]) {
    assert.equal(new InitialTitles().visible(state({ offset })), true, `offset=${offset}`);
  }
});

test('initial titles have a five-second pulse rather than occupying the whole entry window', () => {
  const titles = new InitialTitles();
  assert.equal(titles.visible(state({ offset: 6, now: 1000 })), true);
  assert.equal(titles.visible(state({ offset: 10.999, now: 5999 })), true);
  assert.equal(titles.visible(state({ offset: 11, now: 6000 })), false);
  assert.equal(titles.visible(state({ offset: 15, now: 10000 })), false);
  assert.equal(titles.visible(state({ offset: 19, now: 14000 })), false);
});

test('repeated observations and seeking backward cannot reopen titles in the same slot', () => {
  const titles = new InitialTitles();
  assert.equal(titles.visible(state({ offset: 6, now: 1000 })), true);
  assert.equal(titles.visible(state({ offset: 8, now: 3000 })), true);
  assert.equal(titles.visible(state({ offset: 11, now: 6000 })), false);
  assert.equal(titles.visible(state({ offset: 2, now: 7000 })), false);
  assert.equal(titles.visible(state({ offset: 6, now: 11000 })), false);
  assert.equal(titles.visible(state({ offset: 19, now: 24000 })), false);
});

test('joining after the entry window does not show the initial titles', () => {
  const titles = new InitialTitles();
  assert.equal(titles.visible(state({ offset: 75, now: 1000 })), false);
  assert.equal(titles.visible(state({ offset: 76, now: 2000 })), false);
});

test('titles started near the end of the entry window finish their complete pulse', () => {
  const titles = new InitialTitles();
  assert.equal(titles.visible(state({ offset: 19, now: 1000 })), true);
  assert.equal(titles.visible(state({ offset: 20, now: 2000 })), true);
  assert.equal(titles.visible(state({ offset: 23.999, now: 5999 })), true);
  assert.equal(titles.visible(state({ offset: 24, now: 6000 })), false);
});

test('pause and disabled titles do not consume the first eligible trigger', () => {
  const titles = new InitialTitles();
  assert.equal(titles.visible(state({ offset: 6, playing: false, now: 1000 })), false);
  assert.equal(titles.visible(state({ offset: 7, enabled: false, now: 2000 })), false);
  assert.equal(titles.visible(state({ offset: 8, now: 3000 })), true);
  assert.equal(titles.visible(state({ offset: 12.999, now: 7999 })), true);
  assert.equal(titles.visible(state({ offset: 13, now: 8000 })), false);
});

test('a new scheduled slot resets the one-shot title pulse even for the same clip', () => {
  const titles = new InitialTitles();
  assert.equal(titles.visible(state({ now: 1000 })), true);
  assert.equal(titles.visible(state({ offset: 11, now: 6000 })), false);
  const nextSlot = 'channel-2:clip-a:1000';
  assert.equal(titles.visible(state({ slot: nextSlot, offset: 2, now: 7000 })), false);
  assert.equal(titles.visible(state({ slot: nextSlot, offset: 6, now: 11000 })), true);
  assert.equal(titles.visible(state({ slot: nextSlot, offset: 10.999, now: 15999 })), true);
  assert.equal(titles.visible(state({ slot: nextSlot, offset: 11, now: 16000 })), false);
});
