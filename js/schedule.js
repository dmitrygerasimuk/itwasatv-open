// Pure browser-side replacement for videos.php, itsatv.php and getlineup.php.
export const channelNames = [
  'Main', 'Rock // Indie', 'Pop // Indie', 'Electronic // Pop',
  'Ambient // Chill', 'ITSATV 2018', 'Classic 1967-2008', 'Hip-Hop',
  'Funk // Soul // RNB', '>100M Views', '<100K Views', 'FRESH'
];
export const modulo = (n, d) => ((n % d) + d) % d;
export const utcDay = epoch => new Date(epoch * 1000).toISOString().slice(0, 10);

export function shuffle(items, seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  const random = () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function selectChannel(videos, channel, epoch) {
  const tags = v => [v.mainGenre, v.secGenre].map(x => String(x || '').toLowerCase());
  const genre = (include, exclude = []) => videos.filter(v =>
    tags(v).some(t => include.includes(t)) && !tags(v).some(t => exclude.includes(t)));
  switch (channel) {
    case 0: {
      // Keep the original weekly rotating Main selection; use UTC for every viewer.
      const start = (6 - new Date(epoch * 1000).getUTCDay()) * 90;
      return videos.slice(start, start + start + 120).reverse();
    }
    case 1: return genre(['rock', 'indie'], ['pop', 'electronic']);
    case 2: return genre(['pop'], ['rock']);
    case 3: return genre(['electronic', 'pop'], ['rock', 'hip-hop']);
    case 4: return genre(['ambient']);
    case 5: return videos.slice(0, 115);
    case 6: return videos.filter(v => Number(v.year) >= 1967 && Number(v.year) <= 2008);
    case 7: return genre(['hip-hop']);
    case 8: return genre(['rnb', 'jazz', 'soul', 'funk'], ['rock', 'pop']);
    case 9: return videos.filter(v => v.views > 100000000);
    case 10: return videos.filter(v => v.views < 100000);
    case 11: return videos.filter(v => Number(v.year) >= 2023);
    case 18: return videos.filter(v => v.black === true);
    default: return [...videos];
  }
}

export class Schedule {
  constructor(videos, excluded = []) {
    const blocked = new Set(excluded);
    this.videos = videos.filter(v => /^[\w-]{11}$/.test(v.id) && v.time > 0 && !blocked.has(v.id));
    if (!this.videos.length) throw new Error('The video catalog is empty.');
    this.day = '';
    this.cache = new Map();
  }
  playlist(channel, epoch) {
    const day = utcDay(epoch);
    if (day !== this.day) { this.day = day; this.cache.clear(); }
    if (!this.cache.has(channel)) {
      const selection = selectChannel(this.videos, channel, epoch);
      const videos = shuffle(selection.length ? selection : this.videos, `${day}:${channel}`);
      this.cache.set(channel, { videos, total: videos.reduce((n, v) => n + v.time, 0) });
      // Virtual search stations should not keep thousands of playlists in memory.
      if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(channel);
  }
  current(channel, epoch) {
    const { videos, total } = this.playlist(channel, epoch);
    let offset = modulo(epoch, total);
    for (let index = 0; index < videos.length; index++) {
      const video = videos[index];
      if (offset < video.time) {
        return { ...video, index, offset, start: epoch - offset,
          end: epoch - offset + video.time, total, count: videos.length,
          upcoming: videos[(index + 1) % videos.length] };
      }
      offset -= video.time;
    }
    throw new Error('Invalid schedule position.');
  }
  lineup(channel, epoch, before = 1, after = 3) {
    const current = this.current(channel, epoch);
    const { videos } = this.playlist(channel, epoch);
    let start = current.start;
    for (let d = -1; d >= -before; d--) start -= videos[modulo(current.index + d, videos.length)].time;
    const rows = [];
    for (let d = -before; d <= after; d++) {
      const video = videos[modulo(current.index + d, videos.length)];
      rows.push({ ...video, start, end: start + video.time, current: d === 0 });
      start += video.time;
    }
    return rows;
  }
}
