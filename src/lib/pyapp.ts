/**
 * Python apps embedded in a post or page.
 *
 * The editor stores one as plain, sanitizer-safe markup:
 *
 *   <figure class="python-app align-center" style="width:100%;height:420px" title="app.py">
 *     <pre><code>…escaped source…</code></pre>
 *   </figure>
 *
 * With JavaScript off that is a readable code listing. With it on, the public
 * page swaps the listing for an iframe of `/__pyapp/runner`, which runs the
 * program with Pyodide (CPython compiled to WebAssembly) in the visitor's
 * browser. Nothing is ever executed on the server.
 *
 * Isolation is the point of the iframe: it is sandboxed without
 * `allow-same-origin`, so the program runs in an opaque origin with no cookies,
 * no storage and no way to reach the panel, whoever wrote it. Inside it the
 * interpreter lives in a Web Worker, so a busy loop cannot freeze the page and
 * Stop/Restart is simply ending the worker.
 */
import { PY_BOOTSTRAP } from './pyapp-bootstrap';

/** Pinned so a published app keeps running the interpreter it was tested with. */
export const PYODIDE_VERSION = '314.0.8';
export const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PYAPP_RUNNER_PATH = '/__pyapp/runner';

/** The runner's own policy: it replaces (not inherits) the site's CSP. */
export const PYAPP_RUNNER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src https:",
  "frame-ancestors 'self'",
  "sandbox allow-scripts",
].join('; ');

const inlineJs = (value: string): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const WORKER_JS = `
var pending=null;
function send(kind,text){postMessage({t:String(kind),s:String(text)})}
self.onmessage=function(e){
  var m=e.data||{};
  if(m.t==='line'&&pending){var r=pending;pending=null;r(m.s);return}
  if(m.t!=='run')return;
  (async function(){
    try{
      var mod=await import(m.base+'pyodide.mjs');
      var py=await mod.loadPyodide({indexURL:m.index||m.base});
      postMessage({t:'status',s:'Preparing…'});
      try{await py.loadPackagesFromImports(m.code,{messageCallback:function(){},errorCallback:function(){}})}catch(err){}
      py.runPython(m.boot);
      var run=py.globals.get('ams_run');
      postMessage({t:'start'});
      var status=await run(m.code,m.name,send,function(){
        return new Promise(function(resolve){pending=resolve;postMessage({t:'ask'})});
      });
      postMessage({t:'end',s:String(status)});
    }catch(err){
      postMessage({t:'fail',s:String(err&&err.message||err)});
    }
  })();
};
`;

