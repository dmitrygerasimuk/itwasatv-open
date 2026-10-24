// Optional maintenance tool. No API calls are made by the TV itself.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config } from '../js/config.js';
const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const write = args.includes('--write');
const oembed = args.includes('--oembed');
const limit = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] || Infinity);
const country = args.find(a => a.startsWith('--region='))?.split('=')[1].toUpperCase();
if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('--region must be a two-letter country code.');
const videos = JSON.parse(await readFile(new URL('data/videos.json', root), 'utf8')).slice(0, limit);
const key = process.env.YOUTUBE_API_KEY || config.youtubeApiKey;
const report = { checkedAt: new Date().toISOString(), method: oembed ? 'oembed' : 'youtube-data-api', region: country || null, excluded: [], videos: {} };
const pause = ms => new Promise(r => setTimeout(r, ms));
async function request(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await pause(1000 * (attempt + 1)); continue; }
      return response;
    } catch (error) { if (attempt === 2) throw error; await pause(1000); }
  }
}
if (!oembed) {
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const query = new URLSearchParams({ part: 'status,contentDetails', id: batch.map(v => v.id).join(','), key });
    const response = await request(`https://www.googleapis.com/youtube/v3/videos?${query}`);
    const data = await response.json();
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason || response.status;
      process.stderr.write(`YouTube API failed (${reason}). Set YOUTUBE_API_KEY to a working key, or use --oembed for a limited existence check. No availability data was changed.\n`);
      process.exit(2);
    }
    const items = new Map(data.items.map(v => [v.id, v]));
    for (const v of batch) {
      const item = items.get(v.id);
      const restrictions = item?.contentDetails?.regionRestriction;
      const regionBlocked = country && (restrictions?.blocked?.includes(country) || (restrictions?.allowed && !restrictions.allowed.includes(country)));
      const reason = !item ? 'missing-or-private' : item.status.embeddable === false ? 'embedding-disabled' : regionBlocked ? 'region-blocked' : 'ok';
      report.videos[v.id] = { reason, embeddable: item?.status.embeddable ?? null, ...(restrictions ? { regionRestriction: restrictions } : {}) };
      // Regional restrictions never change the globally shared station schedule.
      if (reason === 'missing-or-private' || reason === 'embedding-disabled') report.excluded.push(v.id);
    }
    process.stdout.write(`Checked ${Math.min(i + 50, videos.length)}/${videos.length}\n`);
  }
} else {
  // oEmbed does not prove embedding or regional playback; keep this report advisory.
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < videos.length) {
      const video = videos[cursor++];
      try {
        const response = await request(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${video.id}&format=json`);
        report.videos[video.id] = { reason: response.ok ? 'exists-embedding-unverified' : `http-${response.status}` };
      } catch { report.videos[video.id] = { reason: 'network-error' }; }
    }
  }));
}
await mkdir(new URL('reports/', root), { recursive: true });
await writeFile(new URL('reports/video-check.json', root), JSON.stringify(report, null, 2) + '\n');
if (write) {
  if (oembed) throw new Error('--write requires the Data API: oEmbed cannot confirm embed availability.');
  const target = new URL('data/availability.json', root);
  // Partial checks merge only the checked IDs; never erase prior exclusions.
  const previous = JSON.parse(await readFile(target, 'utf8'));
  const checked = new Set(Object.keys(report.videos));
  report.excluded = [...new Set([...(previous.excluded || []).filter(id => !checked.has(id)), ...report.excluded])].sort();
  const manifest = { checkedAt: report.checkedAt, method: report.method, excluded: report.excluded };
  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n');
}
const failures = Object.values(report.videos).filter(v => !['ok', 'exists-embedding-unverified'].includes(v.reason)).length;
process.stdout.write(`Result: ${videos.length} checked; ${report.excluded.length} excluded globally; ${failures} need attention. Report: reports/video-check.json\n`);
if (failures) process.exitCode = 1;
