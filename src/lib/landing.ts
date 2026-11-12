import { esc } from './security';

export type LandingAudioTrack = { id: number; url: string; filename: string };

/** Decode the ordered media IDs saved by Settings without trusting stored JSON. */
export function parseLandingAudioIds(value: string | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * The splash is a fixed part of the public home response — it is never built
 * from a CMS Page or sample content. Its identity comes from saved settings
 * (site title, tagline and logo), while its soundtrack is explicitly started
 * by the visitor (browsers commonly block audible autoplay). `head` decides
 * whether the splash is visible before the page paints; `body` supplies the
 * accessible UI and the looping playlist player.
 */
export function landingScreenMarkup(opts: {
  siteTitle: string;
  tagline: string;
  logoUrl: string;
  tracks: LandingAudioTrack[];
  nonce: string;
}): { head: string; body: string } {
  const nonce = esc(opts.nonce);
  const hasTracks = opts.tracks.length > 0;
  const urls = JSON.stringify(opts.tracks.map((track) => track.url));
  const siteTitle = esc(opts.siteTitle.trim());
  const tagline = esc(opts.tagline.trim());
  const logo = opts.logoUrl.trim()
    ? `<img class="ams-landing-logo" src="${esc(opts.logoUrl.trim())}" alt="${siteTitle}">`
    : '';
  const copy = tagline ? `<p class="ams-landing-tagline">${tagline}</p>` : '';
  const status = hasTracks
    ? 'Press play to start the soundtrack.'
    : 'No soundtrack has been added yet. Upload audio in Settings to enable playback.';

  const head = `<style nonce="${nonce}">${LANDING_CSS}</style>
<script nonce="${nonce}">${LANDING_BOOTSTRAP}</script>`;
  const body = `<div class="ams-landing-screen" id="ams-landing-screen" role="dialog" aria-modal="true" aria-labelledby="ams-landing-title" data-audio-tracks="${esc(urls)}">
  <div class="ams-landing-card">
    ${logo}
    <p class="ams-landing-brand">Welcome to</p>
    <div class="ams-landing-copy">
      <h1 id="ams-landing-title">${siteTitle}</h1>
      ${copy}
    </div>
    <div class="ams-landing-equalizer" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <p class="ams-landing-status" id="ams-landing-status" role="status" aria-live="polite">${status}</p>
    <div class="ams-landing-controls">
      <button class="ams-landing-play" type="button" data-landing-play aria-label="Play soundtrack"${hasTracks ? '' : ' disabled'}>
        <svg class="ams-landing-icon ams-landing-icon-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.6 4.9a1 1 0 0 1 1.53-.84l10 7.1a1 1 0 0 1 0 1.68l-10 7.1a1 1 0 0 1-1.53-.84z"/></svg>
        <svg class="ams-landing-icon ams-landing-icon-pause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.2 5h3.5v14H7.2zM13.3 5h3.5v14h-3.5z"/></svg>
      </button>
      <div class="ams-landing-secondary">
        ${hasTracks ? '<button class="ams-landing-mute" type="button" data-landing-mute aria-pressed="false">Mute sound</button>' : ''}
        <button class="ams-landing-enter" type="button" data-landing-enter>Enter site</button>
      </div>
    </div>
    ${hasTracks ? '<p class="ams-landing-footnote">Your soundtrack will loop until you enter.</p>' : ''}
  </div>
  <audio class="ams-landing-audio" data-landing-audio preload="auto"></audio>
</div>
<script nonce="${nonce}">${LANDING_PLAYER}</script>`;
  return { head, body };
}

const LANDING_BOOTSTRAP = `(function(){var forced=/(?:^|[?&])landing=1(?:&|$)/.test(location.search);var show=true;try{if(forced)sessionStorage.removeItem('ams-landing-entered');show=forced||sessionStorage.getItem('ams-landing-entered')!=='1'}catch(e){}if(show)document.documentElement.setAttribute('data-ams-landing','show')})();`;

const LANDING_PLAYER = `(function(){
  var screen=document.getElementById('ams-landing-screen');
  if(!screen)return;
  var active=document.documentElement.getAttribute('data-ams-landing')==='show';
  var audio=screen.querySelector('[data-landing-audio]');
  var playButton=screen.querySelector('[data-landing-play]');
  var muteButton=screen.querySelector('[data-landing-mute]');
  var enterButton=screen.querySelector('[data-landing-enter]');
  var status=screen.querySelector('#ams-landing-status');
  var tracks=[];try{tracks=JSON.parse(screen.getAttribute('data-audio-tracks')||'[]')}catch(e){}
  if(!Array.isArray(tracks))tracks=[];
  // One track loops natively; a playlist loops by wrapping in the ended handler.
  audio.loop=tracks.length===1;
  var current=0;
  var muted=false;
  var card=screen.querySelector('.ams-landing-card');
  // Fetch the first track while the visitor is still reading the screen, so the
  // play gesture starts sound from the buffer instead of waiting for a download.
  // A discarded screen (this tab already entered) downloads nothing.
  function warm(){
    if(!tracks.length||audio.getAttribute('src'))return;
    audio.muted=muted;
    audio.preload='auto';
    audio.src=tracks[current];
  }
  function update(){
    var playing=!audio.paused;
    if(card)card.classList.toggle('is-playing',playing);
    if(playButton)playButton.setAttribute('aria-label',playing?'Pause soundtrack':'Play soundtrack');
    if(muteButton){muteButton.textContent=muted?'Unmute sound':'Mute sound';muteButton.setAttribute('aria-pressed',muted?'true':'false')}
    if(status&&tracks.length)status.textContent=playing?'Soundtrack playing. It will loop until you enter.':'Soundtrack paused. Press play to continue.';
  }
  function failed(){
    audio.pause();
    if(card)card.classList.remove('is-playing');
    update();
    if(status)status.textContent='This audio file could not be played. Try another format in Settings.';
  }
  function playTrack(index,attempts){
    if(!tracks.length)return;
    current=index%tracks.length;
    audio.src=tracks[current];
    audio.muted=muted;
    audio.load();
    audio.play().then(function(){if(status)status.textContent='Soundtrack playing. It will loop until you enter.';update()}).catch(function(){
      if(attempts>1)playTrack((current+1)%tracks.length,attempts-1);else failed();
    });
  }
  function start(){
    if(!tracks.length)return;
    // No source yet means warm() could not run: load, then play.
    if(!audio.getAttribute('src')){playTrack(current,tracks.length);return}
    // The warm source is already buffered, so this starts on the same task as
    // the click; if the file is unusable, fall through to the next track.
    audio.play().then(update).catch(function(){playTrack((current+1)%tracks.length,tracks.length-1)});
  }
  if(active)warm();
  if(playButton)playButton.addEventListener('click',function(){if(audio.paused)start();else audio.pause()});
  if(muteButton)muteButton.addEventListener('click',function(){muted=!muted;audio.muted=muted;update()});
  audio.addEventListener('play',update);
  audio.addEventListener('pause',update);
  audio.addEventListener('ended',function(){
    if(!tracks.length)return;
    if(tracks.length===1){audio.currentTime=0;audio.play().catch(failed)}
    else playTrack((current+1)%tracks.length,tracks.length);
  });
  if(enterButton)enterButton.addEventListener('click',function(){
    audio.pause();
    try{audio.currentTime=0;audio.removeAttribute('src');audio.load()}catch(e){}
    try{
      sessionStorage.setItem('ams-landing-entered','1');
      var url=new URL(location.href);
      if(url.searchParams.get('landing')==='1'){
        url.searchParams.delete('landing');
        history.replaceState(null,'',url.pathname+url.search+url.hash);
      }
    }catch(e){}
    document.documentElement.removeAttribute('data-ams-landing');
    screen.remove();
    var main=document.getElementById('main');
    if(main){main.setAttribute('tabindex','-1');main.focus({preventScroll:true})}
  });
  if(active){
    var first=screen.querySelector('button:not([disabled])');if(first)first.focus({preventScroll:true});
    screen.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();if(enterButton)enterButton.click();return}
      if(event.key!=='Tab')return;
      var focusable=Array.prototype.slice.call(screen.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')).filter(function(el){return el.getClientRects().length>0});
      if(!focusable.length)return;
      var first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    });
  }
})();`;

const LANDING_CSS = `
html[data-ams-landing="show"],html[data-ams-landing="show"] body{overflow:hidden}
.ams-landing-screen{display:none;position:fixed;z-index:2147483000;inset:0;place-items:center;overflow-y:auto;overscroll-behavior:contain;padding:clamp(1rem,4vw,3.5rem);background:radial-gradient(ellipse at 50% 0%,rgba(47,80,138,.34),transparent 58%),radial-gradient(ellipse at 100% 100%,rgba(114,68,125,.24),transparent 50%),linear-gradient(145deg,#090d16 0%,#111827 55%,#10121c 100%);color:#f5f7fb;font:500 16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
html[data-ams-landing="show"] .ams-landing-screen{display:grid}
.ams-landing-card{width:min(100%,42rem);margin:auto;padding:clamp(1.5rem,5vw,3.5rem);border:1px solid rgba(255,255,255,.13);border-radius:clamp(1.2rem,3vw,2rem);background:rgba(10,14,23,.76);box-shadow:0 2rem 7rem rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(22px);text-align:center}
.ams-landing-logo{display:block;max-width:min(15rem,75%);max-height:5.5rem;width:auto;height:auto;margin:0 auto 1.25rem;object-fit:contain}
.ams-landing-brand{margin:0 0 1.3rem;color:#b7c7e8;font-size:.75rem;font-weight:750;letter-spacing:.2em;text-transform:uppercase;overflow-wrap:anywhere}
.ams-landing-copy{max-width:34rem;margin:0 auto}
.ams-landing-copy h1{margin:0 0 .75rem;color:#fff;font-size:clamp(2rem,7vw,4.1rem);font-weight:750;letter-spacing:-.055em;line-height:1.04;overflow-wrap:anywhere}
.ams-landing-copy p{margin:.55rem 0;color:#c3cad8;font-size:clamp(.98rem,2.7vw,1.12rem)}
.ams-landing-tagline{overflow-wrap:anywhere}
.ams-landing-equalizer{height:3.3rem;display:flex;align-items:center;justify-content:center;gap:.28rem;margin:1.6rem auto .9rem}
.ams-landing-equalizer span{display:block;width:clamp(.2rem,1vw,.38rem);height:var(--bar-height,1rem);border-radius:99px;background:linear-gradient(180deg,#d6e6ff,#739cff 55%,#b67be6);opacity:.74;transform-origin:center;animation:none}
.ams-landing-equalizer span:nth-child(1){--bar-height:1rem}.ams-landing-equalizer span:nth-child(2){--bar-height:2.1rem}.ams-landing-equalizer span:nth-child(3){--bar-height:2.8rem}.ams-landing-equalizer span:nth-child(4){--bar-height:1.5rem}.ams-landing-equalizer span:nth-child(5){--bar-height:2.4rem}.ams-landing-equalizer span:nth-child(6){--bar-height:3.1rem}.ams-landing-equalizer span:nth-child(7){--bar-height:2.2rem}.ams-landing-equalizer span:nth-child(8){--bar-height:1.3rem}.ams-landing-equalizer span:nth-child(9){--bar-height:2.6rem}.ams-landing-equalizer span:nth-child(10){--bar-height:1.8rem}.ams-landing-equalizer span:nth-child(11){--bar-height:1rem}
.ams-landing-card.is-playing .ams-landing-equalizer span{animation:ams-landing-bars .72s ease-in-out infinite alternate}
.ams-landing-card.is-playing .ams-landing-equalizer span:nth-child(2n){animation-duration:.54s;animation-delay:-.31s}.ams-landing-card.is-playing .ams-landing-equalizer span:nth-child(3n){animation-duration:.91s;animation-delay:-.58s}.ams-landing-card.is-playing .ams-landing-equalizer span:nth-child(5n){animation-delay:-.2s}
@keyframes ams-landing-bars{from{transform:scaleY(.2);opacity:.54}to{transform:scaleY(1);opacity:1}}
.ams-landing-status{min-height:1.6em;margin:0 0 1rem;color:#aab5c9;font-size:.86rem}
.ams-landing-controls{display:grid;justify-items:center;gap:.8rem;width:min(100%,22rem);margin:0 auto}
.ams-landing-play,.ams-landing-mute,.ams-landing-enter{min-height:3rem;border:1px solid transparent;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;transition:transform .18s ease,filter .18s ease,background-color .18s ease}
.ams-landing-play{display:grid;place-items:center;width:4.9rem;height:4.9rem;min-height:0;padding:0;border-radius:50%;color:#101526;background:linear-gradient(140deg,#e4eeff,#9cb8ff 52%,#d4b6ff);box-shadow:0 .7rem 2.2rem rgba(134,165,255,.34),inset 0 1px rgba(255,255,255,.55)}
.ams-landing-play:hover:not(:disabled){transform:translateY(-2px);filter:brightness(1.06)}
.ams-landing-icon{display:block;width:1.95rem;height:1.95rem;fill:currentColor}
.ams-landing-icon-play{transform:translateX(.12rem)}
.ams-landing-icon-pause{display:none}
.ams-landing-card.is-playing .ams-landing-icon-play{display:none}
.ams-landing-card.is-playing .ams-landing-icon-pause{display:block}
.ams-landing-secondary{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:.6rem;width:100%}
.ams-landing-mute,.ams-landing-enter{min-height:2.75rem;padding:.5rem 1rem;border-color:rgba(255,255,255,.17);color:#eef2fa;background:rgba(255,255,255,.065);font-size:.9rem}
.ams-landing-enter{border-color:rgba(255,255,255,.32);background:transparent}
.ams-landing-mute:hover:not(:disabled),.ams-landing-enter:hover{background:rgba(255,255,255,.14)}
.ams-landing-play:focus-visible,.ams-landing-mute:focus-visible,.ams-landing-enter:focus-visible{outline:3px solid #fff;outline-offset:3px}
.ams-landing-play:disabled,.ams-landing-mute:disabled{opacity:.58;cursor:not-allowed}
.ams-landing-footnote{margin:1.1rem 0 0;color:#8f9ab0;font-size:.77rem}
.ams-landing-audio{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:420px){.ams-landing-play{width:4.4rem;height:4.4rem}.ams-landing-card{padding:1.35rem 1.1rem}.ams-landing-equalizer{margin-top:1.2rem}.ams-landing-secondary{display:grid;grid-template-columns:1fr 1fr}.ams-landing-mute,.ams-landing-enter{width:100%;padding-inline:.5rem}}
@media(prefers-reduced-motion:reduce){.ams-landing-play,.ams-landing-mute,.ams-landing-enter{transition:none}.ams-landing-card.is-playing .ams-landing-equalizer span{animation:none;transform:scaleY(.7)}}
`;
