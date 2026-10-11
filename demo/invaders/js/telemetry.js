/* Telemetry: per-event grading of shots, bombs, dodges; per-episode grades.
   game.js calls window.JEVTELE hooks; the grade strip reads window.JEVTELE.grade(). */
(function () {
  "use strict";

  var T = {
    episodes: [],          // finished grade records (last 20)
    cur: null,
  };

  function newEpisode(mode) {
    T.cur = {
      mode: mode,
      shots: 0, hits: 0, points: 0, wasted: 0, shieldHitsByShot: 0, misses: 0,
      closeCalls: 0, bombsSeen: 0, deaths: 0,
      flips: 0, ticks: 0, alignedTicks: 0,
      lastShot: null,          // {outcome, aligned, points}
      startedAt: performance.now(),
    };
  }

  function shieldIntegrity(shields) {
    // returns {pct: avg integrity across surviving shields, n: alive count}
    var total = 0, full = 0, n = 0;
    shields.forEach(function (s) {
      var ones = 0, cells = 0;
      s.grid.forEach(function (row) {
        row.forEach(function (c) { cells++; if (c === "1") ones++; });
      });
      if (cells > 0) { n++; total += ones / cells; full += ones; }
    });
    return { pct: n ? total / n : 0, n: n };
  }

  window.JEVTELE = {
    episodes: T.episodes,

    start: function (mode) { newEpisode(mode); },

    shot: function (info) {
      // info: {aligned, stack, bulletX}
      var e = T.cur; if (!e) return;
      e.shots++;
      if (!info.aligned) e.wasted++;
      e.lastShot = { outcome: "in flight", aligned: info.aligned, points: 0 };
      e.shotsLog = e.shotsLog || [];
      e.shotsLog.push({ col: info.bulletX !== undefined ? Math.round(info.bulletX / 60) : null,
                        outcome: "in flight", points: 0 });
    },

    shotOutcome: function (outcome, points) {
      var e = T.cur; if (!e) return;
      if (outcome === "hit") { e.hits++; e.points += points || 0; }
      if (outcome === "shield") e.shieldHitsByShot++;
      if (outcome === "miss") e.misses++;
      if (e.lastShot) e.lastShot.outcome = outcome === "hit" ? "HIT +" + points : outcome.toUpperCase();
      if (e.shotsLog && e.shotsLog.length) {
        for (var i = e.shotsLog.length - 1; i >= 0; i--) {
          if (e.shotsLog[i].outcome === "in flight") {
            e.shotsLog[i].outcome = outcome;
            e.shotsLog[i].points = points || 0;
            break;
          }
        }
      }
    },

    recentShots: function () {
      var e = T.cur; if (!e || !e.shotsLog) return [];
      return e.shotsLog.slice(-3).map(function (s) {
        if (s.outcome === "hit") return "col " + s.col + " hit alien, +" + s.points;
        if (s.outcome === "shield") return "col " + s.col + " hit a shield";
        if (s.outcome === "miss") return "col " + s.col + " missed, touched the top";
        return "col " + s.col + " in flight";
      });
    },

    bombSpawn: function () { if (T.cur) T.cur.bombsSeen++; },

    bombResolved: function (kind, nearShip) {
      var e = T.cur; if (!e) return;
      if (kind === "landed" && nearShip) e.closeCalls++;
    },

    death: function () { if (T.cur) T.cur.deaths++; },

    tick: function (aligned) {
      var e = T.cur; if (!e) return;
      e.ticks++;
      if (aligned) e.alignedTicks++;
    },

    flip: function () { if (T.cur) T.cur.flips++; },

    integrity: shieldIntegrity,

    grade: function () {
      var e = T.cur; if (!e) return null;
      var secs = Math.max(0.001, (performance.now() - e.startedAt) / 1000);
      return {
        mode: e.mode,
        shots: e.shots,
        acc: e.shots ? e.hits / e.shots : null,
        wasted: e.wasted,
        closeCalls: e.closeCalls,
        deaths: e.deaths,
        shieldPct: null,          // filled by game.js at read time
        flipsPerSec: e.flips / secs,
        alignedShare: e.ticks ? e.alignedTicks / e.ticks : null,
        lastShot: e.lastShot,
      };
    },

    finish: function (extra) {
      var e = T.cur; if (!e) return;
      var g = window.JEVTELE.grade();
      Object.assign(g, extra || {});
      T.episodes.push(g);
      if (T.episodes.length > 20) T.episodes.shift();
    },
  };

  newEpisode("idle");
})();
