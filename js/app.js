import { config } from './config.js';
import { Schedule, channelNames, modulo } from './schedule.js';
import { SyncedClock } from './clock.js';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const memory = new Map();
const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`itwasatv:${key}`)) ?? fallback; }
    catch { return memory.get(key) ?? fallback; }
  },
  set(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(`itwasatv:${key}`, JSON.stringify(value)); } catch { /* Private mode: session memory is enough. */ }
  }
};
const params = new URLSearchParams(location.search);
const requestedChannel = Number(params.get('channel') ?? storage.get('channel', 0));
const initialChannel = Number.isInteger(requestedChannel) && requestedChannel >= 0 && requestedChannel <= 6000 ? requestedChannel : 0;
const clock = new SyncedClock(config.timeSources, config.clockTimeoutMs);
const app = {
  channel: initialChannel, schedule: null, videos: [], player: null,
  ready: false, started: false, paused: false, muted: false, current: null,
  loadedId: null, loadedAt: 0, loadedSlot: null, state: -1, menu: false,
  volume: Math.max(0, Math.min(100, Number(storage.get('volume', 80)) || 0)),
  options: storage.get('options', {}), favorites: storage.get('favorites', []),
  skippedSlot: null, blocked: false, direct: null, searchToken: 0,
  manualCredits: false, searching: false, titleTimer: null, lineupKey: '',
  apiLoading: false, apiTimeout: null, loading: false
};
if (!app.options || typeof app.options !== 'object' || Array.isArray(app.options)) app.options = {};
if (!Array.isArray(app.favorites)) app.favorites = [];
app.options = { itShowStatus: true, itForceBW: false, itRedHighlight: true, itShowUpcoming: true, ...app.options };

