export const config = Object.freeze({
  version: '0.1.9',
  maxChannel: 20,
  syncTolerance: 4,
  videoRevealDelayMs: 500,
  clockRefreshMs: 15 * 60 * 1000,
  clockTimeoutMs: 4000,
  // Public demo key from the original ITSATV. Used only by the optional CLI checker.
  youtubeApiKey: 'AIzaSyD8NdSwnOL_4ddjAHCPlaJfD0SAuCrvc-I',
  timeSources: [
    { url: 'https://timeapi.io/api/time/current/zone?timeZone=UTC', format: 'timeapi' },
    { url: 'https://worldtime.timezone.io/api/timezone/Etc/UTC', format: 'worldtime' }
  ]
});
