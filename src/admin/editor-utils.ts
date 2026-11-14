/**
 * Pure helpers for the content editor, shipped as one small <script> and
 * published on `window.amsEditorUtils`.
 *
 * Everything here is a function of its arguments: no DOM, no selection, no
 * network. That is deliberate on two counts. The editor script is a string
 * inside a route file, so the parts worth testing would otherwise be reachable
 * only through a real browser; and the two places that must agree about links
 * and image figures are the browser and the server's sanitizer, which keeps
 * links and figure styles only in the shapes these helpers emit.
 *
 *   imageFigure({url, alt, caption, width, align, link, linkNewTab})
 *   linkAttrs(url, newTab) / linkMarkup({url, text, newTab})
 *   safeHref(url)          - the same allow-list rule as src/lib/security.ts
 *   slugify(title)         - the same rule as the server, so a slug typed here
 *                            is the slug that is stored
 *   wordCount(html)        - { words, chars } for the live counter
 *   readingMinutes(words)
 *   youtubeId(url) / hasRawBlock(html)
 *   pythonFigure({code, name, width, height, align, manual})
 *                          - an embedded Python app, in the one shape the
 *                            sanitizer keeps and the public page runs
 *   pythonWarnings(code)   - what cannot work in a browser, said before saving
 *
 * The tests run this exact string in a VM (tests/editor.test.mjs).
 */