function message(text, duration = 5000) {
  const box = $('messagebox');
  box.textContent = text;
  box.style.opacity = '1';
  box.style.zIndex = '110';
  clearTimeout(message.timer);
  message.timer = setTimeout(() => { box.style.opacity = '0'; }, duration);
}
function spinner(show) {
  $('debug2').style.display = show ? '' : 'none';
}
function showMenu(force) {
  app.menu = typeof force === 'boolean' ? force : !app.menu;
  $('links-show').hidden = !app.menu;
  $('menu').style.display = app.menu ? 'none' : '';
}
function paint() {
  const black = !!app.current?.black;
  document.body.classList.toggle('video-black-ui', black);
  $('video-foreground').classList.toggle('hoverbw', !!app.options.itForceBW);
  $('lineupBW').classList.toggle('hoverbw', !!app.options.itForceBW);
  const fill = black ? '#111' : '#eee';
  $('logo').setAttribute('fill', fill);
}
function updateVolume() {
  if (app.ready) {
    app.player.setVolume(app.volume);
    if (app.muted || app.volume === 0) app.player.mute(); else app.player.unMute();
  }
  all('input[type="range"]').forEach(input => { input.value = app.volume; });
  all('[data-original-id="mutelink"]').forEach(el => { el.style.opacity = app.muted || app.volume === 0 ? '.5' : '1'; });
}
function changeVolume(value) {
  app.volume = Math.max(0, Math.min(100, Number(value)));
  app.muted = app.volume === 0;
  storage.set('volume', app.volume);
  updateVolume();
}
function mute() { app.muted = !app.muted; updateVolume(); }
function start() {
  app.started = true;
  app.paused = false;
  app.blocked = false;
  UIkit.modal('#landing-modal').hide();
  showMenu(true);
  if (app.ready && app.schedule) {
    tune(true);
    app.player.playVideo();
  } else {
    spinner(true);
    loadYouTube();
    message('Loading player…');
  }
}
function pause() {
  if (!app.ready) return;
  app.paused = true;
  app.player.pauseVideo();
}
function togglePlay() { if (!app.started || app.paused || app.blocked) start(); else pause(); }
function syncNow() {
  app.direct = null;
  app.skippedSlot = null;
  if (app.schedule) tune(true);
}
function changeChannel(channel = app.channel + 1) {
  app.channel = Number(channel);
  if (!Number.isInteger(app.channel) || app.channel < 0 || app.channel > 6000) app.channel = 0;
  app.direct = null;
  app.skippedSlot = null;
  app.blocked = false;
  app.searchToken++;
  storage.set('channel', app.channel);
  const url = new URL(location.href);
  url.searchParams.set('channel', app.channel);
  url.searchParams.delete('findid');
  history.replaceState(null, '', url);
  tune(true);
  message(`Channel is ${app.channel + 1}${channelNames[app.channel] ? ' — ' + channelNames[app.channel] : ''}`);
}
function nextChannel() { changeChannel(app.channel >= config.maxChannel ? 0 : app.channel + 1); }
function previousChannel() { changeChannel(app.channel <= 0 || app.channel > config.maxChannel ? config.maxChannel : app.channel - 1); }
function fullscreen() {
  const result = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  result?.catch(() => message('Fullscreen is unavailable in this browser.'));
}
function slotKey(current) { return `${app.channel}:${current.id}:${current.start}`; }
function position() {
  if (app.direct) {
    const offset = clock.now() - app.direct.start;
    if (offset < app.direct.time) return { ...app.direct, offset, end: app.direct.start + app.direct.time, upcoming: null };
    app.direct = null;
  }
  return app.schedule.current(app.channel, clock.now());
}
function tune(force = false) {
  if (!app.schedule) return;
  const current = position();
  const key = slotKey(current);
  const changed = key !== (app.current && slotKey(app.current));
  app.current = current;
  if (changed || force) {
    app.manualCredits = false;
    renderTrack();
    paint();
    renderLineup(true);
  }
  if (!app.ready || app.paused || app.blocked) return;
  if (app.skippedSlot === key && !force) return;
  if (force || app.loadedSlot !== key) {
    app.loadedId = current.id;
    app.loadedSlot = key;
    app.loadedAt = performance.now();
    app.loading = true;
    spinner(true);
    const video = { videoId: current.id, startSeconds: Math.max(0, current.offset) };
    if (app.started) app.player.loadVideoById(video); else app.player.cueVideoById(video);
  }
}
function renderTrack() {
  const v = app.current;
  if (!v) return;
  document.title = `♫ ${v.title}`;
  $('credcenter').innerHTML = `${escape(v.title)}<h5 class="credcenteryear">${v.year >= 1950 ? escape(v.year) : ''}</h5>`;
  const query = encodeURIComponent(v.title);
  $('cred').innerHTML = `
    <a id="acredinfo" class="uk-margin-small-right uk-light" href="#"><span class="fa-1and5x"><i class="fas fa-bars fa-fw"></i></span></a>
    <div id="dropsocial" class="uk-background-secondary uk-light" uk-dropdown="pos:top-center; mode:hover,click; delay-hide:1000;">
      <ul class="uk-nav uk-dropdown-nav">
        <li class="uk-nav-header">FIND THIS SONG</li>
        <li><a target="_blank" rel="noopener" href="https://open.spotify.com/search/${query}"><i class="fab fa-spotify fa-fw fa-lg"></i> Spotify</a></li>
        <li><a target="_blank" rel="noopener" href="https://song.link/https://www.youtube.com/watch?v=${v.id}"><i class="fab fa-apple fa-fw fa-lg"></i> Apple Music</a></li>
        <li><a target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${v.id}"><i class="fab fa-youtube fa-fw fa-lg"></i> Youtube</a></li>
        <li><a target="_blank" rel="noopener" href="https://music.yandex.ru/search?text=${query}"><i class="fab fa-yandex fa-fw fa-lg"></i> Yandex.Music</a></li>
        <li><a href="#" data-favorite="${v.id}"><i class="fas fa-heart fa-fw fa-lg"></i> ${app.favorites.includes(v.id) ? 'Remove from favorites' : 'Add to favs'}</a></li>
        <li><a href="#" data-show-favorites>Favorites</a></li>
        <li><a href="#" data-show-credits>Credits</a></li>
      </ul>
    </div>
    <span id="songtitle" class="uk-transition-fade ${v.title.length > 30 ? 'uk-text-small' : ''}">${escape(v.title)} ${v.year >= 1950 ? `[${v.year}]` : ''}</span>`;
  $('likelogo').textContent = '';
  const rows = [['album', 'Album'], ['director', 'Director'], ['dop', 'Camera'], ['color', 'Colorist'], ['production', 'Production Company'], ['year', 'Year']];
  const metadata = rows.filter(([key]) => v[key]).map(([key, title]) => `${title}: ${escape(v[key])}<br>`).join('');
  $('ajaxHover').innerHTML = `<div uk-grid><div class="uk-width-5-6"><p class="uk-margin-remove uk-text-uppercase uk-h3"><strong>${escape(v.title)}</strong></p><p class="uk-margin-remove">${metadata}${escape(v.additional || '').replace(/&lt;br\s*\/?&gt;/gi, '<br>')}</p><br><button class="uk-button uk-button-default uk-button-large" data-favorite="${v.id}"><i class="fas fa-plus"></i> ${app.favorites.includes(v.id) ? 'Remove from favs' : 'Add to favs'}</button></div></div>`;
}
function renderLineup(force = false) {
  if (!app.schedule) return;
  const now = clock.now();
  const middle = Math.max(1, Math.min(config.maxChannel - 1, app.channel));
  const channels = app.channel > config.maxChannel ? [app.channel - 1, app.channel, app.channel + 1] : [middle - 1, middle, middle + 1];
  const positions = channels.map(ch => app.schedule.current(ch, now));
  const key = `${app.channel}:${positions.map(p => p.id + p.index).join(':')}:${app.options.itRedHighlight}`;
  if (!force && key === app.lineupKey) return;
  app.lineupKey = key;
  const time = epoch => new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const header = channels.map(ch => `<th><a href="#" data-channel="${ch}" class="uk-link-heading" style="opacity:${ch === app.channel ? 1 : .5}"><b>${escape(channelNames[ch] || '')}<br>channel ${ch + 1}</b></a></th>`).join('');
  const columns = channels.map(ch => `<th class="uk-text-truncate" style="vertical-align:top; color:inherit; opacity:${ch === app.channel ? 1 : .9}">${app.schedule.lineup(ch, now).map(v => {
    const highlight = v.current && ch === app.channel && app.options.itRedHighlight;
    const text = `${time(v.start)} <span class="shuffle">${v.current && ch === app.channel ? '▶︎ ' : ''}${escape(v.title)}</span>`;
    const badge = v.allkey >= app.videos.length - 35 ? ' <span class="uk-text-truncate uk-label uk-label-success newButton">NEW</span>' : '';
    return `<span style="opacity:${v.end <= now ? .5 : 1}" class="${highlight ? 'highlight-container' : ''}"><span class="${highlight ? 'highlight' : ''}">${v.current ? `<b>${text}</b>` : text}${badge}</span></span><br>`;
  }).join('')}</th>`).join('');
  $('ajaxLineup').innerHTML = `<table class="lineupactivity uk-table uk-table-justify uk-table-responsive uk-width-5-6 uk-table-small uk-table-top uk-overflow-auto"><thead><tr>${header}</tr></thead><tbody><tr>${columns}</tr></tbody><tfoot><tr><th colspan="3"><h5><button class="uk-button uk-button-default uk-visible@l" data-hide-lineup>HIDE LINEUP</button></h5></th></tr></tfoot></table>`;
  if (window.ShuffleText && UIkit.modal('#lineup').isToggled() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    all('#ajaxLineup .shuffle').forEach(element => { const effect = new ShuffleText(element); effect.duration = 400; effect.start(); });
  }
}
function toggleFavorite(id = app.current?.id) {
  if (!id) return;
  app.favorites = app.favorites.includes(id) ? app.favorites.filter(item => item !== id) : [...app.favorites, id];
  storage.set('favorites', app.favorites);
  renderTrack();
  renderFavorites();
}
function renderFavorites() {
  $('favs-tab').innerHTML = app.favorites.length ? app.favorites.map(id => {
    const v = app.videos.find(v => v.id === id);
    return v ? `<tr><td><a href="#" data-song="${id}">${escape(v.title)}</a></td><td><button class="uk-close" uk-close data-favorite="${id}" aria-label="Remove favorite"></button></td></tr>` : '';
  }).join('') : '<tr><td>No favorites yet.</td></tr>';
}
function showFavorites() { renderFavorites(); UIkit.modal('#favs-modal').show(); }
function showCredits() { app.manualCredits = !app.manualCredits; updateOverlays(); }
function showSearch() { UIkit.modal('#search-modal').show(); setTimeout(() => $('myInput').focus(), 50); renderSearch(); }
function renderSearch() {
  const query = $('myInput').value.trim().toLocaleLowerCase();
  const results = query ? app.videos.filter(v => v.title.toLocaleLowerCase().includes(query)) : [];
  $('search-results').innerHTML = results.slice(0, 80).map(v => `<a class="search-result" role="option" href="#" data-song="${v.id}">${escape(v.title)}${v.year ? ` <span class="uk-text-muted">[${v.year}]</span>` : ''}</a>`).join('') || (query ? '<p>No songs found.</p>' : '');
}
async function findSong(id) {
  const video = app.videos.find(v => v.id === id);
  if (!video || !app.schedule) return;
  if (!app.schedule.videos.some(v => v.id === id)) { message('This video is unavailable for embedding.'); return; }
  const token = ++app.searchToken;
  app.searching = true;
  message('Searching channels #1–6001…', 30000);
  UIkit.modal('#search-modal').hide();
  UIkit.modal('#favs-modal').hide();
  // Match a station broadcasting this song now; yield between chunks to keep UI responsive.
  for (let ch = 0; ch <= 6000; ch++) {
    if (token !== app.searchToken) { app.searching = false; return; }
    if (app.schedule.current(ch, clock.now()).id === id) {
      app.searching = false;
      changeChannel(ch);
      start();
      return;
    }
    if (ch % 40 === 39) await new Promise(resolve => setTimeout(resolve, 0));
  }
  app.searching = false;
  // A rare short clip may not have a matching station: play once, then resume live TV.
  app.direct = { ...video, start: clock.now() };
  start();
  message('Playing selected song. Live television resumes afterwards.');
}
function updateOverlays() {
  if (!app.current) return;
  const playing = app.started && !app.paused && app.state === 1;
  const v = app.current;
  const showTitles = playing && v.titles !== false && v.offset >= 5 && v.offset < 20;
  $('credcenter').style.opacity = showTitles ? '1' : '0';
  const showCredits = playing && v.hover !== false && (app.manualCredits || v.time - v.offset < Math.max(0, 25 + Number(v.hoverDelay ?? -5)));
  $('left-hover').hidden = !showCredits;
  const curtain = !app.started || app.paused || app.blocked || (app.loading && app.state !== 1);
  document.querySelector('.toggleplayer').style.display = curtain ? '' : 'none';
  $('userplay').textContent = app.paused ? 'PLAY' : '';
  const upcoming = app.options.itShowUpcoming && app.started && v.upcoming && !app.paused;
  $('itsatv-hdIcon').textContent = upcoming ? `Upcoming: ${v.upcoming.title}` : '';
  $('itsatv-hdIcon').style.opacity = upcoming ? '1' : '0';
  const small = params.has('smallui') || params.has('smallUI') || innerHeight < 360;
  $('itsatvUI-small').style.display = small && app.started ? '' : 'none';
  $('itsatvUI').style.display = small && app.started ? 'none' : '';
  const playIcon = `icon:${app.paused ? 'fa-play-s' : 'fa-pause-s'}; ratio:${innerWidth < 870 ? 1 : 2}`;
  if ($('itsatvSmallUI-Play').getAttribute('uk-icon') !== playIcon) $('itsatvSmallUI-Play').setAttribute('uk-icon', playIcon);
}
function tick() {
  if (!app.schedule) return;
  tune();
  if (app.ready && app.started && !app.paused && !app.blocked && app.skippedSlot !== slotKey(app.current)) {
    if (app.state === 1 && performance.now() - app.loadedAt > 5000) {
      const offset = app.player.getCurrentTime();
      if (Number.isFinite(offset) && Math.abs(offset - app.current.offset) > config.syncTolerance) {
        app.player.seekTo(app.current.offset, true);
      }
    }
    if (app.loading && performance.now() - app.loadedAt > 20000) {
      app.loading = false;
      app.blocked = true;
      spinner(false);
      message('YouTube is not responding. Check your connection and press PLAY to retry.', 15000);
    }
  }
  renderLineup();
  updateOverlays();
}
function playerError(event) {
  app.loading = false;
  spinner(false);
  const code = Number(event.data);
  if (code === 153) {
    app.blocked = true;
    message('YouTube rejected this player (153). Open the GitHub Pages site in a regular browser and press PLAY to retry.', 20000);
  } else if ([2, 100, 101, 150].includes(code)) {
    const key = slotKey(app.current);
    if (app.skippedSlot === key) { app.blocked = true; return; }
    app.skippedSlot = key;
    if (app.direct) { app.direct = null; tune(true); return; }
    if (!app.started) { message('This video is unavailable here. Press PLAY or change channel.'); return; }
    // Preview a playable upcoming clip without changing the station's shared timeline.
    const next = app.current.upcoming;
    message('This video cannot be played here. Showing the next clip until the live schedule resumes.', 10000);
    if (next) {
      app.loadedId = next.id;
      app.loading = true;
      app.loadedAt = performance.now();
      app.player.loadVideoById(next.id, 0);
    }
  } else {
    app.blocked = true;
    message(`YouTube playback error (${code}). Press PLAY to retry.`, 10000);
  }
  updateOverlays();
}
function createPlayer() {
  if (app.player || !window.YT?.Player) return;
  app.loadedAt = performance.now();
  app.player = new YT.Player('player', {
    host: 'https://www.youtube-nocookie.com',
    width: '100%', height: '100%',
    playerVars: {
      autoplay: 0, controls: 0, playsinline: 1, disablekb: 1, rel: 0,
      iv_load_policy: 3, cc_load_policy: 0, origin: location.origin
    },
    events: {
      onReady(event) {
        clearTimeout(app.apiTimeout);
        app.ready = true;
        event.target.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        event.target.getIframe().setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
        updateVolume();
        tune(true);
        if (app.started) event.target.playVideo();
        spinner(false);
      },
      onStateChange(event) {
        app.state = event.data;
        if (event.data === 1) { app.loading = false; app.blocked = false; spinner(false); }
        if (event.data === 3) spinner(true);
        if (event.data === 2 && app.started && !app.loading && !app.paused) {
          // The browser or user may pause the embedded media independently.
          app.paused = true;
        }
        if (event.data === 0 && app.started && !app.paused) {
          // Never reload an ended clip in a loop when catalog duration is too long.
          app.skippedSlot = app.current && slotKey(app.current);
          message('Waiting for the next scheduled clip…');
        }
        updateOverlays();
      },
      onError: playerError,
      onAutoplayBlocked() {
        app.blocked = true;
        app.loading = false;
        spinner(false);
        message('Press PLAY to allow playback.');
        updateOverlays();
      }
    }
  });
  window.player = app.player;
}
function loadYouTube() {
  if (window.YT?.Player) {
    if (app.player && !app.ready && performance.now() - app.loadedAt > 20000) {
      app.player.destroy();
      const placeholder = document.createElement('div');
      placeholder.id = 'player';
      document.querySelector('.yt-cover .overlay').appendChild(placeholder);
      app.player = null;
    }
    createPlayer();
    return;
  }
  if (app.apiLoading) return;
  app.apiLoading = true;
  window.onYouTubeIframeAPIReady = createPlayer;
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.id = 'youtube-api';
  script.onerror = () => {
    app.apiLoading = false;
    script.remove();
    spinner(false);
    message('Cannot reach YouTube. Press PLAY to retry.', 15000);
  };
  document.head.appendChild(script);
  app.apiTimeout = setTimeout(() => {
    if (!app.ready) {
      spinner(false);
      message('YouTube is taking too long to respond. Check your connection and press PLAY.', 15000);
    }
  }, 20000);
}
function status() {
  message(`Channel ${app.channel + 1} · ${app.schedule?.videos.length ?? 0} videos · Time: ${clock.source}${clock.synchronized ? '' : ' (external time unavailable)'}${app.direct ? ' · selected song' : ''}`, 10000);
}
function about() { $('it-aboutPicture').style.backgroundImage = "url('./images/tv1200bw.jpg')"; }
// Small compatibility surface for the unchanged original HTML handlers.
Object.assign(window, {
  it: { changeVolume },
  itsatv: { changeAboutBox: about },
  itsatvPlayer: { landing: { play: start, unMute() { app.muted = false; updateVolume(); start(); } }, likesonly: false },
  ChangeChannel: nextChannel, ReloadChannel: syncNow, takemetoChannel: changeChannel,
  showMenu, AddFaves: () => toggleFavorite(), ShowFavs: showFavorites,
  callfindSong: findSong, callfindSongName(title) { const v = app.videos.find(v => v.title === title); if (v) findSong(v.id); }
});

