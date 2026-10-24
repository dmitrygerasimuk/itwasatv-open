// Upcoming is a one-shot cue near the end of a clip, not a permanent caption.
export class UpcomingNotice {
  constructor() { this.slot = null; this.shown = false; this.until = 0; }
  visible({ slot, remaining, playing, enabled, now }) {
    if (slot !== this.slot) { this.slot = slot; this.shown = false; this.until = 0; }
    if (!enabled || !playing || remaining <= 0 || remaining >= 27) return false;
    if (!this.shown && remaining < 27) { this.shown = true; this.until = now + 10000; }
    return this.shown && now < this.until;
  }
}