const RUNNER_CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;background:#0d1117;color:#e6edf3;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
.bar{display:flex;align-items:center;gap:.6rem;flex:0 0 auto;min-height:2.4rem;padding:.3rem .6rem .3rem .8rem;background:#161b22;border-bottom:1px solid #30363d;font:13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}
.dot{flex:0 0 auto;width:.6rem;height:.6rem;border-radius:50%;background:#6e7681}
.dot.load{background:#d29922;animation:pulse 1s ease-in-out infinite}
.dot.run{background:#3fb950}
.dot.wait{background:#58a6ff;animation:pulse 1.4s ease-in-out infinite}
.dot.err{background:#f85149}
@keyframes pulse{50%{opacity:.35}}
.name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.status{flex:1 1 0;min-width:0;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{flex:0 0 auto;min-height:1.9rem;padding:0 .7rem;border:1px solid #30363d;border-radius:6px;background:#21262d;color:#e6edf3;font:inherit;cursor:pointer}
button:hover{background:#30363d}
button:focus-visible,#in:focus-visible{outline:2px solid #58a6ff;outline-offset:1px}
#screen{flex:1 1 auto;min-height:0;overflow:auto;padding:.7rem .85rem;cursor:text;overscroll-behavior:contain}
#out{margin:0;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
#out .e{color:#ff7b72}
#out .u{color:#79c0ff}
#out .n{color:#8b949e;font-style:italic}
#out img{display:block;max-width:100%;height:auto;margin:.5rem 0;border-radius:4px;background:#fff}
#in{display:inline-block;width:12ch;min-width:2ch;max-width:100%;padding:0;border:0;border-bottom:1px dashed #58a6ff;background:transparent;color:#79c0ff;font:inherit;outline:0;caret-color:#58a6ff}
@media (prefers-reduced-motion:reduce){.dot{animation:none!important}}
`;

const RUNNER_JS = `
(function(){
  var BASE=__BASE__,BOOT=__BOOT__,WORKER=__WORKER__;
  var out=document.getElementById('out'),screen=document.getElementById('screen');
  var dot=document.getElementById('dot'),statusEl=document.getElementById('status'),nameEl=document.getElementById('name');
  var restart=document.getElementById('restart');
  var code=null,name='app.py',worker=null,field=null,touched=false,chars=0,MAX=400000;
  function state(kind,text){dot.className='dot '+kind;statusEl.textContent=text}
  function nearEnd(){return screen.scrollHeight-screen.scrollTop-screen.clientHeight<40}
  function add(node){
    var stick=nearEnd();
    if(field&&field.parentNode===out)out.insertBefore(node,field);else out.appendChild(node);
    if(stick)screen.scrollTop=screen.scrollHeight;
  }
  function write(text,cls){
    // Colour codes and cursor moves mean nothing here; show the words.
    text=String(text).replace(/\\u001b\\[[0-9;?]*[A-Za-z]/g,'').replace(/\\r\\n?/g,'\\n');
    if(!text)return;
    chars+=text.length;
    while(chars>MAX&&out.firstChild&&out.firstChild!==field){chars-=(out.firstChild.textContent||'').length;out.removeChild(out.firstChild)}
    var span=document.createElement('span');
    if(cls)span.className=cls;
    span.textContent=text;
    add(span);
  }
  function image(src){
    if(!/^data:image\\/png;base64,[A-Za-z0-9+\\/=]+$/.test(src))return;
    var img=document.createElement('img');img.alt='Figure drawn by the program';img.src=src;add(img);
  }
  function ask(){
    state('wait','Waiting for your input');
    field=document.createElement('input');
    field.id='in';field.type='text';field.autocomplete='off';field.spellcheck=false;
    field.setAttribute('autocapitalize','off');field.setAttribute('aria-label','Type your answer and press Enter');
    field.addEventListener('input',function(){field.style.width=Math.max(12,field.value.length+2)+'ch'});
    field.addEventListener('keydown',function(e){
      if(e.key!=='Enter')return;
      e.preventDefault();
      var value=field.value,done=field;
      field=null;done.remove();
      write(value+'\\n','u');
      state('run','Running');
      if(worker)worker.postMessage({t:'line',s:value});
    });
    out.appendChild(field);
    screen.scrollTop=screen.scrollHeight;
    // Never pull the reader's page to this frame; take the keyboard only once
    // they have clicked into it.
    if(touched)try{field.focus({preventScroll:true})}catch(e){field.focus()}
  }
  function stop(){if(worker){worker.terminate();worker=null}field=null}
  function start(){
    stop();
    out.textContent='';chars=0;
    state('load','Loading Python… the first run downloads about 10 MB');
    var url;
    try{
      url=URL.createObjectURL(new Blob([WORKER],{type:'text/javascript'}));
      worker=new Worker(url,{type:'module'});
    }catch(err){state('err','This browser cannot run Python here');write('Web Workers are not available in this browser.\\n','e');return}
    var mine=worker;
    mine.onmessage=function(e){
      if(mine!==worker)return;
      var m=e.data||{};
      if(m.t==='out')write(m.s,'');
      else if(m.t==='err')write(m.s,'e');
      else if(m.t==='img')image(m.s);
      else if(m.t==='status')state('load',m.s);
      else if(m.t==='start')state('run','Running');
      else if(m.t==='ask')ask();
      else if(m.t==='end'){
        state(m.s==='error'?'err':'','');
        statusEl.textContent=m.s==='error'?'Stopped with an error':'Finished';
        write('\\n— '+(m.s==='error'?'the program stopped with an error':'program finished')+' · Restart to run it again —\\n','n');
        stop();
      }else if(m.t==='fail'){
        state('err','Python could not start');
        write('Python could not be loaded: '+m.s+'\\nCheck the connection and press Restart.\\n','e');
        stop();
      }
    };
    mine.onerror=function(e){
      if(mine!==worker)return;
      state('err','Python could not start');
      write('Python could not be loaded'+(e&&e.message?': '+e.message:'')+'.\\n','e');
      stop();
    };
    mine.postMessage({t:'run',code:code,name:name,base:BASE,boot:BOOT});
    setTimeout(function(){try{URL.revokeObjectURL(url)}catch(e){}},30000);
  }
  restart.addEventListener('click',function(){touched=true;if(code!==null)start()});
  screen.addEventListener('mousedown',function(e){
    touched=true;
    // Clicking the terminal puts the cursor in the answer box; a drag still selects text.
    if(field&&e.target!==field)setTimeout(function(){var sel=window.getSelection();if(field&&(!sel||sel.isCollapsed))field.focus()},0);
  });
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;
    var m=e.data||{};
    if(m.ams!=='pyapp'||m.t!=='code'||typeof m.code!=='string')return;
    code=m.code;
    name=String(m.name||'app.py').replace(/[^A-Za-z0-9._ -]/g,'').slice(0,80)||'app.py';
    if(!/\\.py$/i.test(name))name+='.py';
    nameEl.textContent=name;
    start();
  });
  state('load','Starting…');
  window.parent.postMessage({ams:'pyapp',t:'ready'},'*');
})();
`;

let runnerCache: string | null = null;

/** The document inside the sandboxed iframe: a small terminal around Pyodide. */
export function pythonRunnerPage(): string {
  if (runnerCache) return runnerCache;
  const js = RUNNER_JS
    .replace('__BASE__', () => inlineJs(PYODIDE_BASE))
    .replace('__BOOT__', () => inlineJs(PY_BOOTSTRAP))
    .replace('__WORKER__', () => inlineJs(WORKER_JS));
  runnerCache = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Python app</title>
<style>${RUNNER_CSS}</style>
</head>
<body>
<div class="bar"><span class="dot" id="dot"></span><span class="name" id="name">app.py</span><span class="status" id="status" role="status" aria-live="polite"></span><button type="button" id="restart" title="Stop the program and run it again from the start">Restart</button></div>
<div id="screen"><pre id="out" aria-live="polite"></pre></div>
<noscript>This Python app needs JavaScript.</noscript>
<script>${js}</script>
</body>
</html>`;
  return runnerCache;
}

/* ----------------------------------------------------------- public page */

/** Layout for the block itself; the theme never has to know about it. */
export const PYAPP_PUBLIC_CSS = `figure.python-app{display:flex;flex-direction:column;box-sizing:border-box;width:100%;max-width:100%;height:420px;margin:1.5em auto;padding:0;border:1px solid rgba(127,127,127,.35);border-radius:10px;overflow:hidden;background:#0d1117;color:#e6edf3;clear:both}
figure.python-app.align-left{float:left;clear:none;margin:.3em 1.25em 1em 0}
figure.python-app.align-right{float:right;clear:none;margin:.3em 0 1em 1.25em}
figure.python-app>pre{flex:1 1 auto;min-height:0;margin:0;padding:.8rem 1rem;border:0;border-radius:0;overflow:auto;background:transparent;color:inherit;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;tab-size:4}
figure.python-app>pre code{padding:0;background:none;color:inherit;font:inherit}
figure.python-app>pre[hidden]{display:none}
figure.python-app>iframe{flex:1 1 auto;display:block;width:100%;min-height:0;border:0;background:#0d1117}
.python-app__poster{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7rem;padding:1rem;text-align:center;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
.python-app__poster b{font-size:1rem;overflow-wrap:anywhere}
.python-app__poster span{color:#8b949e;font-size:.85rem}
.python-app__poster button{min-height:2.75rem;padding:0 1.4rem;border:0;border-radius:999px;background:#2ea043;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.python-app__poster button:hover{background:#3fb950}
.python-app__poster button:focus-visible{outline:2px solid #58a6ff;outline-offset:2px}
@media (max-width:640px){figure.python-app,figure.python-app.align-left,figure.python-app.align-right{float:none;width:100%!important;margin:1.5em 0}}
@media print{figure.python-app{height:auto!important}figure.python-app>iframe,.python-app__poster{display:none}figure.python-app>pre[hidden]{display:block;white-space:pre-wrap}}`;

export const PYAPP_PUBLIC_JS = `(function(){
  var figs=document.querySelectorAll('figure.python-app');
  if(!figs.length)return;
  var RUNNER=${JSON.stringify(PYAPP_RUNNER_PATH)};
  Array.prototype.forEach.call(figs,function(fig){
    var pre=fig.querySelector('pre');
    if(!pre||fig.dataset.pyapp)return;
    fig.dataset.pyapp='1';
    var code=pre.textContent||'';
    if(!code.trim())return;
    var name=fig.getAttribute('title')||'app.py';
    fig.removeAttribute('title');
    // A strict Content-Security-Policy drops style attributes; the size the
    // editor saved is re-applied through the DOM, which the policy allows.
    var saved=fig.getAttribute('style')||'';
    var w=saved.match(/(?:^|;)\\s*width\\s*:\\s*(\\d{1,3}(?:\\.\\d+)?)%/i),h=saved.match(/(?:^|;)\\s*height\\s*:\\s*(\\d{2,4})px/i);
    if(w)fig.style.width=Math.max(20,Math.min(100,parseFloat(w[1])))+'%';
    if(h)fig.style.height=Math.max(160,Math.min(1600,parseInt(h[1],10)))+'px';
    var started=false;
    function start(){
      if(started)return;
      started=true;
      var poster=fig.querySelector('.python-app__poster');
      if(poster)poster.remove();
      pre.hidden=true;
      var frame=document.createElement('iframe');
      frame.setAttribute('sandbox','allow-scripts');
      frame.setAttribute('title','Python app: '+name);
      frame.setAttribute('referrerpolicy','no-referrer');
      window.addEventListener('message',function(e){
        if(e.source!==frame.contentWindow)return;
        var m=e.data||{};
        if(m.ams==='pyapp'&&m.t==='ready')frame.contentWindow.postMessage({ams:'pyapp',t:'code',code:code,name:name},'*');
      });
      frame.src=RUNNER;
      fig.appendChild(frame);
    }
    if(fig.classList.contains('python-app--manual')){
      pre.hidden=true;
      var poster=document.createElement('div');
      poster.className='python-app__poster';
      var title=document.createElement('b');title.textContent=name;
      var note=document.createElement('span');note.textContent='Python app · runs in your browser';
      var button=document.createElement('button');button.type='button';button.textContent='\\u25B6 Run';
      button.addEventListener('click',start);
      poster.appendChild(title);poster.appendChild(note);poster.appendChild(button);
      fig.appendChild(poster);
    }else if('IntersectionObserver' in window){
      // Python is a large download: fetch it when the app is about to be seen.
      var seen=new IntersectionObserver(function(entries){
        if(entries.some(function(entry){return entry.isIntersecting})){seen.disconnect();start()}
      },{rootMargin:'300px'});
      seen.observe(fig);
    }else start();
  });
})();`;

const HAS_PYAPP = /<figure\b[^>]*\bclass="[^"]*\bpython-app\b/i;

/** True when rendered HTML carries at least one Python app block. */
export const hasPythonApp = (html: string): boolean => HAS_PYAPP.test(html);

/**
 * Adds the block's stylesheet and loader to a rendered page that uses it.
 * Pages without a Python app are returned untouched, so they pay nothing.
 */
export function withPythonApps(html: string, nonce: string): string {
  if (!hasPythonApp(html)) return html;
  const attr = nonce ? ` nonce="${nonce}"` : '';
  const style = `<style${attr}>${PYAPP_PUBLIC_CSS}</style>`;
  const script = `<script${attr}>${PYAPP_PUBLIC_JS}</script>`;
  const withStyle = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${style}</head>`) : style + html;
  return /<\/body>/i.test(withStyle) ? withStyle.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${script}</body>`) : withStyle + script;
}
