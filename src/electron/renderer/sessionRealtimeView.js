'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorSessionRealtimeView = api;
})(typeof window !== 'undefined' ? window : null, function createApi() {
  function createPanel({ document, rates, query, getStats, available, active, binding, t,
    now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
    const tracker = rates.createTracker();
    let selected = '', context = '', timer = null, disposed = false, optionsSignature = '';
    const root = document.createElement('section');
    root.className = 'session-realtime';
    root.dataset.sessionRealtime = 'true';
    const add = (tag, className, text, parent = root) => {
      const node = document.createElement(tag);
      node.className = className;
      if (text) node.textContent = text;
      parent.append(node);
      return node;
    };
    add('h3', 'session-realtime-title', t('realtimeSession.title'));
    const sourceLabel = add('label', 'session-realtime-source', t('realtimeSession.source'));
    const select = add('select', '', '', sourceLabel);
    select.setAttribute('aria-label', t('realtimeSession.source'));
    const values = add('div', 'session-realtime-values');
    const secondBox = add('div', '', '', values);
    const second = add('strong', '', '—', secondBox);
    second.dataset.rateOutput = 'second';
    add('span', '', ' tok/s', secondBox);
    const minuteBox = add('div', '', '', values);
    const minute = add('strong', '', '—', minuteBox);
    minute.dataset.rateOutput = 'minute';
    add('span', '', ' tok/min', minuteBox);
    const status = add('p', 'session-realtime-status');
    status.setAttribute('role', 'status');
    const caption = add('p', 'session-realtime-caption', t('realtimeSession.trend'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 280 76');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('realtimeSession.trend'));
    root.append(svg);
    const axis = add('div', 'session-realtime-axis');
    add('span', '', '−5 min', axis);
    add('span', '', t('realtimeSession.now'), axis);
    const empty = add('p', 'session-realtime-empty', t('realtimeSession.empty'));
    add('p', 'session-realtime-note', t('realtimeSession.note'));
    const format = value => value === null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
    function stop() { if (timer !== null) clearTimer(timer); timer = null; }
    function dispose() { disposed = true; stop(); document.removeEventListener('visibilitychange', visibility); tracker.reset(); }
    function update() {
      if (disposed) return;
      if (!active()) { dispose(); return; }
      const nextContext = binding();
      if (nextContext !== context) { tracker.reset(); selected = ''; context = nextContext; }
      const clock = now();
      const sources = rates.sessionSources(getStats(), query, clock);
      const source = selected ? sources.find(item => item.deviceId === selected)
        : sources.find(item => item.available) || sources[0];
      if (source && !selected) selected = source.deviceId;
      const signature = JSON.stringify([selected, sources.map(item => [item.deviceId, item.hostname])]);
      if (signature !== optionsSignature) {
        optionsSignature = signature;
        select.replaceChildren();
        for (const item of sources) {
          const option = document.createElement('option');
          option.value = item.deviceId;
          option.textContent = `${item.hostname} · ${item.deviceId}`;
          select.append(option);
        }
        if (selected && !source) {
          const option = document.createElement('option');
          option.value = selected; option.textContent = selected; select.append(option);
        }
        select.value = selected;
      }
      sourceLabel.hidden = sources.length < 2 && !!source;
      const reading = tracker.observe(available() ? source : null, clock);
      root.dataset.realtimeState = reading.state;
      second.textContent = format(reading.tokensPerSecond);
      minute.textContent = format(reading.tokensPerMinute);
      status.textContent = t(`realtimeSession.${reading.state}`);
      const drawing = rates.chart(reading.points, clock);
      caption.textContent = t('realtimeSession.trend') + (reading.points.length
        ? ` · ${t('realtimeSession.peak', { rate: format(drawing.peak) })}` : '');
      empty.hidden = reading.points.length > 0;
      svg.replaceChildren();
      for (const points of drawing.segments) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('points', points);
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(line);
      }
    }
    function setVisible(show) {
      if (!active()) { dispose(); return; }
      if (!show) { stop(); tracker.observe(null, now()); return; }
      update();
      if (!disposed && timer === null) timer = setTimer(update, 1000);
    }
    function visibility() { setVisible(!document.hidden); }
    select.addEventListener('change', () => { selected = select.value; tracker.reset(); update(); });
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return { element: root, update, dispose, setVisible, get disposed() { return disposed; } };
  }
  return { createPanel };
});
