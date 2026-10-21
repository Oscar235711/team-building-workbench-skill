(function () {
  'use strict';

  var layouts = Object.create(null);
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function textWidth(text, size) {
    var value = String(text || ''), width = 0;
    for (var i = 0; i < value.length; i += 1) width += /[\u0000-\u00ff]/.test(value[i]) ? size * 0.58 : size;
    return Math.max(size * 1.6, width);
  }

  /* Public deterministic mask for collision tests and downstream QA. */
  function inCloud(x, y, width, height) {
    var nx = (x - width / 2) / Math.max(1, width * 0.48);
    var ny = (y - height / 2) / Math.max(1, height * 0.38);
    if (nx * nx + ny * ny <= 1) return true;
    var puffs = [
      { x: 0.18, y: 0.37, r: 0.24 }, { x: 0.36, y: 0.2, r: 0.2 },
      { x: 0.56, y: 0.16, r: 0.24 }, { x: 0.78, y: 0.34, r: 0.22 },
      { x: 0.86, y: 0.55, r: 0.16 }, { x: 0.12, y: 0.57, r: 0.14 },
    ];
    return puffs.some(function (puff) {
      var dx = (x / width - puff.x) / puff.r, dy = (y / height - puff.y) / puff.r;
      return dx * dx + dy * dy <= 1;
    });
  }
  function intersects(first, second) { return !(first.right <= second.left || first.left >= second.right || first.bottom <= second.top || first.top >= second.bottom); }
  function makeBounds(x, y, width, height, angle) {
    var radians = Math.abs((angle || 0) * Math.PI / 180);
    var boxWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
    var boxHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
    return { left: x - boxWidth / 2, right: x + boxWidth / 2, top: y - boxHeight / 2, bottom: y + boxHeight / 2 };
  }
  function boundsInsideMask(bounds, width, height) {
    var x1 = bounds.left, x2 = bounds.right, y1 = bounds.top, y2 = bounds.bottom;
    var samples = [[x1, y1], [x2, y1], [x1, y2], [x2, y2], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2]];
    return samples.every(function (point) { return inCloud(point[0], point[1], width, height); });
  }
  function shortDisplayName(name) { var value = String(name || ''); return value.length > 9 ? value.slice(0, 8) + '…' : value; }
  function makeWords(words, minCount, maxCount, scale) {
    return words.map(function (word, index) {
      var count = Math.max(1, Number(word.count) || 1);
      var ratio = maxCount === minCount ? 0.65 : (count - minCount) / (maxCount - minCount);
      var size = Math.max(15, (18 + ratio * 22) * scale), displayName = shortDisplayName(word.name);
      return { id: word.id == null ? word.name : String(word.id), name: String(word.name), displayName: displayName, count: count, meta: word.meta || null, size: size, width: textWidth(displayName, size), height: size * 1.2, angle: index % 5 === 0 && size < 28 ? -6 : (index % 7 === 0 && size < 32 ? 6 : 0) };
    }).sort(function (a, b) { return b.count - a.count || b.name.length - a.name.length; });
  }
  function tryLayout(words, width, height) {
    var placed = [], missing = [];
    words.forEach(function (word, index) {
      var found = null;
      for (var attempt = 0; attempt < 2600 && !found; attempt += 1) {
        var theta = attempt * 0.43 + index * 0.37, radius = Math.sqrt(attempt) * 4.25;
        var x = width / 2 + Math.cos(theta) * radius * 1.3, y = height / 2 + Math.sin(theta) * radius * 0.78;
        var bounds = makeBounds(x, y, word.width + 8, word.height + 6, word.angle);
        var inFrame = bounds.left >= 8 && bounds.right <= width - 8 && bounds.top >= 8 && bounds.bottom <= height - 8;
        var blocked = placed.some(function (other) { return intersects(bounds, other.bounds); });
        if (inFrame && boundsInsideMask(bounds, width, height) && !blocked) found = { x: x, y: y, bounds: bounds };
      }
      if (found) placed.push({ word: word, x: found.x, y: found.y, bounds: found.bounds }); else missing.push(word);
    });
    return { placed: placed, missing: missing };
  }
  function layoutCloud(words, options) {
    var opts = options || {}, source = Array.isArray(words) ? words.filter(function (word) { return word && String(word.name || '').trim() && Number(word.count) > 0; }) : [];
    if (!source.length) return [];
    var width = Math.max(280, Number(opts.width) || 640), height = Math.max(220, Number(opts.height) || (320 + Math.max(0, source.length - 10) * 18));
    var counts = source.map(function (word) { return Math.max(1, Number(word.count) || 1); }), maxCount = Math.max.apply(Math, counts), minCount = Math.min.apply(Math, counts), result = null;
    [1, 0.92, 0.84, 0.76, 0.68].some(function (scale) {
      var candidate = tryLayout(makeWords(source, minCount, maxCount, scale), width, height);
      if (!candidate.missing.length || scale === 0.68) { result = candidate; return true; }
      return false;
    });
    if (!result) result = tryLayout(makeWords(source, minCount, maxCount, 0.68), width, height);
    return result.placed.map(function (entry) {
      return { id: entry.word.id, name: entry.word.name, displayName: entry.word.displayName, count: entry.word.count, meta: entry.word.meta, x: Number(entry.x.toFixed(2)), y: Number(entry.y.toFixed(2)), size: Number(entry.word.size.toFixed(2)), width: Number(entry.word.width.toFixed(2)), height: Number(entry.word.height.toFixed(2)), angle: entry.word.angle, bounds: { left: Number(entry.bounds.left.toFixed(2)), top: Number(entry.bounds.top.toFixed(2)), right: Number(entry.bounds.right.toFixed(2)), bottom: Number(entry.bounds.bottom.toFixed(2)) } };
    });
  }
  function renderCloud(container, words, options) {
    if (!container) return [];
    var opts = options || {}, source = Array.isArray(words) ? words : [], width = Math.max(280, Number(opts.width) || container.clientWidth || 640), height = Math.max(220, Number(opts.height) || (320 + Math.max(0, source.length - 10) * 18));
    var layout = layoutCloud(source, { width: width, height: height }), key = String(opts.key || container.id || 'cloud');
    layouts[key] = layout; window.__cloudLayouts = layouts; container.innerHTML = ''; container.className = 'cloud-stage' + (layout.length ? '' : ' is-empty'); container.setAttribute('data-layout-key', key); container.style.setProperty('--cloud-width', width + 'px'); container.style.setProperty('--cloud-height', height + 'px'); container.style.height = height + 'px';
    var aura = document.createElement('div'); aura.className = 'cloud-aura'; aura.setAttribute('aria-hidden', 'true'); container.appendChild(aura);
    if (!layout.length) { var empty = document.createElement('div'); empty.className = 'cloud-empty'; empty.textContent = '还没有投票，等大家留下第一朵灵感云'; container.appendChild(empty); return layout; }
    var byId = Object.create(null); source.forEach(function (word) { byId[String(word.id == null ? word.name : word.id)] = word; });
    layout.forEach(function (entry) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'cloud-word'; button.textContent = entry.displayName || entry.name; button.setAttribute('data-word-id', entry.id); button.setAttribute('aria-label', entry.name + '，' + entry.count + '人支持'); button.style.left = (entry.x / width * 100).toFixed(3) + '%'; button.style.top = (entry.y / height * 100).toFixed(3) + '%'; button.style.fontSize = entry.size + 'px'; button.style.transform = 'translate(-50%, -50%) rotate(' + entry.angle + 'deg)'; button.style.setProperty('--cloud-weight', String(clamp(entry.count, 1, 99))); button.title = entry.name + ' · ' + entry.count + '人支持'; button.addEventListener('click', function () { if (typeof opts.onWord === 'function') opts.onWord(byId[entry.id] || entry, entry); }); container.appendChild(button);
    });
    return layout;
  }
  window.__cloudLayouts = layouts;
  window.CloudRenderer = { layout: layoutCloud, render: renderCloud, inCloud: inCloud, getLayouts: function () { return layouts; } };
})();
