/*
 * atlas.js — the shared map renderer.
 *
 * Lifted out of index.html so booklet.html can draw the same map. It knows about
 * geography and nothing else: no legs, no clips, no costs, no narration. Everything
 * page-specific (which stop belongs to which region block, what a card says, what the
 * badge reads) stays with the caller and arrives through callbacks.
 *
 * Deliberately kept in the same ES5-flavoured style as index.html.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // Markers cluster at this many viewBox pixels. India is 420px wide here, so a pixel
  // is roughly 8km — the four Varanasi hotels, both Guwahati ones and Mussoorie/
  // Dehradun all land on the same dot. Stacking them would leave every stop but the
  // topmost unreachable, so co-located stops merge and the caller's card lists what is
  // underneath.
  var CLUSTER_PX = 3.5;

  function merc(lon, lat) {
    return [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))];
  }

  function cluster(placed, px) {
    var out = [];
    placed.forEach(function (p) {
      for (var i = 0; i < out.length; i++) {
        var c = out[i];
        if (Math.abs(c.x - p.x) <= px && Math.abs(c.y - p.y) <= px) {
          c.items.push(p);
          // A cluster whose first member had no index inherits the first real one it
          // meets, so the marker still points somewhere.
          if (c.idx < 0) c.idx = p.idx;
          return;
        }
      }
      out.push({ x: p.x, y: p.y, idx: p.idx, items: [p] });
    });
    return out;
  }

  function create(svg, basemap, opts) {
    opts = opts || {};
    var W = opts.width || 420, H = opts.height || 470, PAD = opts.pad == null ? 10 : opts.pad;

    var india = basemap.countries.filter(function (c) { return c.name === 'India'; })[0];
    if (!india) return null;

    // Mercator, matching the design's d3.geoMercator().fitExtent to India.
    var xs = [], ys = [];
    india.rings.forEach(function (ring) {
      ring.forEach(function (p) { var q = merc(p[0], p[1]); xs.push(q[0]); ys.push(q[1]); });
    });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var k = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY));
    var offX = (W - (maxX - minX) * k) / 2, offY = (H - (maxY - minY) * k) / 2;

    function project(lon, lat) {
      var q = merc(lon, lat);
      return [offX + (q[0] - minX) * k, H - (offY + (q[1] - minY) * k)];
    }

    var tiles = null;
    var clusters = [];
    var api = {};

    api.frame = { W: W, H: H, k: k, minX: minX, minY: minY, offX: offX, offY: offY };
    api.project = project;

    api.drawBase = function () {
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.replaceChildren();
      tiles = null;
      basemap.countries.forEach(function (c) {
        if (c.name === 'India') return;
        c.rings.forEach(function (ring) { poly(ring, 'neighbour'); });
      });
      india.rings.forEach(function (ring) { poly(ring, 'india'); });
      return api;
    };

    function poly(ring, cls) {
      var el = document.createElementNS(NS, 'polygon');
      el.setAttribute('class', cls);
      el.setAttribute('points', ring.map(function (p) {
        return project(p[0], p[1]).join(',');
      }).join(' '));
      svg.appendChild(el);
      return el;
    }

    api.drawRoute = function (points, cls) {
      if (!points || points.length < 2) return null;
      var line = document.createElementNS(NS, 'polyline');
      line.setAttribute('class', cls || 'route');
      line.setAttribute('points', points.map(function (p) {
        var xy = project(p.lon, p.lat);
        return xy[0].toFixed(1) + ',' + xy[1].toFixed(1);
      }).join(' '));
      svg.appendChild(line);
      return line;
    };

    api.drawMarkers = function (points, o) {
      o = o || {};
      var placed = points.map(function (p) {
        var xy = project(p.lon, p.lat);
        return { x: xy[0], y: xy[1], idx: p.idx, ref: p.ref };
      });
      clusters = cluster(placed, CLUSTER_PX);

      clusters.forEach(function (c, i) {
        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'stop');
        dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y); dot.setAttribute('r', 2.6);
        dot.dataset.idx = c.idx; dot.dataset.stop = i;
        svg.appendChild(dot);
        c.dot = dot;

        // The visible dot is under 3px; a finger is not. This circle exists for the
        // hover tooltip — the click itself is resolved by distance, below.
        var hit = document.createElementNS(NS, 'circle');
        hit.setAttribute('class', 'hit');
        hit.setAttribute('cx', c.x); hit.setAttribute('cy', c.y); hit.setAttribute('r', 8);
        hit.dataset.idx = c.idx; hit.dataset.stop = i;
        if (o.label) {
          var t = document.createElementNS(NS, 'title');
          t.textContent = o.label(c);
          hit.appendChild(t);
        }
        svg.appendChild(hit);
      });

      // Resolve a click to the *nearest* stop rather than to whatever circle caught the
      // event. Through Himachal and the Northeast the stops sit closer together than a
      // finger-sized target, so the hit circles overlap and the last one drawn swallows
      // its neighbours — several stops were simply unclickable. Nearest-point gives
      // every stop its own catchment, and a click on open sea closes the card.
      if (o.onSelect) svg.addEventListener('click', function (e) {
        var box = svg.getBoundingClientRect();
        if (!box.width || !box.height) return;
        var vb = svg.viewBox.baseVal;
        var x = (e.clientX - box.left) / box.width * vb.width;
        var y = (e.clientY - box.top) / box.height * vb.height;
        var best = -1, bestD = Infinity;
        clusters.forEach(function (c, i) {
          var d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best >= 0 && bestD <= 14 * 14) o.onSelect(best);
        else if (o.onMiss) o.onMiss();
      });

      return clusters;
    };

    api.clusters = function () { return clusters; };

    // The map already draws in Mercator, and Web Mercator is the same projection up to
    // a linear transform — so tiles land exactly on the drawn coastline, no
    // reprojection:
    //   x = worldPx · nx + Bx     where nx = (mx + π) / 2π
    //   y = worldPx · ny + By     where ny = (π − my) / 2π
    api.setTiles = function (on) {
      if (tiles && tiles.parentNode) tiles.parentNode.removeChild(tiles);
      tiles = null;
      if (!on) return api;

      var worldPx = 2 * Math.PI * k;
      var Bx = offX - (Math.PI + minX) * k;
      var By = H - offY - (Math.PI - minY) * k;

      // One zoom finer than the exact fit, so tiles are downscaled rather than blown up.
      var z = Math.max(0, Math.min(19, Math.round(Math.log(worldPx / 256) / Math.LN2) + 1));
      var n = Math.pow(2, z);
      var size = worldPx / n;

      var x0 = Math.max(0, Math.floor((0 - Bx) / size));
      var x1 = Math.min(n - 1, Math.ceil((W - Bx) / size));
      var y0 = Math.max(0, Math.floor((0 - By) / size));
      var y1 = Math.min(n - 1, Math.ceil((H - By) / size));

      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'tiles');
      for (var tx = x0; tx <= x1; tx++) {
        for (var ty = y0; ty <= y1; ty++) {
          var img = document.createElementNS(NS, 'image');
          img.setAttribute('class', 'tile-img');
          img.setAttribute('x', (Bx + tx * size).toFixed(2));
          img.setAttribute('y', (By + ty * size).toFixed(2));
          // Half a pixel of overlap; exact edges leave hairline seams once scaled.
          img.setAttribute('width', (size + 0.5).toFixed(2));
          img.setAttribute('height', (size + 0.5).toFixed(2));
          img.setAttribute('href', 'https://tile.openstreetmap.org/' + z + '/' + tx + '/' + ty + '.png');
          g.appendChild(img);
        }
      }
      svg.insertBefore(g, svg.firstChild);   // behind coastlines and route
      tiles = g;
      return api;
    };

    // Ease the viewBox toward a lat/lon box, for the overview. null resets to the
    // whole map. Never zooms past 3x, which is where the baked coastline starts to
    // look like a polygon rather than a coast.
    var focusRaf = null;
    api.focus = function (bounds, animate) {
      if (focusRaf) { cancelAnimationFrame(focusRaf); focusRaf = null; }
      var to = [0, 0, W, H];
      if (bounds) {
        var a = project(bounds.minLon, bounds.maxLat);
        var b = project(bounds.maxLon, bounds.minLat);
        var pad = 40;
        var x = Math.min(a[0], b[0]) - pad, y = Math.min(a[1], b[1]) - pad;
        var w = Math.abs(b[0] - a[0]) + pad * 2, h = Math.abs(b[1] - a[1]) + pad * 2;
        var minW = W / 3, minH = H / 3;
        if (w < minW) { x -= (minW - w) / 2; w = minW; }
        if (h < minH) { y -= (minH - h) / 2; h = minH; }

        // Letterbox the box back to the map's own shape. The <svg> carries no width or
        // height attribute, so its intrinsic ratio comes from the viewBox: a box of a
        // different shape resizes the ELEMENT, and the whole pane would jump about as
        // the overview moved. Grow the short side rather than crop the long one.
        var ar = W / H;
        if (w / h > ar) { var nh = w / ar; y -= (nh - h) / 2; h = nh; }
        else { var nw = h * ar; x -= (nw - w) / 2; w = nw; }

        to = [x, y, w, h];
      }
      var vb = svg.viewBox.baseVal;
      var from = [vb.x, vb.y, vb.width || W, vb.height || H];
      if (!animate) { svg.setAttribute('viewBox', to.join(' ')); return api; }

      var t0 = performance.now(), DUR = 900;
      function step(now) {
        var t = Math.min(1, (now - t0) / DUR);
        var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
        svg.setAttribute('viewBox', from.map(function (v, i) {
          return (v + (to[i] - v) * e).toFixed(2);
        }).join(' '));
        focusRaf = t < 1 ? requestAnimationFrame(step) : null;
      }
      focusRaf = requestAnimationFrame(step);
      return api;
    };

    return api;
  }

  global.Atlas = {
    create: create,
    CLUSTER_PX: CLUSTER_PX,
    // Exposed for tests only — pure maths, no DOM.
    _merc: merc,
    _cluster: cluster
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