function bind() {
  const action = (id, fn) => all(`[data-original-id="${id}"]`).forEach(el => el.addEventListener('click', event => { event.preventDefault(); fn(); }));
  action('mutelink', mute);
  action('fulllink', fullscreen);
  action('nextlink', nextChannel);
  action('hidelink', () => showMenu(false));
  action('menu', () => showMenu());
  action('play2link', start);
  action('userplay', start);
  action('playlink', start);
  action('stoplink', pause);
  action('synclink', () => { clock.sync().then(syncNow); });
  action('statuslink', status);
  action('titleslink', showCredits);
  action('itsatvSmallUI-Back', previousChannel);
  action('itsatvSmallUI-Next', nextChannel);
  action('itsatvSmallUI-Play', togglePlay);
  action('itsatvSmallUI-Like', () => toggleFavorite());
  action('itsatvSmallUI-Search', showSearch);
  $('search-form').addEventListener('submit', event => {
    event.preventDefault();
    const query = $('myInput').value.trim().toLocaleLowerCase();
    const v = app.videos.find(v => v.title.toLocaleLowerCase().includes(query));
    if (v && query) findSong(v.id);
  });
  $('myInput').addEventListener('input', renderSearch);
  $('myInput').setAttribute('aria-label', 'Search songs');
  const iconLabels = { 'itsatvSmallUI-Back': 'Previous channel', 'itsatvSmallUI-Play': 'Play or pause', 'itsatvSmallUI-Next': 'Next channel', 'itsatvSmallUI-Like': 'Favorite', 'itsatvSmallUI-Search': 'Search songs', mutelink: 'Mute or unmute', fulllink: 'Fullscreen', nextlink: 'Next channel', controllink: 'Control panel', lineuplink: 'Lineup' };
  Object.entries(iconLabels).forEach(([id, label]) => all(`[data-original-id="${id}"]`).forEach(el => el.setAttribute('aria-label', label)));
  all('.chbox').forEach(input => {
    input.checked = !!app.options[input.value];
    input.addEventListener('change', () => {
      app.options[input.value] = input.checked;
      storage.set('options', app.options);
      paint(); renderLineup(true); updateOverlays();
    });
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-channel], [data-song], [data-favorite], [data-show-favorites], [data-show-credits], [data-hide-lineup]');
    if (!target) return;
    event.preventDefault();
    if (target.hasAttribute('data-channel')) changeChannel(Number(target.dataset.channel));
    if (target.dataset.song) findSong(target.dataset.song);
    if (target.dataset.favorite) toggleFavorite(target.dataset.favorite);
    if (target.hasAttribute('data-show-favorites')) showFavorites();
    if (target.hasAttribute('data-show-credits')) showCredits();
    if (target.hasAttribute('data-hide-lineup')) UIkit.modal('#lineup').hide();
  });
  document.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key !== 'x' && key !== 'f') return;
    const handlers = {
      arrowright: nextChannel, arrowleft: previousChannel, ' ': togglePlay,
      arrowdown: () => showMenu(), l: () => UIkit.modal('#lineup').toggle(),
      f: () => event.ctrlKey ? showSearch() : fullscreen(), x: () => { if (event.ctrlKey) showSearch(); },
      m: mute, a: () => toggleFavorite(), s: syncNow, t: () => { about(); UIkit.modal('#modal-full').show(); },
      u: status
    };
    if (handlers[key]) { event.preventDefault(); handlers[key](); }
  });
  addEventListener('resize', updateOverlays);
  let lastVisible = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { lastVisible = performance.now(); return; }
    if (performance.now() - lastVisible > 30000) clock.sync().then(() => tune(true)); else tune(true);
  });
  addEventListener('online', () => clock.sync().then(() => tune(true)));
  all('a[target="_blank"]').forEach(a => { a.rel = 'noopener'; });
}
async function init() {
  bind();
  updateVolume();
  showMenu(false);
  about();
  UIkit.modal('#landing-modal').show();
  if (window.ShuffleText && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const welcome = new ShuffleText($('itsatvWelcome').querySelector('b'));
    welcome.duration = 550;
    welcome.start();
  }
  try {
    const [videos, availability] = await Promise.all([
      fetch('./data/videos.json').then(r => { if (!r.ok) throw new Error('Catalog unavailable'); return r.json(); }),
      fetch('./data/availability.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      clock.sync()
    ]);
    app.videos = videos;
    app.schedule = new Schedule(videos, availability.excluded ?? []);
    tune();
    loadYouTube();
    setInterval(tick, 500);
    setInterval(() => clock.sync().then(() => tune()), config.clockRefreshMs);
    spinner(false);
    if (app.options.itShowStatus) status();
    if (params.get('findid')) await findSong(params.get('findid'));
  } catch {
    spinner(false);
    message('Cannot load the video catalog. Serve this folder over HTTP(S) and reload the page.', 60000);
    $('itsatvWelcomePlay').textContent = 'RELOAD';
    $('itsatvWelcomePlay').onclick = () => location.reload();
  }
}
init();
