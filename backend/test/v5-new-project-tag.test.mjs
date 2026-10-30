import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../site.css', import.meta.url), 'utf8');
const grab = name => {
  const match = source.match(new RegExp(`    function ${name}\\([^\\n]*\\{[\\s\\S]*?\\n    \\}`));
  assert.ok(match, `找不到 ${name}`);
  return match[0];
};

test('輪值標籤：只在第一位，重排後移動；休假、出國、下班仍顯示', () => {
  const team = { querySelector: () => null, innerHTML: '' };
  const designers = ['Anna', 'Machi', 'Leona'];
  const state = { people: {}, pixAvatars: {} };
  const render = new Function('team', 'DESIGNERS', 'state', `
    const $=()=>team,WORKING=new Set(['working','overtime']),STATUS_TEXT={};
    const esc=s=>String(s),headImg=()=>'<img class="head" alt="">',hoverCardHtml=()=>'';
    ${grab('renderTeam')}
    return renderTeam;
  `)(team, designers, state);
  for (const status of ['', 'leave', 'abroad', 'off', 'overtime']) {
    for (const name of designers) {
      state.people[name] = { status };
      state.pixAvatars[name] = { story: { count: 1, unread: true }, message: '測試對話' };
    }
    render();
    assert.equal((team.innerHTML.match(/class="new-project-tag"/g) || []).length, 1);
    const members = [...team.innerHTML.matchAll(/<li\b[^>]*data-name="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    for (const [, name, html] of members) {
      assert.equal(html.includes('class="new-project-tag"'), name === designers[0]);
      assert.match(html, /class="story-badge/);
      if (status === 'overtime') assert.match(html, /class="avatar-badge"/);
      if (name === designers[0]) {
        assert.match(html, /<button type="button" class="new-project-tag" aria-label="新專案找我：開始填寫設計需求">新專案找我<\/button>/);
        assert.match(html, /<\/button><button type="button" class="new-project-tag"/);
      }
    }
    designers.push(designers.shift());
  }
  designers.length = 0;
  render();
  assert.doesNotMatch(team.innerHTML, /new-project-tag/);
});

function teamEvents({ loggedIn = true, allowed = true, reduced = false } = {}) {
  const calls = [], handlers = {};
  const team = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  const slot = { getBoundingClientRect: () => ({ top: -180 }) };
  new Function('env', `
    const {calls,handlers,team,slot,loggedIn:login,allowed,reduced}=env;
    const $=id=>id==='team'?team:slot,document={addEventListener(){}};
    const window={scrollY:400,scrollTo:o=>calls.push(['scroll',o])};
    const loggedIn=()=>login,acc=(...args)=>(calls.push(['access',...args]),allowed);
    const toast=(...args)=>calls.push(['toast',...args]),startLogin=()=>calls.push(['login']);
    const csOpen=(...args)=>calls.push(['menu',...args]),setOpen=(...args)=>calls.push(['card',...args]);
    const openUniverse=()=>calls.push(['universe']),matchMedia=()=>({matches:reduced});
    ${grab('bindTeam')}
    bindTeam();
  `)({ calls, handlers, team, slot, loggedIn, allowed, reduced });
  const event = {
    target: { closest: selector => selector.includes('.new-project-tag') ? {} : null },
    stopPropagation: () => calls.push(['stop'])
  };
  return { calls, handlers, event };
}

test('標籤未登入：先停止冒泡、提示並登入，不開選單或多元宇宙', () => {
  const { calls, handlers, event } = teamEvents({ loggedIn: false });
  handlers.click(event);
  assert.deepEqual(calls, [['stop'], ['card', null, false], ['toast', '請先登入才能新增設計需求', true], ['login']]);
});

test('標籤無新增權限：提示後停止', () => {
  const { calls, handlers, event } = teamEvents({ allowed: false });
  handlers.click(event);
  assert.deepEqual(calls, [['stop'], ['card', null, false], ['access', 'request.create', true], ['toast', '此帳號沒有新增需求的權限', true]]);
});

test('標籤有權限：開啟客戶選單、捲到原始插槽；減少動態時不平滑捲動', () => {
  for (const reduced of [false, true]) {
    const { calls, handlers, event } = teamEvents({ reduced });
    handlers.mouseover(event);
    handlers.focusin(event);
    assert.deepEqual(calls, [], '標籤 hover/focus 不展開頭像卡片');
    handlers.click(event);
    assert.deepEqual(calls, [
      ['stop'], ['card', null, false], ['access', 'request.create', true], ['menu', true, true],
      ['scroll', { top: 196, behavior: reduced ? 'instant' : 'smooth' }],
      ['toast', '請先選擇客戶別，馬上開始填寫「新專案」需求']
    ]);
  }
});

test('標籤選單：選完既有客戶送出；取消清除意圖，一般入口與新增客戶不重複送出', () => {
  const calls = [], timers = [];
  const elements = {
    csPop: { hidden: true }, csTrigger: { setAttribute() {}, focus() {} },
    csSearch: { value: '', focus: options => calls.push(['focus', options]) },
    clientSelect: { value: '', options: [{ value: '測試客戶' }], dispatchEvent: e => calls.push(['change', e.type]) },
    prompt: { requestSubmit: () => calls.push(['submit']) }
  };
  const { open, pick, state } = new Function('elements', 'calls', 'timers', `
    const $=id=>elements[id],csState={idx:0,items:[],startOnPick:false};
    const csRender=()=>{},csSync=()=>{},setTimeout=fn=>timers.push(fn);
    ${grab('csOpen')}
    ${grab('csPick')}
    return {open:csOpen,pick:csPick,state:csState};
  `)(elements, calls, timers);
  open(true, true);
  timers.shift()();
  assert.deepEqual(calls.shift(), ['focus', { preventScroll: true }]);
  pick('測試客戶');
  assert.deepEqual(calls.splice(0), [['change', 'change'], ['submit']]);
  assert.equal(state.startOnPick, false);
  assert.equal(elements.csPop.hidden, true);
  open(true, true);
  open(false);
  open(true);
  pick('測試客戶');
  assert.deepEqual(calls.splice(0), [['change', 'change']]);
  open(true, true);
  pick('__new__');
  assert.deepEqual(calls, [['change', 'change']], '新增客戶由既有 change 流程負責送出');
});

test('標籤 CSS：主站配色、小尾巴、有限動畫；手機與減少動態停用動畫', () => {
  assert.match(css, /\.new-project-tag\{[^}]*background:var\(--brand-soft\)[^}]*color:var\(--st-done-ink\)/);
  assert.match(css, /\.new-project-tag::after\{[^}]*transform:rotate\(45deg\)/);
  assert.match(css, /@media \(max-width:720px\)\{\.new-project-tag\{[^}]*animation:none/);
  assert.match(css, /@media \(hover:none\), \(prefers-reduced-motion:reduce\)\{\.new-project-tag\{animation:none/);
  const rules = [...css.matchAll(/\.new-project-tag(?:::[\w-]+|:[\w-]+)?\{([^}]*)\}/g)].map(m => m[1]).join('\n');
  assert.doesNotMatch(rules, /backdrop-filter|infinite/);
  assert.match(rules, /animation:newProjectNudge 2s ease-in-out 2/);
  assert.ok(!source.includes('\r'), 'site.js 維持 LF');
});
