/* Space Invaders engine — canvas, pixel sprites, pilot modes (brain/random/human). */
(function () {
  "use strict";

  var W = 600, H = 640;
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");

  var COLORS = {
    alien: getCss("--amber"),
    ship: getCss("--phosphor"),
    shield: getCss("--phosphor-dim"),
    bullet: getCss("--ink"),
    text: getCss("--phosphor"),
    textDim: getCss("--phosphor-dim"),
    danger: getCss("--danger"),
  };
  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---- sprites (1 = pixel), 2x scale ---- */

  var SPR = {
    squid: [
      ["00011000", "00111100", "01111110", "11011011", "11111111", "00100100", "01011010", "10100101"],
      ["00011000", "00111100", "01111110", "11011011", "11111111", "01011010", "10000001", "01000010"],
    ],
    crab: [
      ["00100000100", "00010001000", "00111111100", "01101110110", "11111111111", "10111111101", "10100000101", "00011011000"],
      ["00100000100", "10010001001", "10111111101", "11101110111", "11111111111", "01111111110", "00100000100", "01000000010"],
    ],
    octo: [
      ["000011110000", "011111111110", "111111111111", "111001100111", "111111111111", "000110011000", "001101101100", "110000000011"],
      ["000011110000", "011111111110", "111111111111", "111001100111", "111111111111", "001110011100", "011001100110", "001100001100"],
    ],
    ship: [
      ["0000001000000", "0000011100000", "0000011100000", "0111111111110", "1111111111111", "1111111111111", "1111111111111", "1111111111111"],
    ],
    burst: [
      ["01000100010", "00101010100", "10000000001", "01001001001", "00100000010", "10010010010", "01000100010"],
    ],
  };

  function drawSprite(m, x, y, scale, color) {
    ctx.fillStyle = color;
    for (var r = 0; r < m.length; r++) {
      var row = m[r];
      for (var c = 0; c < row.length; c++) {
        if (row[c] === "1") ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
      }
    }
  }

  function spriteW(m, scale) { return m[0].length * scale; }
  function spriteH(m, scale) { return m.length * scale; }

  /* ---- tuning ---- */

  var COLS = 10, ROWS = 5;
  var CELL_W = 36, CELL_H = 32;
  var GRID_X = (W - COLS * CELL_W) / 2 + 6, GRID_Y = 90;
  var ALIEN_SCALE = 2;
  var SHIP_Y = 588;
  var SHIELD_Y = 516;
  var INVASION_Y = SHIP_Y - 34;
  var BEAT_MIN = 80, BEAT_BASE = 20;   // ms per march step = max(80, alive*20) * waveScale
  var STEP_X = 10, STEP_DOWN = 20;
  var BULLET_SPEED = 640, BOMB_SPEED = 160, SHIP_SPEED = 230;
  var ROW_SCORE = [30, 20, 20, 10, 10];
  var ROW_KIND = ["squid", "crab", "crab", "octo", "octo"];
  var MAX_BOMBS = 2;

  /* ---- state ---- */

  var G = {
    mode: "idle",            // idle | brain | random | human | over
    score: 0, hi: 0, wave: 1, lives: 3, kills: 0,
    aliens: [], dir: 1, beatT: 0, frame: 0,
    bombs: [], bullet: null, shipX: W / 2,
    shipDir: 0, gunCool: 0, deadT: 0, _outcomes: [],
    shields: [], bursts: [],
    startedAt: 0, episodeStart: null, overT: 0,
  };

  var params = new URLSearchParams(location.search);
  try { G.hi = parseInt(localStorage.getItem("jev-hi") || "0", 10) || 0; } catch (e) {}

  function makeShields() {
    G.shields = [];
    var shape = [
      "0111111111111111111110",
      "1111111111111111111111",
      "1111111111111111111111",
      "1111100000000000011111",
      "1111000000000000001111",
      "1110000000000000000111",
    ];
    for (var i = 0; i < 4; i++) {
      G.shields.push({ x: 62 + i * 134, y: SHIELD_Y, grid: shape.map(function (r) { return r.split(""); }) });
    }
  }

  function spawnWave() {
    G.aliens = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        G.aliens.push({
          row: r, col: c,
          x: GRID_X + c * CELL_W, y: GRID_Y + (G.wave - 1) * 12 + r * CELL_H,
          alive: true, kind: ROW_KIND[r], score: ROW_SCORE[r],
        });
      }
    }
    G.dir = 1; G.beatT = 0; G.frame = 0;
    G.bombs = []; G.bullet = null;
    makeShields();
  }

  function resetGame(mode) {
    G.mode = mode;
    G.paused = false;
    for (var k in keys) keys[k] = false;
    if (mode === "brain" || mode === "random" || mode === "human") {
      G._flightMode = mode;
      G._epN = (G._epN || 0) + 1;
    }
    G.score = 0; G.wave = 1; G.lives = 3; G.kills = 0;
    G.shipX = W / 2; G.shipDir = 0; G.gunCool = 0; G.deadT = 0;
    G.bursts = [];
    spawnWave();
    G.startedAt = performance.now();
    G.episodeStart = G.startedAt;
    if (window.JEVTELE) window.JEVTELE.start(mode);
    hud();
  }

  /* ---- DOM HUD ---- */

  var el = {
    score: document.getElementById("score"),
    hi: document.getElementById("hi"),
    wave: document.getElementById("wave"),
    ep: document.getElementById("epNum"),
    lives: document.getElementById("lives"),
    hint: document.getElementById("stageHint"),
  };

  function hud() {
    el.score.textContent = G.score;
    el.hi.textContent = G.hi;
    el.wave.textContent = G.wave;
    el.ep.textContent = G._epN || 0;
    var s = "";
    for (var i = 0; i < G.lives; i++) s += "▲ ";
    el.lives.textContent = s.trim();
    var lab = window.LAB || {};
    var overMsg = lab.autoloop !== false && (G._flightMode === "brain" || G._flightMode === "random")
      ? "Game over. Autoloop is on: next episode in a moment."
      : "Game over. Pick a pilot to fly again.";
    el.hint.textContent = {
      idle: "Pick a pilot: BRAIN (jevos-v4 decides), RANDOM (coin flips), or YOU (arrow keys + space).",
      brain: "jevos-v4 is flying. Watch the panel: that is the actual request wire.",
      random: "A coin flip is flying. Same controls as the brain, zero intelligence.",
      human: "You are flying. Arrows to move, space to fire.",
      over: overMsg,
    }[G.mode];
  }

  /* ---- pilot input ---- */

  document.querySelectorAll(".mode-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var m = btn.dataset.mode;
      if (m === "reset") {
        // on the game-over screen RESET means "restart this pilot", not "reset into over"
        resetGame(G.mode === "over" ? (G._flightMode || "human") : G.mode);
        return;
      }
      setPressed(m);
      resetGame(m);
    });
  });

  function setPressed(mode) {
    document.querySelectorAll(".mode-btn[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });
  }

  var keys = {};
  addEventListener("keydown", function (e) {
    if (e.key === "p" || e.key === "P") {
      if (G.mode === "brain" || G.mode === "random" || G.mode === "human") G.paused = !G.paused;
      return;
    }
    if (G.mode === "over" && (e.key === " " || e.key === "Enter") && G.overT > 1.2) {
      resetGame(G._flightMode || "human");   // fly again from the keyboard, after the pause to read the score
      return;
    }
    if (G.mode !== "human") return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ") e.preventDefault();
    keys[e.key] = true;
  });
  addEventListener("keyup", function (e) { keys[e.key] = false; });

  /* ---- brain wire (defined here, driven by brain.js) ---- */

  window.JEVGAME = {
    state: G,
    W: W, H: H,
    episodes: [],
    reset: resetGame,
    setPressed: setPressed,
    lineOfFire: lineOfFire,
    firingRate: firingRate,
    /* brain.js applies one judgment here; the LAB toggles decide who owns each call */
    applyBrain: function (d) {
      if (G.mode !== "brain") return "IDLE";
      var lab = window.LAB || {};
      var dangerP = typeof lab.dangerP === "number" ? lab.dangerP : 0.5;
      var fireP = typeof lab.fireP === "number" ? lab.fireP : 0.5;
      var applied = "HOLD";
      var shipCx = G.shipX + 13;
      if (d.danger > dangerP && G.bombs.length) {
        var nowMs = performance.now();
        if (G._dodgeUntil && nowMs < G._dodgeUntil) {
          // committed dodge: no flip-flopping between ticks (deaths danced under bombs)
          G.shipDir = G._dodgeDir;
          applied = "DODGE " + (G._dodgeDir > 0 ? "RIGHT" : "LEFT") + " (committed)";
        } else if (lab.jevDodge !== false) {
          // direction: the lane with the most clearance from EVERY bomb column
          var dir, best = -1;
          [1, -1].forEach(function (dtry) {
            var m = Infinity;
            G.bombs.forEach(function (b) { m = Math.min(m, Math.abs(b.x - (shipCx + dtry * 40))); });
            if (m > best) { best = m; dir = dtry; }
          });
          G._dodgeDir = dir;
          G._dodgeUntil = nowMs + 400;
          G.shipDir = dir;
          applied = "DODGE " + (dir > 0 ? "RIGHT" : "LEFT") + " (clear lane)";
        } else {
          // reflex: geometry moves the ship away from the lowest bomb
          var nb = G.bombs.reduce(function (m, b) { return b.y > m.y ? b : m; });
          G.shipDir = nb.x < shipCx ? 1 : -1;
          applied = "REFLEX DODGE " + (G.shipDir > 0 ? "RIGHT" : "LEFT");
        }
      } else {
        if (lab.jevSteer !== false) {
          // jev says which side the target is on; the engine executes it proportionally
          var aliveP = G.aliens.filter(function (a) { return a.alive; });
          var lowP = aliveP.length ? aliveP.reduce(function (m, a) { return a.y > m.y ? a : m; }) : null;
          var cxP = G.shipX + 13;
          if (lowP && Math.abs(lowP.x + 10 - cxP) < 12) {
            G.shipDir = 0; applied = "ON TARGET";
          } else if (d.alien_left > 0.55)      { G.shipDir = -1; applied = "PATROL LEFT"; }
          else if (d.alien_left < 0.45)        { G.shipDir = 1;  applied = "PATROL RIGHT"; }
          else                                 { G.shipDir = 0;  applied = "HOLD"; }
        } else {
          // reflex: steer under the lowest alien
          var alive = G.aliens.filter(function (a) { return a.alive; });
          if (alive.length) {
            var low = alive.reduce(function (m, a) { return a.y > m.y ? a : m; });
            var dx = low.x + 10 - shipCx;
            if (Math.abs(dx) > 8) { G.shipDir = dx > 0 ? 1 : -1; applied = "REFLEX PATROL " + (dx > 0 ? "RIGHT" : "LEFT"); }
            else { G.shipDir = 0; applied = "REFLEX AIMED"; }
          } else { G.shipDir = 0; }
        }
      }
      if (d.fire > fireP) {
        // jev decides WHEN to shoot; the gun only fires shots the march won't break
        if (G.bullet || G.gunCool > 0) applied += " + FIRE HELD (gun busy)";
        else if (shotWillHit()) { fire(); applied += " + FIRE"; }
        else applied += " + FIRE HELD (no shot line)";
      }
      return applied;
    },
    randomTick: function () {
      if (G.mode !== "random") return;
      var r = Math.random();
      G.shipDir = r < 0.34 ? -1 : r < 0.68 ? 1 : 0;
      if (Math.random() < 0.35) fire();
    },
  };

  function fire() {
    if (G.bullet || G.gunCool > 0 || G.deadT > 0) return;
    G.bullet = { x: G.shipX + 12, y: SHIP_Y - 10 };   // gun is at the ship's center
    G.gunCool = 120;
    G.lastShotAt = performance.now();
    if (window.JEVTELE) {
      var stack = lineOfFire();
      window.JEVTELE.shot({ aligned: stack > 0, stack: stack, bulletX: G.bullet.x });
    }
  }

  /* the one alignment truth: does the bullet's column overlap an alien's body?
     used by the fire gate, the shot telemetry and the state text alike */
  function lineOfFire() {
    var bx = G.shipX + 12, bt = bx + 2, n = 0;
    G.aliens.forEach(function (a) {
      if (!a.alive) return;
      var w = spriteW(SPR[a.kind], ALIEN_SCALE);
      if (a.x <= bt && a.x + w >= bx) n++;
    });
    return n;
  }

  /* is the fleet's LOWEST alien in the bullet's column? settle-and-fire condition:
     bottom-up clearing means max points, shortest flights, slowest invasion */
  function lowestInColumn() {
    var bx = G.shipX + 12, bt = bx + 2;
    var low = null;
    G.aliens.forEach(function (a) {
      if (a.alive && (!low || a.y > low.y)) low = a;
    });
    if (!low) return false;
    var w = spriteW(SPR[low.kind], ALIEN_SCALE);
    return low.x <= bt && low.x + w >= bx;
  }

  /* firing rate: 100% = a shot leaves the gun the instant it is ready again
     (cycle = 120ms reload + bullet flight), 0% = the gun never speaks */
  function firingRate() {
    if (!G.episodeStart || (G.mode !== "brain" && G.mode !== "random" && G.mode !== "human")) return null;
    var shots = window.JEVTELE ? window.JEVTELE.grade() : null;
    if (!shots) return null;
    var elapsed = performance.now() - G.episodeStart;
    if (elapsed < 2000) return null;      // too early to mean anything
    var cycle = 120 + (G.avgFlightMs || 550);
    return Math.max(0, Math.min(1, shots.shots / (elapsed / cycle)));
  }

  /* will THIS shot connect? replays the deterministic march for one bullet flight:
     column, beat timing, wall flips and shield blocks all included. The brain still
     decides when to pull the trigger; the gun just refuses shots it would waste. */
  function shotWillHit() {
    if (G.bullet || G.gunCool > 0 || G.deadT > 0) return false;
    var bx = G.shipX + 12;
    if (shieldBlocks(bx)) return false;
    var sim = [];
    G.aliens.forEach(function (a) {
      if (!a.alive) return;
      sim.push({ x: a.x, y: a.y, w: spriteW(SPR[a.kind], ALIEN_SCALE), h: spriteH(SPR[a.kind], ALIEN_SCALE) });
    });
    if (!sim.length) return false;
    var dir = G.dir, interval = beatInterval() / 1000;
    var gap = Math.max(0.001, (beatInterval() - G.beatT) / 1000);  // time to the next real beat
    var py = SHIP_Y - 10;                                          // bullet top, decreasing
    for (var guard = 0; guard < 80 && py > 0; guard++) {
      var next = py - BULLET_SPEED * gap;      // bullet top after this march beat
      for (var i = 0; i < sim.length; i++) {
        var a = sim[i];
        // bullet sweep [next, py] (top edge) vs alien band [a.y, a.y + h] — mirrors stepBullet
        if (next <= a.y + a.h && py >= a.y && bx >= a.x && bx <= a.x + a.w) return true;
      }
      // the beat: same flip rule as march()
      var flip = false;
      sim.forEach(function (a) {
        if ((dir > 0 && a.x + a.w + STEP_X > W - 12) || (dir < 0 && a.x - STEP_X < 12)) flip = true;
      });
      if (flip) sim.forEach(function (a) { a.y += STEP_DOWN; });
      else sim.forEach(function (a) { a.x += STEP_X * dir; });
      py = next;
      gap = interval;
    }
    return false;
  }

  /* would a bullet rising from bx be eaten by a shield on its way out? */
  function shieldBlocks(bx) {
    for (var i = 0; i < G.shields.length; i++) {
      var s = G.shields[i];
      var px = Math.floor((bx - s.x) / 4);
      for (var r = 0; r < s.grid.length; r++) {
        for (var dx = 0; dx <= 1; dx++) {
          var gx = px + dx;
          if (gx >= 0 && gx < s.grid[0].length && s.grid[r][gx] === "1") return true;
        }
      }
    }
    return false;
  }

  function stepBullet(dt) {
    if (!G.bullet) return;
    var y0 = G.bullet.y;
    G.bullet.y -= BULLET_SPEED * dt;
    var y1 = G.bullet.y;
    var outcome = null;
    if (y1 < 0) outcome = "miss";
    else {
      // swept shield test: sample the segment so fast bullets can't tunnel through
      for (var sy = y0; sy >= y1 && !outcome; sy -= 4) {
        if (shieldHit(G.bullet.x, Math.max(sy, y1), 1)) outcome = "shield";
      }
    }
    if (!outcome) {
      for (var i = 0; i < G.aliens.length; i++) {
        var a = G.aliens[i];
        if (!a.alive) continue;
        var sw = spriteW(SPR[a.kind], ALIEN_SCALE), sh = spriteH(SPR[a.kind], ALIEN_SCALE);
        // swept hit: the top edge crossed the alien band during this step
        if (G.bullet.x >= a.x && G.bullet.x <= a.x + sw && y1 <= a.y + sh && y0 >= a.y) {
          a.alive = false;
          G.score += a.score; G.kills++;
          boom(a.x + sw / 2, a.y + sh / 2);
          outcome = "hit";
          if (window.JEVTELE) window.JEVTELE.shotOutcome("hit", a.score);
          break;
        }
      }
    }
    if (outcome) {
      if (outcome !== "hit" && window.JEVTELE) window.JEVTELE.shotOutcome(outcome, 0);
      if (G.lastShotAt) {
        var f = performance.now() - G.lastShotAt;
        G.avgFlightMs = G.avgFlightMs ? G.avgFlightMs * 0.7 + f * 0.3 : f;
      }
      G._outcomes.push(outcome);
      if (G._outcomes.length > 30) G._outcomes.shift();
      G.bullet = null;
    }
  }

  function stepBombs(dt) {
    for (var bi = G.bombs.length - 1; bi >= 0; bi--) {
      var b = G.bombs[bi];
      b.y += BOMB_SPEED * dt;
      var gone = false;
      if (b.y > H - 8) {
        gone = true;
        if (window.JEVTELE) window.JEVTELE.bombResolved("landed", Math.abs(b.x - (G.shipX + 13)) < 30);
      } else if (shieldHit(b.x, b.y, 2)) {
        gone = true;
        if (window.JEVTELE) window.JEVTELE.bombResolved("shield", false);
      }
      if (!gone && G.deadT <= 0) {
        var sx = G.shipX, sy = SHIP_Y, sw2 = spriteW(SPR.ship[0], 2), sh2 = spriteH(SPR.ship[0], 2);
        if (b.x >= sx && b.x <= sx + sw2 && b.y >= sy && b.y <= sy + sh2) {
          gone = true;
          // death forensics: what did jev see just before the bomb landed?
          (window.JEVDEATHS = window.JEVDEATHS || []).push({
            t: new Date().toISOString(),
            bombX: Math.round(b.x), shipX: Math.round(sx),
            bombsInAir: G.bombs.length,
            lastDanger: window.JEVLOG && window.JEVLOG.rows.length
              ? window.JEVLOG.rows[window.JEVLOG.rows.length - 1].danger : null,
          });
          if (window.JEVTELE) window.JEVTELE.bombResolved("ship", false);
          G.lives--;
          hud();   // the lives arrows must move the moment a life is spent
          if (window.JEVTELE) window.JEVTELE.death();
          boom(sx + sw2 / 2, sy + sh2 / 2, true);
          if (G.lives <= 0) {
            endEpisode("shot");
            return;
          }
          G.deadT = 900;
        }
      }
      if (gone) G.bombs.splice(bi, 1);
    }
  }

  /* ---- shields ---- */

  function shieldHit(x, y, radius) {
    for (var i = 0; i < G.shields.length; i++) {
      var s = G.shields[i];
      var cw = 4;
      var px = Math.floor((x - s.x) / cw), py = Math.floor((y - s.y) / cw);
      if (px < 0 || py < 0 || py >= s.grid.length || px >= s.grid[0].length) continue;
      if (s.grid[py][px] === "1") {
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            var gy = py + dy, gx = px + dx;
            if (gy >= 0 && gy < s.grid.length && gx >= 0 && gx < s.grid[0].length && s.grid[gy][gx] === "1") {
              s.grid[gy][gx] = "0";
            }
          }
        }
        return true;
      }
    }
    return false;
  }

  /* ---- step ---- */

  function beatInterval() {
    var alive = G.aliens.filter(function (a) { return a.alive; }).length;
    return Math.max(BEAT_MIN, alive * BEAT_BASE) * Math.pow(0.93, G.wave - 1);
  }

  function march() {
    var lowestByCol = {};
    G.aliens.forEach(function (a) {
      if (!a.alive) return;
      if (!lowestByCol[a.col] || a.y > lowestByCol[a.col].y) lowestByCol[a.col] = a;
    });
    var flip = false;
    G.aliens.forEach(function (a) {
      if (!a.alive) return;
      if ((G.dir > 0 && a.x + spriteW(SPR[a.kind], ALIEN_SCALE) + STEP_X > W - 12) ||
          (G.dir < 0 && a.x - STEP_X < 12)) flip = true;
    });
    if (flip) {
      G.dir = -G.dir;
      G.aliens.forEach(function (a) { if (a.alive) a.y += STEP_DOWN; });
    } else {
      G.aliens.forEach(function (a) { if (a.alive) a.x += STEP_X * G.dir; });
    }
    G.frame = 1 - G.frame;

    // drop a bomb from the lowest alien of a random column
    var cols = Object.keys(lowestByCol);
    if (cols.length && G.bombs.length < MAX_BOMBS && Math.random() < 0.3) {
      var a = lowestByCol[cols[(Math.random() * cols.length) | 0]];
      G.bombs.push({ x: a.x + spriteW(SPR[a.kind], ALIEN_SCALE) / 2, y: a.y + spriteH(SPR[a.kind], ALIEN_SCALE) });
      if (window.JEVTELE) window.JEVTELE.bombSpawn();
    }

    // invasion check
    var reached = G.aliens.some(function (a) { return a.alive && a.y + spriteH(SPR[a.kind], ALIEN_SCALE) >= INVASION_Y; });
    if (reached) gameOver();
  }

  function boom(x, y, big) {
    G.bursts.push({ x: x, y: y, t: 0, big: big });
  }

  function endEpisode(reason) {
    G.mode = "over";
    G.overT = 0;
    G.hi = Math.max(G.hi, G.score);
    try { localStorage.setItem("jev-hi", String(G.hi)); } catch (e) {}
    var rec = {
      mode: G._flightMode || "brain",
      score: G.score, kills: G.kills, lives: G.lives,
      seconds: Math.round((performance.now() - G.episodeStart) / 100) / 10,
      wave: G.wave,
      ended: reason,
    };
    window.JEVGAME.episodes.push(rec);
    if (window.JEVTELE) window.JEVTELE.finish(rec);
    hud();
    maybeAutoRestart();
  }

  function gameOver() {
    endEpisode("invasion");
  }

  function maybeAutoRestart() {
    if (params.get("auto") === "1") {
      var target = parseInt(params.get("episodes") || "0", 10);
      if (target && window.JEVGAME.episodes.length >= target) {
        window.__episodesDone = true;
        return;
      }
      var m = params.get("mode") || "brain";
      setTimeout(function () { setPressed(m); resetGame(m); }, 700);
      return;
    }
    // interactive autoloop (LAB toggle): keep the show running
    var lab = window.LAB || {};
    var mode = G._flightMode;
    if (lab.autoloop !== false && (mode === "brain" || mode === "random")) {
      setTimeout(function () {
        if (G.mode === "over" && G._flightMode === mode) resetGame(mode);
      }, 2500);
    }
  }

  function update(dt) {
    if (G.paused) return;
    if (G.mode === "over") {
      G.overT += dt;
      G.bursts.forEach(function (b) { b.t += dt; });
      G.bursts = G.bursts.filter(function (b) { return b.t < 0.35; });
      return;
    }
    if (G.mode === "idle") return;

    if (params.get("auto") === "1") {
      var cap = parseFloat(params.get("cap") || "0");
      if (cap && performance.now() - G.episodeStart > cap * 1000) {
        endEpisode("capped");
        return;
      }
    }

    if (G.deadT > 0) {           // ship respawn pause: ship and march freeze, projectiles don't
      G.deadT -= dt * 1000;      // deadT is milliseconds
      stepBullet(dt);
      stepBombs(dt);
      G.bursts.forEach(function (b) { b.t += dt; });
      G.bursts = G.bursts.filter(function (b) { return b.t < 0.35; });
      return;
    }

    // ship
    if (G.mode === "human") {
      var d = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      G.shipX += d * SHIP_SPEED * dt;
      if (keys[" "]) fire();
    } else {
      G.shipX += G.shipDir * SHIP_SPEED * dt;
    }
    G.shipX = Math.max(16, Math.min(W - 16 - spriteW(SPR.ship[0], 2), G.shipX));
    if (G.gunCool > 0) G.gunCool -= dt * 1000;

    // direction flip tracking (oscillation grade)
    var sign = G.shipDir > 0 ? 1 : G.shipDir < 0 ? -1 : 0;
    if (sign !== 0) {
      if (G._lastSign && sign !== G._lastSign && window.JEVTELE) window.JEVTELE.flip();
      G._lastSign = sign;
    }

    // march
    G.beatT += dt * 1000;
    if (G.beatT >= beatInterval()) { G.beatT = 0; march(); }

    // bullet + bombs (shared with the respawn pause, where the ship itself is frozen)
    stepBullet(dt);
    stepBombs(dt);
    if (G.mode === "over") return;   // a lethal bomb during stepBombs ended the episode

    // wave clear
    if (!G.aliens.some(function (a) { return a.alive; })) {
      G.wave++;
      spawnWave();
    }

    G.bursts.forEach(function (b) { b.t += dt; });
    G.bursts = G.bursts.filter(function (b) { return b.t < 0.35; });
  }

  /* ---- render ---- */

  function centerText(txt, y, size, color) {
    ctx.font = size + 'px "Press Start 2P", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(txt, W / 2, y);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    G.shields.forEach(function (s) {
      ctx.fillStyle = COLORS.shield;
      for (var r = 0; r < s.grid.length; r++) {
        for (var c = 0; c < s.grid[r].length; c++) {
          if (s.grid[r][c] === "1") ctx.fillRect(s.x + c * 4, s.y + r * 4, 4, 4);
        }
      }
    });

    G.aliens.forEach(function (a) {
      if (!a.alive) return;
      drawSprite(SPR[a.kind][G.frame], a.x, a.y, ALIEN_SCALE, COLORS.alien);
    });

    if (G.mode !== "over" && G.deadT <= 0) {
      drawSprite(SPR.ship[0], G.shipX, SHIP_Y, 2, COLORS.ship);
    }
    if (G.bullet) {
      ctx.fillStyle = COLORS.bullet;
      ctx.fillRect(G.bullet.x, G.bullet.y, 2, 8);
    }
    ctx.fillStyle = COLORS.alien;
    G.bombs.forEach(function (b) { ctx.fillRect(b.x - 1, b.y, 2, 6); });

    G.bursts.forEach(function (b) {
      if (b.t < 0.35) drawSprite(SPR.burst[0], b.x - 11, b.y - 7, b.big ? 2 : 1.6, b.big ? COLORS.ship : COLORS.bullet);
    });

    if (G.mode === "idle") {
      centerText("SPACE INVADERS", 250, 20, COLORS.text);
      centerText("A 0.9B CLASSIFIER", 290, 8, COLORS.textDim);
      centerText("IS THE PILOT", 306, 8, COLORS.textDim);
      centerText("PICK A PILOT ABOVE", 380, 10, COLORS.text);
    }
    if (G.mode === "over") {
      ctx.fillStyle = "oklch(0.10 0 0 / 0.72)";
      ctx.fillRect(0, 230, W, 140);
      centerText("GAME OVER", 290, 20, COLORS.danger);
      centerText("SCORE " + G.score + "   WAVE " + G.wave, 330, 10, COLORS.text);
      centerText("SPACE TO FLY AGAIN · OR PICK A PILOT", 352, 8, COLORS.textDim);
    }
    if (G.paused) {
      ctx.fillStyle = "oklch(0.10 0 0 / 0.78)";
      ctx.fillRect(0, 260, W, 90);
      centerText("PAUSED", 300, 16, COLORS.text);
      centerText("PRESS P TO RESUME", 328, 8, COLORS.textDim);
    }
  }

  /* ---- main loop ---- */

  var last = performance.now();
  function loop(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  hud();
  spawnWave();          // pretty background while idle
  G.mode = "idle";

  // grade strip (reads telemetry; shields integrity is game-side state)
  var gradeEl = document.getElementById("gradebar");
  var rateStrip = document.getElementById("rateStrip");
  var precStrip = document.getElementById("precStrip");
  var rateCtx = rateStrip ? rateStrip.getContext("2d") : null;
  var precCtx = precStrip ? precStrip.getContext("2d") : null;
  var rateHist = [], precHist = [];

  function drawMini(ctx2, hist, starve) {
    var w = ctx2.canvas.width, h = ctx2.canvas.height;
    ctx2.clearRect(0, 0, w, h);
    ctx2.fillStyle = getCss("--surface-2");
    ctx2.fillRect(0, 0, w, h);
    var n = hist.length, bw = 3, gap = 1;
    for (var i = 0; i < n; i++) {
      var v = hist[i];
      var x = w - (n - i) * (bw + gap);
      if (v === null) {   // no data yet: dim tick
        ctx2.fillStyle = getCss("--line");
        ctx2.fillRect(x, h - 2, bw, 2);
        continue;
      }
      ctx2.fillStyle = getCss(v < starve ? "--amber" : "--phosphor");
      var bh = Math.max(2, v * (h - 4));
      ctx2.fillRect(x, h - bh, bw, bh);
    }
  }

  setInterval(function () {
    if (!gradeEl || !window.JEVTELE) return;
    var g = window.JEVTELE.grade();
    if (!g) return;
    var integ = window.JEVTELE.integrity(G.shields);
    var acc = g.acc === null ? "—" : Math.round(g.acc * 100) + "%";
    var fr = firingRate();
    var parts = [
      "SHOTS " + g.shots,
      "ACC " + acc + (g.lastShot ? " · LAST " + g.lastShot.outcome : ""),
      "RATE " + (fr === null ? "—" : Math.round(fr * 100) + "%"),
      "WASTED " + g.wasted,
      "CLOSE CALLS " + g.closeCalls,
      "SHIELDS " + Math.round(integ.pct * 100) + "%",
      "FLIPS " + g.flipsPerSec.toFixed(1) + "/S",
    ];
    gradeEl.textContent = parts.join("   ·   ");

    // gun charts: rate over time + rolling precision (last 30 shots)
    if (rateCtx && (G.mode === "brain" || G.mode === "random" || G.mode === "human")) {
      rateHist.push(fr);
      if (rateHist.length > 98) rateHist.shift();
      drawMini(rateCtx, rateHist, 0.15);
      var oc = G._outcomes;
      if (oc.length) {
        var hits = oc.filter(function (o) { return o === "hit"; }).length;
        precHist.push(hits / oc.length);
      } else precHist.push(null);
      if (precHist.length > 98) precHist.shift();
      drawMini(precCtx, precHist, 0.5);
    }
  }, 400);
  if (params.get("auto") === "1") {
    var m0 = params.get("mode") || "brain";
    G._flightMode = m0;
    setPressed(m0);
    resetGame(m0);
  }
  requestAnimationFrame(loop);
})();
