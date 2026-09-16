// Run with Playwright available in NODE_PATH; uses an isolated page, no API or email writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
  const page=await browser.newPage();
  await page.setContent(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await page.addScriptTag({content:
    source.slice(source.indexOf('let savedRichSelectionRange=null;'),source.indexOf('/** 文字大小選單'))+
    source.slice(source.indexOf("document.querySelectorAll('.gmail-rich-color-btn').forEach(button=>{"),source.indexOf("document.querySelectorAll('.gmail-rich-image-btn').forEach(button=>{"))
  });
  for(const theme of ['light','dark'])for(const mode of ['designer','designer-tail','general','partial']){
    const initial=await page.evaluate(({theme,mode})=>{
      document.documentElement.dataset.theme=theme;
      document.querySelectorAll('.revision-modal,.login-modal').forEach(e=>e.hidden=true);
      document.querySelector('#gmailThreadModal').hidden=false;
      document.querySelector('#gmailThreadComposeSection').hidden=false;
      const editor=document.querySelector('#gmailThreadReplyEditor');
      editor.contentEditable='true';
      editor.innerHTML='<p>Hi designer,</p><p><b>回覆文字</b>，謝謝。</p>'+(mode==='general'?'':'<div contenteditable="false" id="lockedImages"><span>圖片上傳中</span></div><p>圖片後方文字</p><div contenteditable="false" id="lockedNas"><b>NAS folder</b></div><div contenteditable="false"></div>')+'<p>結尾文字</p>';
      if(mode==='designer-tail')editor.lastElementChild.remove();
      editor.focus();
      const range=document.createRange();range.selectNodeContents(mode==='partial'?editor.querySelector('b'):editor);
      getSelection().removeAllRanges();getSelection().addRange(range);
      return [...editor.querySelectorAll('[contenteditable="false"]')].map(e=>e.outerHTML);
    },{theme,mode});
    for(const [kind,color,expected] of [['text','#ff0000','rgb(255, 0, 0)'],['background','#ffff00','rgb(255, 255, 0)']]){
      await page.locator('[data-rich-color-for="gmailThreadReplyEditor"]').click();
      await page.locator(`[data-gmail-color="${color}"][data-gmail-color-kind="${kind}"]`).click();
      const actual=await page.evaluate(({kind,mode})=>{
        const editor=document.querySelector('#gmailThreadReplyEditor');
        const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
        const values=[];
        while(walker.nextNode()){
          const node=walker.currentNode;
          if(node.parentElement.closest('[contenteditable="false"]'))continue;
          if(mode==='partial'&&node.textContent!=='回覆文字')continue;
          let element=node.parentElement;
          if(kind==='background')while(element!==editor&&getComputedStyle(element).backgroundColor==='rgba(0, 0, 0, 0)')element=element.parentElement;
          values.push(getComputedStyle(element)[kind==='text'?'color':'backgroundColor']);
        }
        return {values,locked:[...editor.querySelectorAll('[contenteditable="false"]')].map(e=>e.outerHTML)};
      },{kind,mode});
      assert.ok(actual.values.length);
      assert.ok(actual.values.every(value=>value===expected),`${theme}/${mode}/${kind}: ${actual.values}`);
      assert.deepEqual(actual.locked,initial,'Readonly content must remain unchanged');
    }
    console.log(`PASS ${theme}/${mode}: text + background, readonly blocks preserved`);
  }
  await page.evaluate(()=>{
    const editor=document.querySelector('#gmailThreadReplyEditor');editor.innerHTML='游標測試';editor.focus();
    const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
    getSelection().removeAllRanges();getSelection().addRange(range);
  });
  await page.locator('[data-rich-color-for="gmailThreadReplyEditor"]').click();
  await page.locator('[data-gmail-color="#ff0000"][data-gmail-color-kind="text"]').click();
  await page.keyboard.type('X');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#gmailThreadReplyEditor').lastElementChild).color),'rgb(255, 0, 0)');
  console.log('PASS collapsed caret: newly typed text keeps selected color');
  await page.addScriptTag({content:source.slice(source.indexOf('function designerReplyFolderList('),source.indexOf('/** 記錄「這次備份每個檔名'))});
  // Use the actual creation code so a readonly attribute regression is caught too.
  const createNas=source.slice(source.indexOf("  const nasPathsContainer=document.createElement('div');"),source.indexOf('  clearGmailInlineImages(editor.id);',source.indexOf("  const nasPathsContainer=document.createElement('div');")));
  for(const action of ['edit','delete','color','untouched']){
    await page.evaluate(code=>{
      const editor=document.querySelector('#gmailThreadReplyEditor');editor.innerHTML='正文';
      new Function('editor','folders',code)(editor,['/NAS/original']);
      const nas=document.querySelector('#gmailDesignerReplyNasPaths');
      if(!nas.isContentEditable)throw new Error('NAS path is still readonly');
      editor.focus();const range=document.createRange();range.selectNodeContents(nas);
      getSelection().removeAllRanges();getSelection().addRange(range);
    },createNas);
    if(action==='edit')await page.keyboard.type('/NAS/edited');
    if(action==='delete')await page.keyboard.press('Backspace');
    if(action==='color'){
      for(const [kind,color] of [['text','#ff0000'],['background','#ffff00']]){
        await page.locator('[data-rich-color-for="gmailThreadReplyEditor"]').click();
        await page.locator(`[data-gmail-color="${color}"][data-gmail-color-kind="${kind}"]`).click();
      }
      assert.match(await page.locator('#gmailDesignerReplyNasPaths').innerHTML(),/color/);
    }
    const before=await page.locator('#gmailThreadReplyEditor').innerHTML();
    await page.evaluate(()=>renderDesignerReplyNasPaths(['/NAS/confirmed','/NAS/second']));
    const after=await page.locator('#gmailThreadReplyEditor').innerHTML();
    if(action==='untouched')assert.match(after,/\/NAS\/second/);
    else{
      // Metadata may refresh, but the edited body must not be rebuilt.
      const stripMetadata=html=>html.replace(/ data-nas-folders="[^"]*"/g,'');
      assert.equal(stripMetadata(after),stripMetadata(before));
      if(action==='edit')assert.match(after,/\/NAS\/edited/);
      if(action==='delete')assert.doesNotMatch(after,/NAS路徑|\/NAS\/original/);
    }
    console.log(`PASS NAS ${action}: editable body survives backup completion`);
  }
}finally{await browser.close()}
