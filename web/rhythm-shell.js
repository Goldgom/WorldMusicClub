import {localizeStatic} from './locale-view.js';

/** Presentation and screen links only. Existing app controllers own every action. */
export function setupRhythmShell({document, i18n, show, open}) {
  const $ = id => document.getElementById(id);
  const root = document.body;
  root.classList.add('rhythm-shell');
  const make = (tag, className, key) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (key) { node.setAttribute('data-i18n', key); node.textContent = i18n.t(key); }
    return node;
  };
  const action = (id, key, screen) => {
    const node = make('button', 'button secondary rhythm-screen-action', key);
    node.id = id; node.type = 'button';
    node.setAttribute('aria-controls', screen === 'free' ? 'free-practice-screen' : 'workspace');
    const handler = () => show(screen);
    node.addEventListener('click', handler);
    cleanups.push(() => node.removeEventListener('click', handler));
    return node;
  };
  const cleanups = [];
  const brand = $('shell-brand').querySelector('.brand');
  const home = event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault(); show('home');
  };
  brand.addEventListener('click', home);
  cleanups.push(() => brand.removeEventListener('click', home));
  brand.setAttribute('aria-controls', 'game-home');
  const location = make('span', 'rhythm-location');
  location.id = 'rhythm-location';
  $('shell-brand').append(location);

  const heading = $('song-lobby').querySelector('.lobby-heading');
  const local = make('span', 'rhythm-local');
  const dot = make('i'); dot.setAttribute('aria-hidden', 'true');
  local.append(dot, make('span', '', 'rhythm.local'));
  heading.append(local);
  const back = action('lobby-home', 'rhythm.backHome', 'home');
  back.setAttribute('aria-controls', 'game-home'); heading.prepend(back);
  const homeScreen = make('section', 'game-home'); homeScreen.id = 'game-home';
  homeScreen.setAttribute('aria-labelledby', 'home-title'); homeScreen.setAttribute('role', 'main');
  $('song-lobby').before(homeScreen);
  const intro = make('div', 'rhythm-home-intro');
  const hero = make('section', 'rhythm-hero');
  hero.setAttribute('aria-labelledby', 'home-title');
  const heroCopy = make('div', 'rhythm-hero-copy');
  const title = make('h2'); title.id = 'home-title';title.tabIndex=-1;
  title.append(make('span', '', 'rhythm.heroLead'), make('span', 'rhythm-hero-accent', 'rhythm.heroAccent'));
  heroCopy.append(make('p', 'rhythm-kicker', 'rhythm.kicker'), title, make('p', 'rhythm-hero-description', 'rhythm.heroDescription'));
  const art = make('div', 'rhythm-hero-art'); art.setAttribute('aria-hidden', 'true');
  art.innerHTML = '<i class="rhythm-orbit"></i><i class="rhythm-orbit rhythm-orbit-two"></i><div class="rhythm-note-tile">♪</div><span class="rhythm-note-trail">1 · 3 · 5</span>';
  hero.append(heroCopy, art);
  const free = make('section', 'rhythm-free-entry'); free.setAttribute('aria-labelledby', 'rhythm-free-title');
  const freeTitle = make('h2', '', 'free.title'); freeTitle.id = 'rhythm-free-title';
  const freeIcon = make('span', 'rhythm-free-icon'); freeIcon.textContent = '∿'; freeIcon.setAttribute('aria-hidden', 'true');
  const freeActions = make('div', 'rhythm-entry-actions');
  freeActions.append(make('span', '', 'rhythm.freeLocal'), $('start-free-practice'));
  free.append(freeIcon, freeTitle, make('p', '', 'rhythm.freeDescription'), freeActions);
  const menu = make('nav', 'game-mode-menu'); menu.setAttribute('data-i18n-aria-label','rhythm.chooseMode');
  function mode(id, icon, titleKey, descriptionKey, target, planned = false) {
    const button = make('button', 'game-mode'); button.id=id; button.type='button';
    const symbol=make('span','game-mode-icon');symbol.textContent=icon;symbol.setAttribute('aria-hidden','true');
    const copy=make('span','game-mode-copy');copy.append(make('strong','',titleKey),make('small','',descriptionKey));
    button.append(symbol,copy); button.disabled=planned;
    if(planned)button.append(make('span','game-mode-badge','rhythm.planned'));
    else {const arrow=make('span','game-mode-arrow');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');button.append(arrow);}
    const handler=()=>{if(planned)return;if(target==='library')show('library');else {open('settings');if(target==='appearance')$('theme-mode').focus();}};
    button.addEventListener('click',handler);cleanups.push(()=>button.removeEventListener('click',handler));menu.append(button);
    return button;
  }
  mode('home-single-player','▶','rhythm.singlePlayer','rhythm.singleDescription','library');
  mode('home-collaboration','♬','rhythm.collaboration','rhythm.collaborationDescription',null,true);
  mode('home-online','◎','rhythm.online','rhythm.onlineDescription',null,true);
  mode('home-appearance','◈','rhythm.appearance','rhythm.appearanceDescription','appearance');
  mode('home-settings','⚙','nav.settings','rhythm.settingsDescription','settings');
  intro.append(hero,menu);homeScreen.append(intro,free);
  // Move the original entry button; no second session, recorder or handler.
  $('start-free-practice').setAttribute('data-i18n', 'rhythm.enterFree');
  $('start-free-practice').setAttribute('aria-describedby', 'rhythm-free-title');
  const stageFree = action('rhythm-stage-free', 'free.title', 'free');
  document.querySelector('.stage-hud').append(stageFree);

  let freeResume, freeScreen;
  function arrangeFreeScreen() {
    const screen = $('free-practice-screen');
    if (!screen || screen === freeScreen) return;
    freeScreen = screen;
    freeResume = action('rhythm-free-resume', 'nav.resumeSession', 'stage');
    const freeHeading = screen.querySelector('.free-practice-heading');
    const navigation = make('div', 'rhythm-free-navigation');
    navigation.append(freeResume, $('free-exit')); freeHeading.append(navigation);
    const console = make('div', 'rhythm-free-console');
    console.setAttribute('role', 'group');
    console.setAttribute('data-i18n-aria-label', 'rhythm.recordingControls');
    const meter = make('div', 'rhythm-free-meter');
    meter.append($('free-state'), $('free-event-count'));
    const controls = screen.querySelector(':scope > .free-practice-actions');
    controls.before(console); console.append(controls, meter);
    localizeStatic(screen, i18n);
  }

  function update({screen, hasSession = false}) {
    arrangeFreeScreen();
    homeScreen.hidden = screen !== 'home';
    const key = screen === 'home' ? 'rhythm.home' : screen === 'stage' ? 'rhythm.stage' : screen === 'free' ? 'free.title' : 'rhythm.library';
    location.textContent = i18n.t(key);
    if (screen === 'home') brand.setAttribute('aria-current', 'page'); else brand.removeAttribute('aria-current');
    if (freeResume) freeResume.hidden = !hasSession;
  }
  localizeStatic(document, i18n);
  return {update, destroy() { for (const cleanup of cleanups) cleanup(); }};
}
