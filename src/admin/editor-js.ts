export const EDITOR_JS = `<script>
(function(){
  var form=document.getElementById('edit');
  if(!form)return;
  var U=window.amsEditorUtils||{};
  var ta=document.getElementById('body'),visual=document.getElementById('visual-editor');
  var box=document.getElementById('content-editor');
  var toolbar=document.getElementById('editor-toolbar'),status=document.getElementById('editor-status');
  var modeSwitch=document.getElementById('editor-mode-switch');
  var modeDialog=document.getElementById('editor-mode-dialog');
  var statsEl=document.getElementById('editor-stats');
  var SKIN_KEY='cms-editor-skin';
  var isNew=form.dataset.isNew==='1';
  var initial=form.dataset.initialSkin==='classic'?'classic':'modern';
  var preferred=(form.dataset.preferredSkin==='classic'||form.dataset.preferredSkin==='modern')?form.dataset.preferredSkin:'';
  var skin=initial,mode='html',savedRange=null;

  function esc(s){return (U.esc||function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')})(s)}

  // Content that starts with a <style>/<script> block is source, not markup:
  // loading it into a contenteditable would run or hide it, so it stays in HTML.
  function hasRawBlock(src){return U.hasRawBlock?U.hasRawBlock(src):/^\\s*(?:<!--[\\s\\S]*?-->\\s*)*(?:<style[\\s>]|<script[\\s>])/i.test(src||'')}

  /* ------------------------------------------------------- selection */
  function rememberSelection(){
    var sel=window.getSelection();
    if(sel&&sel.rangeCount&&visual.contains(sel.anchorNode))savedRange=sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection(){
    var sel=window.getSelection(),range=savedRange;
    if(!range||!visual.contains(range.commonAncestorContainer)){
      range=document.createRange();range.selectNodeContents(visual);range.collapse(false);
    }
    sel.removeAllRanges();sel.addRange(range);
  }
  function hasSelection(){
    var sel=window.getSelection();
    return !!(sel&&sel.rangeCount&&!sel.getRangeAt(0).collapsed&&visual.contains(sel.anchorNode));
  }
  function caretOffset(){
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return 0;
    var range=sel.getRangeAt(0),probe=range.cloneRange();
    if(!visual.contains(range.commonAncestorContainer))return 0;
    probe.selectNodeContents(visual);
    probe.setEnd(range.startContainer,range.startOffset);
    return probe.toString().length;
  }
  function placeCaretAt(offset){
    var walker=document.createTreeWalker(visual,NodeFilter.SHOW_TEXT,null,false);
    var node,seen=0,last=null;
    while((node=walker.nextNode())){
      var len=node.nodeValue.length;
      if(seen+len>=offset){
        var range=document.createRange();
        range.setStart(node,Math.max(0,Math.min(len,offset-seen)));
        range.collapse(true);
        var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
        savedRange=range.cloneRange();
        return;
      }
      seen+=len;last=node;
    }
    var end=document.createRange();
    if(last)end.setStart(last,last.nodeValue.length);else end.selectNodeContents(visual);
    end.collapse(false);
    var s=window.getSelection();s.removeAllRanges();s.addRange(end);
    savedRange=end.cloneRange();
  }

  /* ------------------------------------------------------------ modes */
  function syncMode(){
    if(box)box.classList.toggle('is-html',mode==='html');
    if(status&&!status.dataset.locked){
      status.textContent=mode==='html'
        ?'Editing HTML source. The Text tab shows the same content visually.'
        :'Editing text. The HTML tab shows the same content as source.';
    }
    if(modeSwitch){
      modeSwitch.querySelectorAll('[data-editor-mode]').forEach(function(btn){
        btn.setAttribute('aria-pressed',String(btn.dataset.editorMode===mode));
      });
    }
    if(visual)visual.setAttribute('aria-hidden',mode==='html'?'true':'false');
    if(ta)ta.setAttribute('aria-hidden',mode==='text'?'true':'false');
    syncStats();
  }
  function note(text){
    if(!status)return;
    status.dataset.locked='1';
    status.textContent=text;
    setTimeout(function(){delete status.dataset.locked;syncMode()},4000);
  }

  // Editor-only state (the selected-image outline) must never be saved.
  function serializeVisual(){
    var clone=visual.cloneNode(true);
    clone.querySelectorAll('.is-selected').forEach(function(el){el.classList.remove('is-selected')});
    clone.querySelectorAll('img[draggable]').forEach(function(el){el.removeAttribute('draggable')});
    return clone.innerHTML;
  }

  /**
   * Tidying pass for a visual-editor document: the browser writes a <div> for
   * every Enter and leaves stray empty blocks behind, which the themes style
   * as gaps. It only ever removes what is empty and unwraps what is redundant,
   * never touching text, so it cannot lose writing.
   */

  /**
   * Turns the browser's line containers into real paragraphs. Only the
   * innermost <div>s that hold nothing but inline content are converted, so a
   * custom block, a widget wrapper or a nested layout is never touched.
   */
  /** The html itself when it is one element and nothing else around it. */
  function singleEl(html){
    if(html.charAt(0)!=='<')return '';
    var tag=(html.match(/^<([a-zA-Z][0-9a-zA-Z_-]*)/)||[])[1];
    if(!tag)return '';
    var close='</'+tag.toLowerCase()+'>';
    return html.slice(-close.length).toLowerCase()===close?html:'';
  }

  function paragraphs(html){
    // Only convert attribute-free, innermost browser-generated divs. Custom
    // wrappers and divs with formatting or multiple blocks must remain intact.
    var BLOCK=/<(?:div|p|h[1-6]|ul|ol|li|blockquote|pre|figure|table|hr|iframe|section|article)(?:[ >])/i;
    return String(html||'').replace(/<div>([^]*?)<\\/div>/gi,function(match,inner){
      if(/^<p(?: [^>]*)?>[^<]*<\\/p>$/i.test(inner))return inner;
      if(/^<h[1-6](?: [^>]*)?>[^<]*<\\/h[1-6]>$/i.test(inner))return inner;
      if(BLOCK.test(inner))return match;
      return '<p>'+inner+'</p>';
    });
  }

  function tidyHtml(html){
    var out=paragraphs(String(html||''));
    // Empty leftovers the browser leaves behind: <p></p>, <p>&nbsp;</p>,
    // <div></div>, <span> </span>. Only truly empty elements are removed.
    var EMPTY=/<(p|div|span|strong|b|em|i|u|s|blockquote)(?:[^>]*)>(?:\\s|&nbsp;|<br\\s*\\/?>)*<\\/\\1>/gi;
    // Structural elements may legitimately be empty (an empty table cell, a
    // list item waiting for text); everything else that is empty is a leftover.
    var STRUCTURAL=/^(img|br|hr|figure|figcaption|iframe|table|tbody|thead|tfoot|tr|td|th|col|colgroup|ul|ol|li|pre|blockquote)$/i;
    // The tag name is matched with an explicit character set rather than \\w:
    // see the note on paragraphs() about backslashes in this template string.
    var PAIR=/<([a-zA-Z][0-9a-zA-Z_-]*)(?:[^>]*)>\\s*<\\/\\1>/g;
    for(var pass=0;pass<6;pass++){
      var before=out;
      out=out.replace(EMPTY,'').replace(PAIR,function(match,tagName){
        return STRUCTURAL.test(tagName)?match:'';
      });
      if(out===before)break;
    }
    return out;
  }


  // Both panes hold the same document at all times: the textarea is the
  // source of truth for HTML, the contenteditable mirrors it when visible.
  function toText(){
    var caret=caretOffset();
    visual.innerHTML=ta.value;
    mode='text';
    ta.hidden=true;visual.hidden=false;
    syncMode();
    visual.focus();
    placeCaretAt(caret);
    visual.scrollTop=ta.scrollTop;
  }
  function toHtml(){
    ta.value=tidyHtml(serializeVisual());
    clearImageSelection();
    mode='html';
    visual.hidden=true;ta.hidden=false;
    syncMode();
    ta.focus();
    var end=ta.value.length;
    ta.setSelectionRange(end,end);
  }
  function setMode(next,focusIt){
    if(next!=='text'&&next!=='html')return;
    if(next===mode){
      syncMode();
      if(focusIt){if(mode==='text')visual.focus();else ta.focus()}
      return;
    }
    if(next==='text'&&hasRawBlock(ta.value)){
      toHtml();
      note('This content starts with a <style> or <script> block, so it stays in HTML mode.');
      return;
    }
    if(next==='text')toText();else toHtml();
  }

  if(modeSwitch){
    modeSwitch.querySelectorAll('[data-editor-mode]').forEach(function(btn){
      btn.addEventListener('click',function(){setMode(btn.dataset.editorMode,true)});
    });
  }

  /* ------------------------------------------------------------ toolbar */
  function insertSnippet(snippet){
    if(mode==='html'){
      var start=ta.selectionStart==null?ta.value.length:ta.selectionStart;
      var end=ta.selectionEnd==null?start:ta.selectionEnd;
      ta.value=ta.value.slice(0,start)+snippet+ta.value.slice(end);
      ta.focus();
      var at=start+snippet.length;
      ta.setSelectionRange(at,at);
    }else{
      // The toolbar button (or the media dialog) took focus; put it back on the
      // writing surface first, otherwise execCommand has no editable element.
      visual.focus();
      restoreSelection();
      document.execCommand('insertHTML',false,snippet);
      rememberSelection();
    }
    if(typeof markDirty==='function')markDirty();
    syncStats();
  }
  if(toolbar){
    toolbar.querySelectorAll('[data-wrap]').forEach(function(btn){
      btn.addEventListener('mousedown',function(e){if(mode==='text')e.preventDefault()});
      btn.addEventListener('click',function(){
        if(mode==='text')rememberSelection();
        var parts=btn.getAttribute('data-wrap').split('|'),open=parts[0],close=parts[1]||'';
        if(btn.dataset.ask){
          var value=prompt(btn.dataset.ask,btn.dataset.def||'');
          if(!value)return;
          open=open.replace('$1',esc(value));
        }
        if(mode==='text'){
          restoreSelection();
          if(btn.dataset.command){document.execCommand(btn.dataset.command,false,btn.dataset.value||null)}
          else{
            var sel=window.getSelection(),selected='';
            if(sel&&sel.rangeCount){var holder=document.createElement('div');holder.appendChild(sel.getRangeAt(0).cloneContents());selected=holder.innerHTML}
            document.execCommand('insertHTML',false,open+selected+close);
          }
          rememberSelection();
        }else{
          var start=ta.selectionStart==null?ta.value.length:ta.selectionStart;
          var end=ta.selectionEnd==null?start:ta.selectionEnd;
          ta.value=ta.value.slice(0,start)+open+ta.value.slice(start,end)+close+ta.value.slice(end);
          ta.focus();
          ta.setSelectionRange(start+open.length,end+open.length);
        }
        if(typeof markDirty==='function')markDirty();
        syncStats();
      });
    });
  }
  visual.addEventListener('keyup',rememberSelection);
  visual.addEventListener('mouseup',rememberSelection);

  /**
   * Paste always arrives as plain text: clipboard HTML from Word, a browser or
   * a chat window carries fonts, colours and layout that the sanitizer would
   * have to throw away anyway (and an admin's raw HTML would keep, breaking the
   * theme). Shift+Ctrl+V is the explicit escape hatch for markup.
   */
  visual.addEventListener('paste',function(e){
    if(mode!=='text'||e.shiftKey)return;
    e.preventDefault();
    var data=e.clipboardData||window.clipboardData;
    var html=data.getData?data.getData('text/html')||'':'';
    var text=data.getData?data.getData('text/plain')||'':'';
    if(!html&&!text)return;
    // A clipboard that is nothing but an image URL becomes an image block,
    // which is what a writer pasting a screenshot link expects.
    var onlyUrl=text.trim();
    if(!html&&/^https?:\\/\\/[^\\s]+$/.test(onlyUrl)&&/\\.(png|jpe?g|gif|webp|avif|svg)(\\?|#|$)/i.test(onlyUrl)&&U.imageFigure){
      insertImageAtCaret(U.imageFigure({url:onlyUrl,alt:'',width:50}));
    }else{
      document.execCommand('insertText',false,text.replace(/\\r\\n/g,'\\n'));
    }
    if(typeof markDirty==='function')markDirty();
    syncStats();
  });

  /* ---------------------------------------------------------- shortcuts */
  // The formatting bar, reachable without leaving the keyboard. Ctrl/Cmd+K is
  // the panel's command palette and Ctrl/Cmd+L is the browser's address bar,
  // so a link is Ctrl/Cmd+Shift+K, and only while the writing surface has focus.
  var SHORTCUTS={'b':'bold','i':'italic','u':'underline'};
  function shortcut(e){
    if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
    var key=String(e.key||'').toLowerCase();
    if(key==='s'){e.preventDefault();saveNow();return}
    if(mode!=='text')return;
    if(SHORTCUTS[key]){e.preventDefault();document.execCommand(SHORTCUTS[key]);rememberSelection();syncStats();return}
    if(key==='k'&&e.shiftKey){e.preventDefault();openLinkDialog();return}
  }
  visual.addEventListener('keydown',shortcut);
  if(ta)ta.addEventListener('keydown',function(e){
    // Ctrl+S in the source pane saves too; the browser's own save dialog is
    // never what someone editing a post wants.
    if((e.ctrlKey||e.metaKey)&&!e.altKey&&String(e.key||'').toLowerCase()==='s'){e.preventDefault();saveNow()}
  });

  /* ------------------------------------------- images pasted or dropped */
  // A screenshot on the clipboard or a photo dragged from the desktop goes
  // through the same browser-side compression and the same picker upload as a
  // file chosen in the dialog, then lands where the cursor is. Nothing is ever
  // inserted until it is really stored, so a failed upload cannot leave a
  // broken <img> in the post.
  var imageDropHint=document.getElementById('image-drop-hint');
  function uploadFiles(files, where){
    files=Array.prototype.slice.call(files||[]).filter(function(file){
      return file&&(!file.type||file.type.indexOf('image/')===0)&&file.size;
    });
    if(!files.length)return;
    var action=form.dataset.pickerUpload||'';
    if(!action){note('Upload is not available here. Use Media in the toolbar.');return}
    if(where==='visual')rememberSelection();
    var caret=caretOffset();
    var say2=note;
    say2(files.length===1?'Uploading your image…':'Uploading '+files.length+' images…');
    var preparing=window.amsCompressImages
      ?window.amsCompressImages(files,{quality:0.7})
      :Promise.resolve(files.map(function(file){return {file:file,failed:false}}));
    preparing.then(function(prepared){
      var usable=prepared.filter(function(row){return !row.failed&&row.file});
      if(!usable.length){say2('That image could not be read by this browser.');return}
      var body=new FormData();
      body.set('_csrf',csrf);
      usable.forEach(function(row){body.append('files',row.file,row.file.name)});
      return fetch(action,{method:'POST',body:body,credentials:'same-origin'})
        .then(function(res){return res.json().catch(function(){return {}})})
        .then(function(data){
          if(!data||!data.ok||!(data.items&&data.items.length)){
            say2((data&&data.error)||'The upload failed. Try the Media button instead.');
            return;
          }
          // The caret may have moved while the upload ran: put it back where the
          // picture was asked for, then insert each image as a block.
          if(where==='visual'){
            visual.focus();
            if(caret>=0)placeCaretAt(caret);
          }
          data.items.forEach(function(item){
            insertPickedImage({id:item.id,url:item.url,alt:item.alt||''},{alt:item.alt||''});
          });
          say2(data.items.length===1?'Image added.':'Images added.');
        });
    }).catch(function(){say2('The upload failed. Try the Media button instead.')});
  }
  if(visual){
    visual.addEventListener('paste',function(e){
      var data=e.clipboardData;
      if(!data||!data.files||!data.files.length)return;
      e.preventDefault();
      uploadFiles(data.files,'visual');
    });
    ['dragenter','dragover'].forEach(function(type){
      visual.addEventListener(type,function(e){
        if(!e.dataTransfer||!e.dataTransfer.types||String(e.dataTransfer.types).indexOf('Files')===-1)return;
        e.preventDefault();
        if(imageDropHint)imageDropHint.hidden=false;
        visual.classList.add('is-dropping');
      });
    });
    ['dragleave','dragend'].forEach(function(type){
      visual.addEventListener(type,function(){
        if(imageDropHint)imageDropHint.hidden=true;
        visual.classList.remove('is-dropping');
      });
    });
    visual.addEventListener('drop',function(e){
      if(!e.dataTransfer||!e.dataTransfer.files||!e.dataTransfer.files.length)return;
      e.preventDefault();
      if(imageDropHint)imageDropHint.hidden=true;
      visual.classList.remove('is-dropping');
      uploadFiles(e.dataTransfer.files,'visual');
    });
  }

  /* ---------------------------------------------------------- dialogs */
  var htmlDialog=document.getElementById('html-block-dialog'),youtubeDialog=document.getElementById('youtube-dialog');
  var linkDialog=document.getElementById('link-dialog'),imageDialog=document.getElementById('image-block-dialog');
  function openDialog(dialog,focus){
    rememberSelection();
    if(!dialog)return;
    dialog.showModal();
    setTimeout(function(){if(focus)focus.focus()},0);
  }
  document.querySelectorAll('[data-close-dialog]').forEach(function(btn){
    btn.addEventListener('click',function(){var d=btn.closest('dialog');if(d)d.close()});
  });
  if(htmlDialog){
    document.getElementById('add-html-block').addEventListener('click',function(){openDialog(htmlDialog,document.getElementById('html-block-input'))});
    document.getElementById('insert-html-block').addEventListener('click',function(){
      var input=document.getElementById('html-block-input'),code=input.value.trim();
      if(!code){input.focus();return}
      insertSnippet('<div class="html-block">\\n'+code+'\\n</div>');
      input.value='';htmlDialog.close();
    });
  }
  function youtubeId(value){return U.youtubeId?U.youtubeId(value):''}
  if(youtubeDialog){
    document.getElementById('add-youtube').addEventListener('click',function(){
      document.getElementById('youtube-error').hidden=true;
      openDialog(youtubeDialog,document.getElementById('youtube-url'));
    });
    document.getElementById('insert-youtube').addEventListener('click',function(){
      var input=document.getElementById('youtube-url'),id=youtubeId(input.value.trim()),error=document.getElementById('youtube-error');
      if(!id){error.hidden=false;input.focus();return}
      var title=document.getElementById('youtube-title').value.trim()||'YouTube video player';
      var embed='<figure class="video-block youtube-video"><div class="video-responsive"><iframe src="https://www.youtube-nocookie.com/embed/'+id+'" title="'+esc(title)+'" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div></figure>';
      insertSnippet(embed);
      input.value='';document.getElementById('youtube-title').value='';youtubeDialog.close();
    });
  }

  /* ------------------------------------------------------------- links */
  // One dialog for a new link and for editing the link under the cursor: the
  // writer sees the URL and the words, which prompt() could never show.
  var linkTarget=null;
  function closestLink(node){
    while(node&&node!==visual){
      if(node.nodeType===1&&node.tagName==='A')return node;
      node=node.parentNode;
    }
    return null;
  }
  function openLinkDialog(){
    if(!linkDialog)return;
    var error=document.getElementById('link-error');
    if(error)error.hidden=true;
    linkTarget=mode==='text'?closestLink(window.getSelection()&&window.getSelection().anchorNode):null;
    var urlField=document.getElementById('link-url'),textField=document.getElementById('link-text'),title=document.getElementById('link-dialog-title');
    var newTab=document.getElementById('link-newtab'),remove=document.getElementById('link-remove');
    var selected='';
    if(mode==='text'&&hasSelection()){
      var holder=document.createElement('div');holder.appendChild(window.getSelection().getRangeAt(0).cloneContents());
      selected=(holder.textContent||'').trim();
    }
    if(linkTarget){
      urlField.value=linkTarget.getAttribute('href')||'';
      textField.value=(linkTarget.textContent||'').trim()||selected;
      newTab.checked=linkTarget.getAttribute('target')==='_blank';
      remove.hidden=false;
      if(title)title.textContent='Edit link';
    }else{
      urlField.value='';
      textField.value=selected;
      newTab.checked=false;
      remove.hidden=true;
      if(title)title.textContent='Add link';
    }
    openDialog(linkDialog,urlField);
  }
  document.querySelectorAll('[data-link-open]').forEach(function(btn){btn.addEventListener('click',openLinkDialog)});
  if(linkDialog){
    document.getElementById('insert-link').addEventListener('click',function(){
      var urlField=document.getElementById('link-url'),textField=document.getElementById('link-text');
      var error=document.getElementById('link-error'),url=urlField.value.trim(),text=textField.value.trim();
      if(U.safeHref&&!U.safeHref(url)){
        error.textContent='Enter a web address (https://…), a mailto: or a page on this site (/about).';
        error.hidden=false;urlField.focus();return;
      }
      if(!U.safeHref&&!/^(https?:\\/\\/|mailto:|tel:|\\/|#|\\?)/i.test(url)){
        error.textContent='Enter a web address (https://…), a mailto: or a page on this site (/about).';
        error.hidden=false;urlField.focus();return;
      }
      var newTab=document.getElementById('link-newtab').checked;
      var attrs=U.linkAttrs?U.linkAttrs(url,newTab):' href="'+esc(url)+'"'+(newTab?' target="_blank" rel="noopener noreferrer"':'');
      if(mode==='text'){
        restoreSelection();
        if(linkTarget){
          linkTarget.setAttribute('href',url);
          if(newTab)linkTarget.setAttribute('target','_blank');else linkTarget.removeAttribute('target');
          if(newTab)linkTarget.setAttribute('rel','noopener noreferrer');else linkTarget.removeAttribute('rel');
          if(text&&(linkTarget.textContent||'').trim()!==text)linkTarget.textContent=text;
        }else{
          var sel=window.getSelection(),picked='';
          if(sel&&sel.rangeCount&&!sel.getRangeAt(0).collapsed){
            var holder=document.createElement('div');holder.appendChild(sel.getRangeAt(0).cloneContents());picked=holder.innerHTML;
          }
          document.execCommand('insertHTML',false,'<a'+attrs+'>'+(text?esc(text):picked||esc(url))+'</a>');
        }
        rememberSelection();
      }else{
        var start=ta.selectionStart==null?ta.value.length:ta.selectionStart;
        var end=ta.selectionEnd==null?start:ta.selectionEnd;
        var label=text||ta.value.slice(start,end)||url;
        ta.value=ta.value.slice(0,start)+'<a'+attrs+'>'+label+'</a>'+ta.value.slice(end);
        ta.focus();
        var at=start+('<a'+attrs+'>'+label+'</a>').length;
        ta.setSelectionRange(at,at);
      }
      linkDialog.close();
      if(typeof markDirty==='function')markDirty();
      syncStats();
    });
    document.getElementById('link-remove').addEventListener('click',function(){
      if(!linkTarget){linkDialog.close();return}
      var link=linkTarget;
      linkTarget=null;
      link.replaceWith.apply(link,Array.prototype.slice.call(link.childNodes));
      linkDialog.close();
      if(typeof markDirty==='function')markDirty();
      syncStats();
    });
    linkDialog.addEventListener('close',function(){linkTarget=null});
  }

  /* ------------------------------------------------------------ images */
  // The Media button and the featured control open the same picker. A picked
  // image lands at 50% centred (never full-bleed), a caption and a link are
  // offered before it is placed, and the block is selected so its handles are
  // immediately usable.
  var pendingImage=null;
  function imageBlockDialog(item){
    if(!imageDialog){insertPickedImage(item,{});return}
    pendingImage=item;
    var preview=document.getElementById('image-block-preview');
    var alt=document.getElementById('image-block-alt'),caption=document.getElementById('image-block-caption');
    var link=document.getElementById('image-block-link'),width=document.getElementById('image-block-width');
    var out=document.getElementById('image-block-width-out'),error=document.getElementById('image-block-error');
    if(preview){
      preview.innerHTML=item.url?'<img src="'+esc(item.url)+'" alt="">':'';
    }
    alt.value=item.alt||'';
    caption.value='';
    link.value='';
    width.value='50';
    if(out)out.textContent='50%';
    if(error)error.hidden=true;
    openDialog(imageDialog,alt);
  }
  function insertImageAtCaret(html){
    if(!html)return;
    if(mode==='html'){
      if(hasRawBlock(ta.value)){insertSnippet(html+'<p></p>');return}
      // Map the source cursor to the visual text before changing panes.
      var at=ta.selectionStart==null?ta.value.length:ta.selectionStart;
      var atEnd=at===ta.value.length;
      var prefix=document.createElement('div');prefix.innerHTML=ta.value.slice(0,at);
      var offset=(prefix.textContent||'').length;
      toText();
      if(atEnd){
        var end=document.createRange();end.selectNodeContents(visual);end.collapse(false);
        var selection=window.getSelection();selection.removeAllRanges();selection.addRange(end);savedRange=end.cloneRange();
      }else placeCaretAt(offset);
    }
    visual.focus();restoreSelection();
    var sel=window.getSelection(),range=sel.getRangeAt(0);
    range.deleteContents();range.collapse(true);

    // Split the current top-level block at the caret. The figure must be a
    // sibling of paragraphs/headings, never their parent: browsers otherwise
    // sometimes pull existing text into the figure's centred, narrow box.
    var node=range.startContainer,top=node;
    while(top!==visual&&top.parentNode!==visual)top=top.parentNode;
    if(top!==visual&&top.nodeType===1){
      if(top.tagName==='FIGURE'){
        range.setStartAfter(top);range.collapse(true);
      }else{
        var tail=range.cloneRange();tail.setEndAfter(top);
        var after=tail.extractContents();
        range.setStartAfter(top);range.collapse(true);
        range.insertNode(after);
        range.setStartAfter(top);range.collapse(true);
      }
    }
    var holder=document.createElement('div');holder.innerHTML=html;
    var figure=holder.firstElementChild;
    if(!figure)return;
    var paragraph=document.createElement('p');paragraph.appendChild(document.createElement('br'));
    var fragment=document.createDocumentFragment();fragment.appendChild(figure);fragment.appendChild(paragraph);
    range.insertNode(fragment);
    range.setStart(paragraph,0);range.collapse(true);
    sel.removeAllRanges();sel.addRange(range);savedRange=range.cloneRange();
    if(typeof markDirty==='function')markDirty();
    syncStats();
  }
  function insertPickedImage(item,opts){
    var o=opts||{};
    var width=U.clampWidth?U.clampWidth(o.width):50;
    var html=U.imageFigure
      ?U.imageFigure({url:item.url,alt:o.alt!=null?o.alt:(item.alt||''),caption:o.caption,width:width,align:'center',link:o.link,linkNewTab:true})
      :'<figure class="image-block align-center" style="width:'+width+'%"><img src="'+esc(item.url)+'" alt="'+esc(o.alt!=null?o.alt:(item.alt||''))+'" loading="lazy">'+(o.caption?'<figcaption>'+esc(o.caption)+'</figcaption>':'')+'</figure>';
    if(!html)return;
    insertImageAtCaret(html);
    // Select the image just inserted so its size/align anchors are right there.
    setTimeout(function(){
      var figs=visual.querySelectorAll('figure.image-block img');
      for(var i=figs.length-1;i>=0;i--){if(figs[i].getAttribute('src')===item.url){selectImage(figs[i]);break}}
    },0);
  }
  if(imageDialog){
    var widthField=document.getElementById('image-block-width'),widthOut=document.getElementById('image-block-width-out');
    if(widthField)widthField.addEventListener('input',function(){if(widthOut)widthOut.textContent=widthField.value+'%'});
    document.getElementById('insert-image-block').addEventListener('click',function(){
      if(!pendingImage)return;
      var linkField=document.getElementById('image-block-link'),error=document.getElementById('image-block-error');
      var link=linkField.value.trim();
      if(link&&U.safeHref&&!U.safeHref(link)){
        error.textContent='The image link must be a web address (https://…), mailto: or a path on this site (/about).';
        error.hidden=false;linkField.focus();return;
      }
      var item=pendingImage;
      imageDialog.close();
      insertPickedImage(item,{
        alt:document.getElementById('image-block-alt').value,
        caption:document.getElementById('image-block-caption').value.trim(),
        link:link,
        width:Number(widthField.value)||50,
      });
      pendingImage=null;
    });
    imageDialog.addEventListener('close',function(){pendingImage=null});
  }

  /* ------------------------------------------------------- page break */
  // A rule a theme can print on: the marker is a plain <hr class="page-break">,
  // so it needs no style attribute (which the sanitizer would strip) and no
  // markup a non-admin cannot keep.
  var addBreak=document.getElementById('add-page-break');
  if(addBreak)addBreak.addEventListener('click',function(){insertSnippet('<hr class="page-break">\\n<p></p>')});

  ['youtube-url','youtube-title','html-block-input','link-url','link-text'].forEach(function(id){
    var el=document.getElementById(id);
    if(!el)return;
    el.addEventListener('keydown',function(e){
      if(e.key!=='Enter')return;
      if(id==='html-block-input'&&!(e.ctrlKey||e.metaKey))return;
      e.preventDefault();
      document.getElementById(id==='html-block-input'?'insert-html-block':id==='youtube-url'||id==='youtube-title'?'insert-youtube':'insert-link').click();
    });
  });

  /* ------------------------------------------------------------ skins */
  function applySkin(next){
    skin=next==='classic'?'classic':'modern';
    if(box){
      box.dataset.skin=skin;
      box.classList.toggle('is-classic',skin==='classic');
      box.classList.toggle('is-modern',skin==='modern');
    }
    document.querySelectorAll('[data-editor-skin-set]').forEach(function(btn){
      btn.setAttribute('aria-pressed',String(btn.dataset.editorSkinSet===skin));
    });
  }

  function useSkin(next){
    applySkin(next);
    try{localStorage.setItem(SKIN_KEY,skin)}catch(e){}
  }
  document.querySelectorAll('[data-editor-skin-set]').forEach(function(btn){
    btn.addEventListener('click',function(){
      useSkin(btn.dataset.editorSkinSet);
      note((skin==='classic'?'Classic':'Modern')+' editor. Remembered on this device.');
    });
  });

  /* ---------------------------------------- classic/modern chooser */
  // "Add New" asks which editor to use unless a preference is remembered.
  function startWriting(){if(mode==='text')visual.focus();else ta.focus()}
  if(modeDialog){
    modeDialog.querySelectorAll('[data-skin-choice]').forEach(function(btn){
      btn.addEventListener('click',function(){
        useSkin(btn.dataset.skinChoice);
        modeDialog.close();
        startWriting();
      });
    });
    modeDialog.addEventListener('cancel',function(){applySkin(initial)});
    var remembered=preferred;
    try{remembered=remembered||localStorage.getItem(SKIN_KEY)||''}catch(e){}
    if(remembered==='classic'||remembered==='modern')applySkin(remembered);
    else if(isNew)modeDialog.showModal();
  }

  /* ----------------------------------------------------------- submit */
  form.addEventListener('submit',function(){
    if(mode==='text')ta.value=tidyHtml(serializeVisual());
    // A real save supersedes any autosave: stop nagging on the way out.
    dirty=false;
    clearInterval(timer);
  });

  /* --------------------------------------------------------- autosave */
  // Autosave writes to the revision table, never to the live row: a crash or a
  // closed tab leaves a recoverable snapshot and the published page is untouched.
  var autosaveUrl=form.dataset.autosaveUrl||'',lockUrl=form.dataset.lockUrl||'';
  var csrf=form.dataset.csrf||'';
  var autosaveStatus=document.querySelector('[data-autosave-status]');
  var dirty=false,inflight=false,lastSaved=null,timer=null,unloadArmed=false;

  function currentBody(){return mode==='text'?tidyHtml(serializeVisual()):ta.value}
  /** What is on the writing surface right now, whichever pane is showing. */
  function liveHtml(){return mode==='text'?serializeVisual():ta.value}
  function markDirty(){
    dirty=true;
    if(!unloadArmed){
      unloadArmed=true;
      window.addEventListener('beforeunload',function(event){
        if(!dirty)return;
        event.preventDefault();
        event.returnValue='';
        return '';
      });
    }
  }
  /** Ctrl/Cmd+S: save the form the way the button would, not a browser dialog. */
  function saveNow(){
    if(typeof form.requestSubmit==='function'){form.requestSubmit()}else{form.submit()}
  }
  function ago(date){
    var secs=Math.max(0,Math.round((Date.now()-date.getTime())/1000));
    if(secs<5)return 'just now';
    if(secs<60)return secs+' s ago';
    var mins=Math.round(secs/60);
    return mins+(mins===1?' minute ago':' minutes ago');
  }
  function say(text){
    if(!autosaveStatus)return;
    autosaveStatus.textContent=text;
  }
  function autosave(){
    if(!autosaveUrl||!dirty||inflight)return;
    inflight=true;
    var body=new URLSearchParams();
    body.set('_csrf',csrf);
    body.set('title',(document.getElementById('title')||{}).value||'');
    var excerptEl=document.getElementById('excerpt');
    if(excerptEl)body.set('excerpt',excerptEl.value);
    body.set('body',currentBody());
    fetch(autosaveUrl,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()})
      .then(function(res){return res.json().then(function(data){return {ok:res.ok,data:data}})})
      .then(function(result){
        if(result.ok&&result.data.ok){
          dirty=false;lastSaved=new Date(result.data.at||Date.now());
          say(result.data.unchanged?'No new changes to save.':'Autosaved '+ago(lastSaved)+'.');
        }else if(result.data&&result.data.error==='needs-migration'){
          say('Autosave needs a database update: open Updates and run it.');
        }else{
          say('Autosave could not save this time. Your Save button still works.');
        }
      })
      .catch(function(){say('Autosave is offline. Your Save button still works.')})
      .then(function(){inflight=false});
  }
  if(autosaveUrl){
    timer=setInterval(autosave,30000);
    // Keep the "12 s ago" line honest between saves.
    setInterval(function(){if(lastSaved&&!dirty)say('Autosaved '+ago(lastSaved)+'.')},10000);
    ['input','keyup'].forEach(function(type){
      document.getElementById('edit').addEventListener(type,function(event){
        if(event.target.closest('#editor-toolbar'))return;
        markDirty();
      });
    });
    if(ta)ta.addEventListener('input',markDirty);
    if(visual)visual.addEventListener('input',markDirty);
  }

  /* ------------------------------------------------------- edit lock */
  if(lockUrl){
    // A heartbeat every 45 s keeps the row locked while this tab is open, and
    // tells us if somebody took it over in the meantime.
    setInterval(function(){
      var body=new URLSearchParams();body.set('_csrf',csrf);
      fetch(lockUrl,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()})
        .then(function(res){return res.json()})
        .then(function(data){
          if(data&&data.holder&&!document.querySelector('[data-lock-banner]')){
            var slot=document.getElementById('lock-slot');
            if(!slot)return;
            slot.innerHTML='<div class="notice warn lock-banner" role="status" data-lock-banner><div><b>'+esc(data.holder)+' is editing this content now.</b> Saving may overwrite their changes.</div></div>';
          }
        })
        .catch(function(){});
    },45000);
  }

  /* ------------------------------------------------------- media picker */
  var pickerUrl=form.dataset.pickerEndpoint||'',pickerUpload=form.dataset.pickerUpload||'';
  var picker=(window.amsMediaPicker&&pickerUrl)?window.amsMediaPicker({uploadUrl:pickerUpload}):null;
  var featuredPreview=document.querySelector('[data-featured-preview]');
  var featuredRemove=document.querySelector('[data-clear-featured]');
  function setFeatured(item){
    var input=document.getElementById('featured-id');
    if(input)input.value=item?String(item.id):'';
    if(featuredPreview){
      featuredPreview.innerHTML=item
        ?'<img src="'+esc(item.url)+'" alt="'+esc(item.alt||'')+'">'
        :'<span class="muted">No image chosen</span>';
    }
    if(featuredRemove)featuredRemove.hidden=!item;
  }
  document.querySelectorAll('[data-open-picker]').forEach(function(button){
    button.addEventListener('click',function(){
      if(!picker)return;
      picker.open({onPick:function(item){
        if(button.dataset.openPicker==='featured')setFeatured(item);
      }});
    });
  });
  if(featuredRemove)featuredRemove.addEventListener('click',function(){setFeatured(null)});
  // A featured image typed into the source (or pasted) still shows its picture.
  var imageButton=document.querySelector('[data-picker-image]');
  if(imageButton){
    imageButton.addEventListener('mousedown',function(){if(mode==='text')rememberSelection()});
    imageButton.addEventListener('click',function(){
      if(!picker)return;
      picker.open({onPick:imageBlockDialog});
    });
  }

  /* ------------------------------------------- image size & anchors */
  // Click an image in Text mode: it gets an outline, four corner anchors you
  // can drag, and a size/align bar. Width is stored as width:% on the figure
  // (or the bare <img>), alignment as align-left/center/right — both survive
  // saving (the sanitizer keeps exactly those) so the page matches the editor.
  var imageTools=document.getElementById('image-tools');
  var imgOverlay=document.getElementById('img-overlay');
  var imgWidth=document.getElementById('img-width'),imgWidthOut=document.getElementById('img-width-out');
  var selectedImg=null,selectedBlock=null;

  function imageBlockOf(img){var f=img.closest?img.closest('figure'):null;return f||img}
  function imageWidthPct(){
    if(!selectedBlock)return 50;
    var inline=parseFloat((selectedBlock.style&&selectedBlock.style.width)||'');
    if(inline)return Math.round(inline);
    var w=selectedImg.getBoundingClientRect().width,host=visual.clientWidth||1;
    return Math.max(10,Math.min(100,Math.round(w/host*100)));
  }
  function syncImageTools(){
    if(!imageTools||!selectedImg)return;
    var pct=imageWidthPct();
    if(imgWidth)imgWidth.value=String(pct);
    if(imgWidthOut)imgWidthOut.textContent=pct+'%';
    imageTools.querySelectorAll('[data-img-size]').forEach(function(b){b.setAttribute('aria-pressed',String(Number(b.dataset.imgSize)===pct))});
    var align=selectedBlock.classList.contains('align-left')?'left':selectedBlock.classList.contains('align-right')?'right':'center';
    imageTools.querySelectorAll('[data-img-align]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.imgAlign===align))});
  }
  function positionOverlay(){
    if(!imgOverlay||!selectedImg||mode!=='text'){if(imgOverlay)imgOverlay.hidden=true;return}
    var r=selectedImg.getBoundingClientRect(),b=box.getBoundingClientRect();
    imgOverlay.hidden=false;
    imgOverlay.style.left=(r.left-b.left)+'px';
    imgOverlay.style.top=(r.top-b.top)+'px';
    imgOverlay.style.width=r.width+'px';
    imgOverlay.style.height=r.height+'px';
  }
  function selectImage(img){
    clearImageSelection();
    selectedImg=img;selectedBlock=imageBlockOf(img);
    selectedBlock.classList.add('is-selected');
    if(selectedBlock===img)img.classList.add('is-selected');
    img.setAttribute('draggable','false');
    if(imageTools)imageTools.hidden=false;
    syncImageTools();positionOverlay();
  }
  function clearImageSelection(){
    if(selectedBlock)selectedBlock.classList.remove('is-selected');
    if(selectedImg)selectedImg.classList.remove('is-selected');
    selectedImg=null;selectedBlock=null;
    if(imageTools)imageTools.hidden=true;
    if(imgOverlay)imgOverlay.hidden=true;
  }
  function applyImageWidth(pct){
    if(!selectedBlock)return;
    pct=Math.max(10,Math.min(100,Math.round(pct)||50));
    selectedBlock.style.width=pct+'%';
    if(selectedBlock!==selectedImg)selectedImg.style.width='100%';
    if(typeof markDirty==='function')markDirty();
    syncImageTools();positionOverlay();
  }
  function applyImageAlign(align){
    if(!selectedBlock)return;
    selectedBlock.classList.remove('align-left','align-center','align-right');
    selectedBlock.classList.add('align-'+align);
    if(typeof markDirty==='function')markDirty();
    syncImageTools();positionOverlay();
  }
  if(visual){
    visual.addEventListener('click',function(e){
      var img=e.target&&e.target.closest?e.target.closest('img'):null;
      if(img&&visual.contains(img)){selectImage(img)}
      else if(e.target===visual||(e.target.closest&&!e.target.closest('figure.image-block')))clearImageSelection();
    });
    visual.addEventListener('scroll',positionOverlay);
    // Typing above the image, or the image finishing loading, moves it: keep
    // the corner anchors glued to it instead of leaving them floating stale.
    visual.addEventListener('input',positionOverlay);
    visual.addEventListener('load',function(e){if(e.target&&e.target.tagName==='IMG')positionOverlay()},true);
    window.addEventListener('resize',positionOverlay);
  }
  if(imageTools){
    // Keep the editor selection alive when a button is pressed, but let the
    // width slider receive its own pointer events so it can actually drag.
    imageTools.addEventListener('mousedown',function(e){if(e.target.closest&&e.target.closest('button'))e.preventDefault()});
    imageTools.querySelectorAll('[data-img-size]').forEach(function(b){b.addEventListener('click',function(){applyImageWidth(Number(b.dataset.imgSize))})});
    imageTools.querySelectorAll('[data-img-align]').forEach(function(b){b.addEventListener('click',function(){applyImageAlign(b.dataset.imgAlign)})});
    var removeBtn=imageTools.querySelector('[data-img-remove]');
    if(removeBtn)removeBtn.addEventListener('click',function(){
      if(!selectedBlock)return;
      var block=selectedBlock;clearImageSelection();block.remove();
      if(typeof markDirty==='function')markDirty();
      visual.focus();syncStats();
    });
    // Edit the words the reader sees under the picture without going to HTML.
    var captionBtn=imageTools.querySelector('[data-img-caption]');
    if(captionBtn)captionBtn.addEventListener('click',function(){
      if(!selectedBlock)return;
      var img=selectedImg,figure=selectedBlock.tagName==='FIGURE'?selectedBlock:null;
      var captionEl=figure?figure.querySelector('figcaption'):null;
      var next=prompt('Caption under the image (leave empty to remove it)',captionEl?captionEl.textContent:'');
      if(next===null)return;
      next=next.trim();
      if(!figure){
        // A bare <img> gets wrapped so the caption has somewhere to live.
        figure=document.createElement('figure');
        figure.className='image-block align-center';
        figure.style.width=(imageWidthPct()||50)+'%';
        img.parentNode.insertBefore(figure,img);
        img.style.width='100%';
        figure.appendChild(img);
        captionEl=null;
      }
      if(!next){if(captionEl)captionEl.remove()}
      else if(captionEl)captionEl.textContent=next;
      else{captionEl=document.createElement('figcaption');captionEl.textContent=next;figure.appendChild(captionEl)}
      selectImage(img);
      if(typeof markDirty==='function')markDirty();
    });
    // Alt text is the one image property a screen reader depends on; it is
    // editable here, not only in the media library.
    var altBtn=imageTools.querySelector('[data-img-alt]');
    if(altBtn)altBtn.addEventListener('click',function(){
      if(!selectedImg)return;
      var next=prompt('Describe this image for screen readers (empty = decorative)',selectedImg.getAttribute('alt')||'');
      if(next===null)return;
      selectedImg.setAttribute('alt',next.trim());
      if(typeof markDirty==='function')markDirty();
      note(next.trim()?'Alt text updated.':'Image marked decorative.');
    });
    // Turn the selected image into a link (or clear its link).
    var linkBtn=imageTools.querySelector('[data-img-link]');
    if(linkBtn)linkBtn.addEventListener('click',function(){
      if(!selectedImg)return;
      var anchor=selectedImg.closest('a');
      var next=prompt('Link this image to (empty removes the link)',anchor?anchor.getAttribute('href')||'':'https://');
      if(next===null)return;
      next=next.trim();
      if(!next){
        if(anchor){
          while(anchor.firstChild)anchor.parentNode.insertBefore(anchor.firstChild,anchor);
          anchor.remove();
        }
        if(typeof markDirty==='function')markDirty();
        return;
      }
      if(U.safeHref&&!U.safeHref(next)){note('That link was not saved: use https://, mailto: or /path.');return}
      if(anchor){anchor.setAttribute('href',next)}
      else{
        anchor=document.createElement('a');
        anchor.setAttribute('href',next);
        selectedImg.parentNode.insertBefore(anchor,selectedImg);
        anchor.appendChild(selectedImg);
      }
      selectImage(selectedImg);
      if(typeof markDirty==='function')markDirty();
    });
  }
  if(imgWidth)imgWidth.addEventListener('input',function(){applyImageWidth(Number(imgWidth.value))});
  // Drag any corner anchor: horizontal distance becomes the new width.
  if(imgOverlay)imgOverlay.querySelectorAll('[data-handle]').forEach(function(handle){
    handle.addEventListener('pointerdown',function(e){
      if(!selectedImg)return;
      e.preventDefault();e.stopPropagation();
      var west=handle.dataset.handle.indexOf('w')!==-1;
      var startX=e.clientX,startW=selectedImg.getBoundingClientRect().width,host=visual.clientWidth||1;
      try{handle.setPointerCapture(e.pointerId)}catch(err){/* capture is a nicety; window-level drag still works without it */}
      function move(ev){applyImageWidth((startW+(west?startX-ev.clientX:ev.clientX-startX))/host*100)}
      function up(){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up)}
      // On window, not just the 12px handle: a fast drag leaves the handle.
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',up);
      window.addEventListener('pointercancel',up);
    });
  });

  /* ------------------------------------------------------------- boot */
  mode='html';
  // Content opens in the visual editor; an empty document (Add New) has
  // nothing to preview yet, so it starts on the HTML tab with the cursor in
  // the source. A <style>/<script> block always stays in the source pane, and
  // is never written into this document's DOM: innerHTML does not run a
  // <script>, but it would apply a <style> to the whole admin page.
  if(ta.value.trim()&&!hasRawBlock(ta.value)){visual.innerHTML=ta.value;toText()}
  else syncMode();
  // The skin variable already holds the remembered/dialog choice from the
  // chooser above; re-applying initial here used to undo it before display.
  applySkin(skin);

  /* -------------------------------------------- title, slug, publish */
  var title=document.getElementById('title'),slug=document.getElementById('slug');
  if(slug&&!slug.value){
    title.addEventListener('input',function(){
      if(slug.dataset.touched)return;
      // The same slugify the server runs, so what you see is what is stored.
      slug.value=U.slugify?U.slugify(title.value):title.value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
    });
    slug.addEventListener('input',function(){slug.dataset.touched=slug.value?1:'';updateSlugPreview()});
  }
  function updateSlugPreview(){
    var out=document.getElementById('slug-preview');
    if(!out)return;
    var value=slug&&slug.value?slug.value:(U.slugify?U.slugify((title||{}).value||''):'');
    out.textContent=value||'…';
  }
  if(title)title.addEventListener('input',updateSlugPreview);
  updateSlugPreview();
  var st=document.getElementById('status'),when=document.getElementById('when');
  if(st&&when){var sync=function(){when.hidden=st.value==='draft'};st.addEventListener('change',sync);sync()}
  var del=document.getElementById('delete');
  if(del)del.addEventListener('submit',function(e){if(!confirm('Delete this permanently?'))e.preventDefault()});

  /* ------------------------------------------------------- word count */
  // A live count of the words a reader will see, which is the only number a
  // writer can act on; the HTML tab's source length would be misleading.
  function syncStats(){
    if(!statsEl||!U.wordCount)return;
    var source=liveHtml();
    var counts=U.wordCount(source);
    statsEl.textContent=counts.words+(counts.words===1?' word':' words')+
      ' · '+U.readingMinutes(counts.words)+' min read'+
      (counts.chars?' · '+counts.chars+' characters':'');
  }
  if(visual)visual.addEventListener('input',syncStats);
  if(ta)ta.addEventListener('input',syncStats);
  syncStats();

  /** The image tools need the picker's callback above, so expose it for tests. */
  window.amsEditor={setMode:setMode,mode:function(){return mode},serialize:function(){return currentBody()},tidy:tidyHtml,selectImage:selectImage,stats:syncStats};
})();
</script>`;
