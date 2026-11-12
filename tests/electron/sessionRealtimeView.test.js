'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rates = require('../../src/shared/sessionRealtime');
const { createPanel } = require('../../src/electron/renderer/sessionRealtimeView');
const { translate } = require('../../src/electron/renderer/i18n');

function element(tag) {
  return { tag, children: [], dataset: {}, attributes: {}, handlers: new Map(), hidden: false, value: '',
    append(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, callback) { this.handlers.set(key, callback); },
  };
}
function fixture() {
  const base = Date.parse('2026-11-12T03:00:00Z');
  let clock = base, active = true, available = true, binding = 'one';
  const timers = new Map(), listeners = new Map();
  const document = { hidden: false, createElement: element, createElementNS: (_, tag) => element(tag),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const device = (id, output) => ({ deviceId: id, hostname: '<img> source', updatedAt: new Date(clock).toISOString(),
    periods: { today: { sessions: { 'codex:one': { client: 'codex', sessionId: 'one', outputTokens: output } } } } });
  let stats = { devices: [device('a', 10000), device('b', 50000)] };
  const panel = createPanel({ document, rates, query: { client: 'codex', sessionId: 'one' }, getStats: () => stats,
    available: () => available, active: () => active, binding: () => binding, now: () => clock,
    setTimer: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimer: id => timers.delete(id),
    t: (key, params) => translate('en', key, params) });
  const find = predicate => {
    const walk = node => predicate(node) ? node : node.children.map(walk).find(Boolean);
    return walk(panel.element);
  };
  return { panel, timers, listeners, find,
    step(ms, a, b) { clock += ms; stats = { devices: [device('a', a), device('b', b)] }; panel.update(); },
    setAvailable(value) { available = value; panel.update(); },
    setActive(value) { active = value; panel.update(); },
    rebind() { binding = 'other'; panel.update(); } };
}

test('desktop realtime view waits for measured deltas and pins device selection without summing copies', () => {
  const f = fixture();
  const second = f.find(node => node.dataset.rateOutput === 'second');
  const minute = f.find(node => node.dataset.rateOutput === 'minute');
  assert.equal(second.textContent, '—');
  f.step(5000, 10150, 90000);
  assert.equal(second.textContent, '30');
  assert.equal(minute.textContent.replace(/\D/g, ''), '1800');
  const select = f.find(node => node.tag === 'select');
  assert.equal(select.children[0].textContent, '<img> source · a');
  assert.equal(f.find(node => node.tag === 'img'), undefined);
  select.value = 'b'; select.handlers.get('change')();
  assert.equal(second.textContent, '—');
  f.step(5000, 20000, 90200);
  assert.equal(second.textContent, '40');
  f.setAvailable(false);
  assert.equal(second.textContent, '—');
  assert.equal(f.panel.element.dataset.realtimeState, 'unavailable');
  f.panel.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});

test('desktop rebinding, hiding, navigation and disposal do not retain a rate baseline or timers', () => {
  const f = fixture();
  f.step(5000, 10150, 50000);
  f.rebind();
  assert.equal(f.find(node => node.dataset.rateOutput === 'second').textContent, '—');
  f.panel.setVisible(false);
  assert.equal(f.timers.size, 0);
  f.panel.setVisible(true);
  assert.equal(f.timers.size, 1);
  assert.equal(f.find(node => node.dataset.rateOutput === 'second').textContent, '—');
  f.setActive(false);
  assert.equal(f.panel.disposed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});
