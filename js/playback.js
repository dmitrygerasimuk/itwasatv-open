// Keep periodic schedule checks and repeated clicks from restarting the player.
// prepare() conceals the picture before a load or an actual pause/resume.
export function tunePlayback(session, current, slot, { resume = false, sync = false, retry = false } = {}, prepare = () => {}, tolerance = 4) {
  if (!session.ready || !session.started || session.paused || session.blocked) return;
  if (session.skippedSlot === slot && !retry) return;
  if (session.loadedSlot !== slot || (retry && !session.loading)) {
    session.loadedSlot = slot;
    session.loading = true;
    prepare();
    session.player.loadVideoById({ videoId: current.id, startSeconds: Math.max(0, current.offset) });
    return;
  }
  if (session.loading || (!resume && !sync)) return;
  const offset = session.player.getCurrentTime();
  const seek = Number.isFinite(offset) && Math.abs(offset - current.offset) > tolerance;
  if (resume) {
    session.loading = true;
    prepare();
  }
  const wasPaused = session.state === 2;
  if (seek) session.player.seekTo(Math.max(0, current.offset), true);
  // Seeking a paused player leaves it paused. Other non-playing states start
  // with seekTo, so do not follow that command with another playback request.
  if (resume && (!seek || wasPaused)) session.player.playVideo();
}

export class VideoReveal {
  constructor(reveal, delay = 500, timers = globalThis) {
    this.reveal = reveal;
    this.delay = delay;
    this.timers = timers;
    this.visible = false;
    this.timer = null;
    this.generation = 0;
  }
  conceal() {
    this.generation++;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.visible = false;
  }
  playing() {
    if (this.visible || this.timer !== null) return;
    const generation = this.generation;
    this.timer = this.timers.setTimeout(() => {
      if (generation !== this.generation) return;
      this.timer = null;
      this.visible = true;
      this.reveal();
    }, this.delay);
  }
  buffering() {
    // Do not cover an already visible video on ordinary network buffering.
    if (!this.visible) this.conceal();
  }
}