export const EDITOR_UTILS_JS = `<script>
(function(){
  'use strict';
  function esc(value){
    return String(value==null?'':value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // The server silently drops a href it does not like; refusing it here means
  // the writer is told now instead of discovering a dead link after saving.
  function safeHref(value){
    var raw=String(value==null?'':value);
    var v=raw.replace(/[\\u0000-\\u0020\\u007f]/g,'');
    if(/^(https?:\\/\\/|mailto:|tel:|\\/|#|\\?)/i.test(v))return raw.trim();
    if(/^[\\w\\-.~%/]+([?#].*)?$/.test(v))return raw.trim();
    return '';
  }

  function slugify(input){
    return String(input==null?'':input)
      .normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'-')
      .replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'');
  }

  function hasRawBlock(src){
    return /^\\s*(?:<!--[\\s\\S]*?-->\\s*)*(?:<style[\\s>]|<script[\\s>])/i.test(src||'');
  }

  function youtubeId(value){
    try{
      var url=new URL(value),host=url.hostname.toLowerCase().replace(/^(www|m)\\./,''),id='';
      if(url.protocol!=='https:'&&url.protocol!=='http:')return '';
      if(host==='youtu.be')id=url.pathname.split('/')[1];
      else if(host==='youtube.com'||host==='youtube-nocookie.com'){
        if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
        else{var parts=url.pathname.split('/');if(['embed','shorts','live'].indexOf(parts[1])!==-1)id=parts[2]}
      }else return '';
      return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:'';
    }catch(e){return ''}
  }

  // Writing stats: what a reader sees, not the markup. Blocks that are never
  // read (style/script) are dropped before tags, then entities are decoded so
  // "a &amp; b" counts as three words rather than five.
  function plainText(html){
    return String(html==null?'':html)
      .replace(/<(script|style)\\b[\\s\\S]*?<\\/\\1\\s*>/gi,' ')
      .replace(/<!--[\\s\\S]*?-->/g,' ')
      .replace(/<[^>]*>/g,' ')
      .replace(/&nbsp;|&#160;/gi,' ')
      .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
      .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
      .replace(/\\s+/g,' ');
  }
  function wordCount(html){
    var text=plainText(html).trim();
    // A token with no letter, digit or ampersand is punctuation left over from
    // a tag boundary ("three</strong>." must not become two words).
    var words=text?text.split(' ').filter(function(word){return /[\\p{L}\\p{N}&]/u.test(word)}).length:0;
    return { words: words, chars: text.length, text: text };
  }
  function readingMinutes(words){
    return Math.max(1,Math.ceil((Number(words)||0)/220));
  }

  function clampWidth(pct){
    var n=Math.round(Number(pct)||0);
    if(!n)return 50;
    return Math.max(10,Math.min(100,n));
  }

  // A link's attributes, without the tag: the editor wraps a selection with
  // these and the image figure uses the same rule for its own link.
  function linkAttrs(url,newTab){
    var href=safeHref(url);
    if(!href)return '';
    var internal=/^(mailto:|tel:|#)/i.test(href);
    return ' href="'+esc(href)+'"'+(newTab&&!internal?' target="_blank" rel="noopener noreferrer"':'');
  }
  function linkMarkup(opts){
    var o=opts||{};
    var attrs=linkAttrs(o.url,o.newTab===true);
    if(!attrs)return '';
    var text=String(o.text==null?'':o.text).trim()||safeHref(o.url);
    return '<a'+attrs+'>'+esc(text)+'</a>';
  }

  /**
   * One image, placed the way the editor's bar says: a figure at a percentage
   * width, centred by default, with an optional caption and an optional link.
   * The width lives in style and the alignment in a class because that is
   * exactly what the server's sanitizer keeps (safeStyle + safe classes), so
   * the published page cannot drift from what the writer saw.
   */
  function imageFigure(opts){
    var o=opts||{};
    var src=String(o.url==null?'':o.url).trim();
    if(!/^(https?:\\/\\/|\\/)/i.test(src))return '';
    if(src.indexOf('"')!==-1||src.indexOf('<')!==-1||src.indexOf('>')!==-1)return '';
    var align=['left','center','right'].indexOf(o.align)>=0?o.align:'center';
    var width=clampWidth(o.width);
    var alt=String(o.alt==null?'':o.alt);
    var caption=String(o.caption==null?'':o.caption).trim();
    var inner='<img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy">';
    if(caption)inner+='<figcaption>'+esc(caption)+'</figcaption>';
    var attrs=o.link?linkAttrs(o.link,o.linkNewTab===true):'';
    if(attrs)inner='<a'+attrs+'>'+inner+'</a>';
    return '<figure class="image-block align-'+align+'" style="width:'+width+'%">'+inner+'</figure>';
  }

  function clampHeight(px){
    var n=Math.round(Number(px)||0);
    if(!n)return 420;
    return Math.max(160,Math.min(1200,n));
  }
  function pythonName(name){
    var n=String(name==null?'':name).replace(/^.*[\\\\/]/,'').replace(/[^A-Za-z0-9._ -]/g,'').trim().slice(0,80);
    if(!n||n.charAt(0)==='.')n='app.py';
    if(!/\\.pyw?$/i.test(n))n+='.py';
    return n;
  }

  /**
   * A Python app block. The source travels as escaped text inside
   * <pre><code>, so it is inert markup everywhere (the editor, a feed, a page
   * with scripts off) until the public page hands it to the sandboxed runner.
   * Width is a percentage and height is pixels: the two style declarations the
   * sanitizer keeps on a figure.
   */
  function pythonFigure(opts){
    var o=opts||{};
    var code=String(o.code==null?'':o.code).replace(/\\r\\n?/g,'\\n').replace(/\\u0000/g,'');
    if(!code.trim())return '';
    var align=['left','center','right'].indexOf(o.align)>=0?o.align:'center';
    var width=Math.max(30,clampWidth(o.width==null?100:o.width));
    return '<figure class="python-app align-'+align+(o.manual?' python-app--manual':'')+'" style="width:'+width+'%;height:'+clampHeight(o.height)+'px" title="'+esc(pythonName(o.name))+'"><pre><code>'+esc(code)+'</code></pre></figure>';
  }

  // Pyodide runs CPython in the page. What needs a desktop, a server or
  // another process cannot work there; say so while the writer can still act.
  var PY_LIMITS=[
    [/^[ \\t]*(?:import|from)[ \\t]+(tkinter|customtkinter|turtle|pygame|PyQt[456]|PySide[26]|kivy|wx|curses)\\b/m,'opens a desktop window, which a web page cannot show. Only programs that print and ask with input() run here.'],
    [/^[ \\t]*(?:import|from)[ \\t]+(flask|django|fastapi|uvicorn|streamlit|gradio|socket|socketserver|bottle|aiohttp)\\b/m,'needs a server or a network socket. A browser page cannot host one.'],
    [/^[ \\t]*(?:import|from)[ \\t]+(subprocess|multiprocessing|threading)\\b/m,'starts threads or other programs, which are not available in the browser.'],
  ];
  function pythonWarnings(code){
    var text=String(code==null?'':code),out=[];
    PY_LIMITS.forEach(function(rule){
      var hit=text.match(rule[0]);
      if(hit)out.push('"'+hit[1]+'" '+rule[1]);
    });
    return out;
  }

  window.amsEditorUtils={
    clampHeight: clampHeight, pythonName: pythonName, pythonFigure: pythonFigure, pythonWarnings: pythonWarnings,
    esc: esc, safeHref: safeHref, slugify: slugify, hasRawBlock: hasRawBlock,
    youtubeId: youtubeId, wordCount: wordCount, readingMinutes: readingMinutes,
    plainText: plainText, clampWidth: clampWidth,
    linkAttrs: linkAttrs, linkMarkup: linkMarkup, imageFigure: imageFigure,
  };
})();
</script>`;
