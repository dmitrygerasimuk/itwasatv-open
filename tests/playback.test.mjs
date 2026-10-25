import test from 'node:test';
import assert from 'node:assert/strict';
import { tunePlayback, VideoReveal } from '../js/playback.js';

const clip = { id: 'aaaaaaaaaaa', offset: 30 };
function session(overrides = {}) {
  const calls = [];
  const state = {
    ready: true, started: true, paused: false, blocked: false,
    skippedSlot: null, loadedSlot: null, loading: false, state: -1,
    player: {
      loadVideoById: video => calls.push(['load', video]),
      playVideo: () => calls.push(['play']),
      seekTo: offset => calls.push(['seek', offset]),
      getCurrentTime: () => 30
    }, ...overrides
  };
  return { state, calls, tune: (options = {}, current = clip, slot = 'slot-a') => tunePlayback(state, current, slot, options) };
}

test('landing performs no cue or load; first PLAY loads exactly once despite repeated checks and clicks', () => {
  const s = session({ started: false });
  s.tune();
  assert.deepEqual(s.calls, []);
  s.state.started = true;
  for (let i = 0; i < 20; i++) s.tune({ resume: true, sync: true });
  assert.deepEqual(s.calls, [['load', { videoId: clip.id, startSeconds: 30 }]]);
  s.state.loading = false;
  s.state.state = 1;
  for (let i = 0; i < 20; i++) s.tune({ sync: true });
  assert.equal(s.calls.length, 1);
});
test('resuming a paused clip plays the existing video without loading or seeking again', () => {
  const s = session({ loadedSlot: 'slot-a', state: 2 });
  for (let i = 0; i < 10; i++) s.tune({ resume: true, sync: true });
  assert.deepEqual(s.calls, [['play']]);
});
test('long pause catches up to live position and then resumes once', () => {
  const s = session({ loadedSlot: 'slot-a', state: 2 });
  s.state.player.getCurrentTime = () => 10;
  s.tune({ resume: true, sync: true });
  assert.deepEqual(s.calls, [['seek', 30], ['play']]);
});
test('a buffering event during seek cannot lose the required resume after pause', () => {
  const s = session({ loadedSlot: 'slot-a', state: 2 });
  s.state.player.getCurrentTime = () => 10;
  s.state.player.seekTo = offset => { s.calls.push(['seek', offset]); s.state.state = 3; };
  s.tune({ resume: true, sync: true });
  assert.deepEqual(s.calls, [['seek', 30], ['play']]);
});
test('synchronization, wake and online checks seek only for drift beyond the tolerance', () => {
  const s = session({ loadedSlot: 'slot-a', state: 1 });
  s.state.player.getCurrentTime = () => 26;
  s.tune({ sync: true });
  assert.deepEqual(s.calls, []);
  s.state.player.getCurrentTime = () => 25;
  s.tune({ sync: true });
  assert.deepEqual(s.calls, [['seek', 30]]);
});
test('crossing a schedule slot loads the next clip even during an earlier pending load', () => {
  const s = session();
  s.tune();
  s.tune({}, { id: 'bbbbbbbbbbb', offset: 2 }, 'slot-b');
  s.tune({}, { id: 'bbbbbbbbbbb', offset: 2 }, 'slot-b');
  assert.deepEqual(s.calls, [
    ['load', { videoId: clip.id, startSeconds: 30 }],
    ['load', { videoId: 'bbbbbbbbbbb', startSeconds: 2 }]
  ]);
});
test('paused, blocked and skipped slots never restart themselves; explicit retry loads once', () => {
  for (const flags of [{ paused: true }, { blocked: true }, { skippedSlot: 'slot-a' }]) {
    const s = session(flags);
    s.tune({ sync: true });
    assert.deepEqual(s.calls, []);
  }
  const s = session({ loadedSlot: 'slot-a', skippedSlot: 'slot-a' });
  s.tune({ retry: true });
  s.tune({ retry: true });
  assert.deepEqual(s.calls, [['load', { videoId: clip.id, startSeconds: 30 }]]);
});

function reveal() {
  let now = 0, id = 0;
  const jobs = new Map(), shown = [];
  const timers = {
    setTimeout(fn, delay) { const key = ++id; jobs.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { jobs.delete(key); }
  };
  const gate = new VideoReveal(() => shown.push(now), 500, timers);
  return {
    gate, jobs, shown,
    advance(ms) {
      now += ms;
      for (const [key, job] of [...jobs]) if (job.at <= now) { jobs.delete(key); job.fn(); }
    }
  };
}
test('video stays concealed through 499 ms after PLAYING and reveals at 500 ms', () => {
  const s = reveal();
  s.gate.playing();
  s.advance(499);
  assert.equal(s.gate.visible, false);
  assert.deepEqual(s.shown, []);
  s.advance(1);
  assert.equal(s.gate.visible, true);
  assert.deepEqual(s.shown, [500]);
});
test('duplicate PLAYING events cannot extend the delay or reveal twice', () => {
  const s = reveal();
  s.gate.playing();
  s.advance(300);
  s.gate.playing();
  s.advance(200);
  s.gate.playing();
  s.advance(1000);
  assert.deepEqual(s.shown, [500]);
});
test('pause, channel change and errors cancel a pending reveal, including an already queued callback', () => {
  const s = reveal();
  s.gate.playing();
  const stale = [...s.jobs.values()][0].fn;
  s.advance(250);
  s.gate.conceal();
  stale();
  s.advance(500);
  assert.equal(s.gate.visible, false);
  assert.deepEqual(s.shown, []);
  s.gate.playing();
  s.advance(500);
  assert.deepEqual(s.shown, [1250]);
});
test('buffering before first reveal restarts the full delay; later buffering keeps the image visible', () => {
  const s = reveal();
  s.gate.playing();
  s.advance(300);
  s.gate.buffering();
  s.advance(200);
  assert.deepEqual(s.shown, []);
  s.gate.playing();
  s.advance(500);
  s.gate.buffering();
  s.gate.playing();
  s.advance(500);
  assert.equal(s.gate.visible, true);
  assert.deepEqual(s.shown, [1000]);
});
