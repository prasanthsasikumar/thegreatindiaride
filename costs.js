/*
 * costs.js — projects the template's cost from what the ride actually cost.
 *
 * There are no invented rates here. Every figure is derived from route.json's
 * already-published aggregates: 93 nights, what was paid for beds, and what was paid
 * for everything else. Those observed per-night rates are applied to the template's
 * shape.
 *
 * The template is a route, not a schedule — it has no nights of its own. Days are
 * estimated from riding hours at an hours-per-day figure that comes from
 * template-notes.json and is SHOWN TO THE READER. Do not bury it.
 *
 * Loaded by both index.html and booklet.html, same as atlas.js — kept in the same
 * ES5-flavoured style and free of any DOM dependency, so it also runs headless
 * under node:vm in tests.
 */
(function (global) {
  'use strict';

  function project(route, template, hoursPerDay) {
    var stops = route.stops || [];
    // manifest.route (as inlined by generate-manifest.cjs) carries nights at the top
    // level; the standalone route.json nests it under totals. Accept either shape.
    var nights = (route.totals && route.totals.nights) || route.nights || 0;
    var stay = stops.reduce(function (a, s) { return a + (s.stayCost || 0); }, 0);
    var spend = stops.reduce(function (a, s) { return a + (s.spend || 0); }, 0);
    var other = spend - stay;

    var perNight = {
      stay: nights ? stay / nights : 0,
      other: nights ? other / nights : 0,
      total: nights ? spend / nights : 0,
    };

    var hpd = hoursPerDay || 6;
    var sectors = (template.sectors || []).map(function (s) {
      var days = Math.ceil(s.hours / hpd);
      return {
        id: s.id,
        days: days,
        stay: Math.round(days * perNight.stay),
        other: Math.round(days * perNight.other),
        total: Math.round(days * perNight.total),
      };
    });

    return {
      nights: nights,
      observed: { stay: stay, other: other, total: spend },
      perNight: perNight,
      hoursPerDay: hpd,
      sectors: sectors,
      days: sectors.reduce(function (a, s) { return a + s.days; }, 0),
      total: sectors.reduce(function (a, s) { return a + s.total; }, 0),
    };
  }

  global.Costs = { project: project };
})(typeof globalThis !== 'undefined' ? globalThis : this);
