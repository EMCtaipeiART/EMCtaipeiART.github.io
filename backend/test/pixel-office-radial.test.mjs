import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../archive/EMC-ART-Pixel-Office-2D/dist/app.js', import.meta.url), 'utf8');
const radial = source.slice(source.indexOf('(()=>{', source.indexOf('// 人物四周的圓形選單')));

// Execute the real menu controller with a minimal DOM and deterministic timers.
// Layout assertions cover its numeric constraints; actual CSS rendering needs browser QA.
function fixture({ width = 960, height = 640, reduced = false, monitor = true } = {}) {
  const ids = new Map(), timers = new Map(), calls = [];
  let sequence = 0;
  const document = { activeElement: null, listeners: {} };
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
      this.style = { setProperty(k, v) { this[k] = v; } }; this.hidden = false;
      this.classList = {
        contains: c => this.className.split(' ').includes(c),
        add: c => { this.className = [...new Set([...this.className.split(' '), c])].join(' '); },
        remove: c => { this.className = this.className.split(' ').filter(x => x !== c).join(' '); },
        toggle: (c, value) => this.classList[value ? 'add' : 'remove'](c),
      };
      this.className = '';
    }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set innerHTML(value) {
      this.html = value;
      for (const [, id] of value.matchAll(/id="([^"]+)"/g)) { const e = new Element(); e.id = id; this.append(e); }
    }
    append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(n => n !== node); node.parentElement = this; this.children.push(node); } }
    appendChild(node) { this.append(node); return node; }
    setAttribute(k, v) { this.attrs[k] = v; }
    closest(selector) { return selector === '.tool-section' ? (this.classList.contains('tool-section') ? this : this.parentElement?.closest(selector)) : null; }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(selector === '.radial-sec' && c.classList.contains('radial-sec') ? [c] : []), ...c.querySelectorAll(selector)]); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    focus() { document.activeElement = this; }
    click() { calls.push(['click', this.id]); this.onclick?.(); }
    get offsetWidth() { return parseFloat(this.style.width) || 292; }
    get offsetHeight() { return Math.min(420, parseFloat(this.style.maxHeight) || 420); }
    getBoundingClientRect() { return { left: 0, top: 0, width, height }; }
  }
  document.createElement = tag => new Element(tag);
  document.body = new Element(); document.documentElement = new Element(); document.documentElement.className = 'clean';
  document.addEventListener = (type, fn) => { document.listeners[type] = fn; };
  const make = (id, parent = document.body) => { const e = new Element(); e.id = id; parent.append(e); return e; };
  const wrap = make('wrap'), game = make('game', wrap);
  for (const id of ['statuses', 'lookSection', 'actionSection', 'musicSection', 'storyUpload', 'message']) {
    const section = new Element('section'); section.className = 'tool-section collapsible'; document.body.append(section); make(id, section);
  }
  make('storyFile'); make('personCard');
  const context = {
    document, window: { innerWidth: width, innerHeight: height, addEventListener() {}, matchMedia: () => ({ matches: reduced }) },
    $: id => ids.get(id), game, FLOOR4: false, embedMode: false, selected: 0, W: width, H: height, OY: 0, cam: { on: false },
    people: [{ x: width / 2, y: height / 2 + 78 }], viewPeople: [], starts: [[80, 100]], keys: new Set(), storyIdentity: { monitor },
    isPunishedP: p => !!p.punish, storyOpen: () => context.storyIsOpen,
    setStatus: s => calls.push(['status', s]), markDirty: () => {}, save: () => {}, queuePosition: i => calls.push(['position', i]),
    setTimeout: fn => { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(radial, context);
  const box = ids.get('radial'), ring = box.children[0], panel = box.children[1], back = panel.children[0].children[0];
  const button = label => ring.children.find(b => b.attrs['aria-label'] === label);
  const flush = () => { while (timers.size) { const entries = [...timers]; timers.clear(); entries.forEach(([, fn]) => fn()); } };
  return { ...context, context, ids, box, ring, panel, back, button, calls, flush, open: () => context.window.radialOpen(0), close: () => context.window.radialClose(), place: () => context.window.radialPlace() };
}

test('radial navigation preserves labels, panel focus and return focus; reopen cancels pending close', () => {
  const f = fixture(); f.open();
  assert.equal(f.document.activeElement, f.button('在座'));
  for (const label of ['目前狀態', '造型', '動作', '音樂', '限時動態', '想說的話', '班長']) {
    f.button(label).click();
    assert.equal(f.panel.hidden, false); assert.equal(f.document.activeElement, f.back);
    f.flush(); assert.equal(f.ring.hidden, true);
    f.back.click(); assert.equal(f.ring.hidden, false); assert.equal(f.panel.hidden, true);
    assert.equal(f.document.activeElement, f.button(label));
  }
  f.close(); assert.equal(f.box.inert, true);
  f.open(); f.flush(); assert.equal(f.box.hidden, false); assert.equal(f.box.inert, false);
  f.button('音樂').click(); f.back.click(); f.flush(); assert.equal(f.ring.hidden, false);
});

test('radial keeps seat/status/movement closing and administrator/punishment visibility', () => {
  const f = fixture({ monitor: false }); f.open();
  assert.equal(f.button('班長').hidden, true);
  f.storyIdentity.monitor = true; f.people[0].punish = true; f.place();
  assert.equal(f.button('班長').hidden, false); assert.equal(f.button('造型').hidden, true); assert.equal(f.button('動作').hidden, true);
  f.button('在座').click(); f.flush();
  assert.ok(f.calls.some(c => c[0] === 'status' && c[1] === 'present'));
  assert.equal(f.people[0].x, 80); assert.equal(f.people[0].y, 100); assert.equal(f.people[0].dir, 'down'); assert.equal(f.box.hidden, true);
  f.open(); f.keys.add('ArrowRight'); f.place(); f.flush(); assert.equal(f.box.hidden, true);
  f.keys.clear(); f.open(); f.button('目前狀態').click();
  f.ids.get('statuses').listeners.click({ target: { closest: () => ({}) } }); f.flush(); assert.equal(f.box.hidden, true);
});

test('radial Escape leaves story shortcuts alone, reduced motion closes immediately, upload supports Enter/Space', () => {
  const f = fixture({ reduced: true }); f.open();
  const key = key => ({ key, preventDefault() { this.defaultPrevented = true; } });
  f.document.listeners.keydown(key('ArrowRight')); assert.equal(f.box.hidden, false);
  f.context.storyIsOpen = true; f.document.listeners.keydown(key('Escape')); assert.equal(f.box.hidden, false);
  f.context.storyIsOpen = false; f.document.listeners.keydown(key('Escape')); assert.equal(f.box.hidden, true); assert.equal(f.document.activeElement, f.game);
  f.open(); f.button('限時動態').click();
  const upload = f.ids.get('storyUpload'); assert.equal(upload.tabIndex, 0);
  upload.listeners.keydown(key('Enter')); upload.listeners.keydown(key(' '));
  assert.equal(f.calls.filter(c => c[0] === 'click' && c[1] === 'storyFile').length, 2);
  f.close(); assert.equal(f.box.hidden, true);
});

test('radial placement keeps ring, labels and panels within viewport edges; tiny frames use a scrollable fallback', () => {
  for (const [width, height] of [[960, 640], [390, 340], [320, 300], [320, 240], [240, 180]]) {
    const f = fixture({ width, height });
    for (const [x, y] of [[4, 4], [width / 2, height / 2], [width - 4, height - 4]]) {
      f.people[0].x = x; f.people[0].y = y + 78; f.open();
      if (!f.ring.classList.contains('is-compact')) {
        const small = f.ring.classList.contains('is-small');
        for (const b of f.ring.children.filter(b => !b.hidden)) {
          const bx = x + parseFloat(b.style['--rx']), by = y + parseFloat(b.style['--ry']);
          assert.ok(bx - 36 >= 0 && bx + 36 <= width);
          assert.ok(by - (small ? 22 : 26) >= 0 && by + (small ? 48 : 52) <= height);
        }
      } else {
        assert.ok(parseFloat(f.ring.style.maxHeight) <= height - 16);
        assert.ok(x + parseFloat(f.ring.style.left) >= 8);
        assert.ok(y + parseFloat(f.ring.style.top) + f.ring.offsetHeight <= height - 8);
      }
      f.button('造型').click();
      assert.ok(x + parseFloat(f.panel.style.left) >= 8);
      assert.ok(x + parseFloat(f.panel.style.left) + f.panel.offsetWidth <= width - 8);
      assert.ok(y + parseFloat(f.panel.style.top) >= 8);
      assert.ok(y + parseFloat(f.panel.style.top) + f.panel.offsetHeight <= height - 8);
    }
  }
});
