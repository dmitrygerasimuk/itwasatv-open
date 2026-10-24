export function parseEpoch(data, format) {
  // timeapi dateTime is UTC without a suffix; never interpret it as local time.
  const milliseconds = value => String(value).replace(/(\.\d{3})\d+/, '$1');
  if (format === 'timeapi') return Date.parse(milliseconds(data.dateTime).replace(/Z$/, '') + 'Z');
  return data.utc_datetime ? Date.parse(milliseconds(data.utc_datetime)) : Number(data.unixtime) * 1000;
}

export class SyncedClock {
  constructor(sources, timeoutMs = 4000) {
    this.sources = sources;
    this.timeoutMs = timeoutMs;
    this.anchorEpoch = Date.now();
    this.anchorMono = performance.now();
    this.source = 'device clock';
    this.synchronized = false;
    this.pending = null;
  }
  now() { return (this.anchorEpoch + performance.now() - this.anchorMono) / 1000; }
  async sync() {
    if (this.pending) return this.pending;
    this.pending = this.sample().finally(() => { this.pending = null; });
    return this.pending;
  }
  async sample() {
    const samples = await Promise.allSettled(this.sources.map(async source => {
      const sent = performance.now();
      const response = await fetch(source.url + (source.url.includes('?') ? '&' : '?') + `_=${Date.now()}`, {
        cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) throw new Error('Time source unavailable');
      const epoch = parseEpoch(await response.json(), source.format);
      const received = performance.now();
      if (!Number.isFinite(epoch) || epoch < 1577836800000) throw new Error('Invalid epoch');
      return { epoch: epoch + (received - sent) / 2, mono: received, rtt: received - sent, source: new URL(source.url).hostname };
    }));
    const best = samples.filter(r => r.status === 'fulfilled').map(r => r.value).sort((a, b) => a.rtt - b.rtt)[0];
    if (best) {
      this.anchorEpoch = best.epoch;
      this.anchorMono = best.mono;
      this.source = best.source;
      this.synchronized = true;
    }
    // Preserve the last trusted anchor on failure, including when local time changes.
    return this.synchronized;
  }
}
