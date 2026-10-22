// Player preferences, with stremio-core's defaults (types/profile/settings.rs).

const Prefs = (function () {
  const DEFAULTS = {
    subtitlesLanguage: 'eng', // null = subtitles off by default
    subtitlesSize: 100,       // % (75..250)
    subtitlesOffset: 5,       // vertical position, % from the bottom
    audioLanguage: 'eng',
    bingeWatching: true,      // play the next episode automatically
    nextVideoPopup: 35000     // ms before the end; 0 = off
  };
  let values = Object.assign({}, DEFAULTS, store.get('prefs', {}));

  return {
    get(key) { return values[key]; },
    set(key, value) { values[key] = value; store.set('prefs', values); },
    SUBTITLE_SIZES: [75, 100, 125, 150, 175, 200, 250]
  };
})();
