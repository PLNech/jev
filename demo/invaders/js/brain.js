/* Brain wiring: serialize game state -> one batched jev request -> HUD + actions.
   Configuration from study.py (demo/study.json): prose world + rubric legend.
   jev owns steering (alien side), dodging (bomb side + danger), firing, panic. */
(function () {
  "use strict";

  var JG = window.JEVGAME;
  var G = JG.state, W = JG.W;

  var URL_CPU = "/v1/systemone";
  var URL_GPU = "/v1/gpu/systemone";
  var TICK_MS = 260;

  var $ = function (id) { return document.getElementById(id); };
  var dom = {
    led: $("led"), ledLabel: $("ledLabel"),
    wireState: $("wireState"), wireErr: $("wireErr"),
    dangerBar: $("dangerBar"), dangerAns: $("dangerAns"),
    fireBar: $("fireBar"), fireAns: $("fireAns"),
    bombSideBar: $("bombSideBar"), bombSideAns: $("bombSideAns"),
    applied: $("applied"),
    latNum: $("latNum"), inferMs: $("inferMs"), queueMs: $("queueMs"), tokens: $("tokens"), dps: $("dps"),
    p50: $("p50"), p95: $("p95"),
    strip: $("latStrip"),
  };

  /* ---- state -> text; representation selected in the LAB (study.py ablation) ---- */

  var LEGEND = " Reminder: your gun only hits an alien when the ship's column equals that alien's column. " +
    "When a bomb is falling at your own column, dodge away from it.";

  function col10(x) {
    return Math.max(0, Math.min(9, Math.floor((x / W) * 10)));
  }

  function gameFacts() {
    var shipCol = col10(G.shipX);
    var shipCx = G.shipX + 13;
    var alive = G.aliens.filter(function (a) { return a.alive; });
    var low = alive.length ? alive.reduce(function (m, a) { return a.y > m.y ? a : m; }) : null;
    var lowCol = low ? col10(low.x + 10) : null;
    var rowsUp = low ? Math.max(1, Math.round((588 - low.y) / 32)) : null;
    var bomb = G.bombs.length ? G.bombs.reduce(function (m, b) { return b.y > m.y ? b : m; }) : null;
    var bombCol = bomb ? col10(bomb.x) : null;
    var stack = JG.lineOfFire();   // engine-owned alignment truth, same window as the bullet
    var shieldPct = null;
    G.shields.forEach(function (s) {
      if (shipCx >= s.x - 4 && shipCx <= s.x + s.grid[0].length * 4 + 4) {
        var ones = 0, cells = 0;
        s.grid.forEach(function (row) { row.forEach(function (c) { cells++; if (c === "1") ones++; }); });
        if (cells) shieldPct = ones / cells;
      }
    });
    var fleetSteps = null;
    if (alive.length) {
      fleetSteps = Infinity;
      alive.forEach(function (a) {
        fleetSteps = Math.min(fleetSteps, G.dir > 0 ? (W - 12 - (a.x + 24)) / 10 : (a.x - 12) / 10);
      });
      fleetSteps = Math.max(0, Math.ceil(fleetSteps));
    }
    var tss = G.lastShotAt ? Math.round((performance.now() - G.lastShotAt) / 100) / 10 : null;
    var gunReady = G.bullet === null && G.gunCool <= 0;
    return { shipCol: shipCol, nAlive: alive.length, lowCol: lowCol, rowsUp: rowsUp,
             bomb: bomb, bombCol: bombCol, bombPct: bomb ? Math.round((bomb.y / 640) * 100) : null,
             bombEta: bomb ? (640 - bomb.y) / 160 : null,
             stack: stack, shieldPct: shieldPct, gunReady: gunReady, tss: tss,
             fleetDir: G.dir > 0 ? "right" : "left", fleetSteps: fleetSteps };
  }

  function relWord(d) {
    if (d === 0) return "directly above your ship";
    return Math.abs(d) + " column" + (Math.abs(d) > 1 ? "s" : "") +
      " to the " + (d > 0 ? "right" : "left") + " of your ship";
  }

  function repCol(f, legend) {
    var s = "Space Invaders. Your ship is in column " + f.shipCol + " of 10. ";
    s += f.lowCol === null
      ? "The wave is cleared; no aliens on screen. "
      : "40 aliens remain; the lowest is at column " + f.lowCol + ", " + f.rowsUp + " rows above you. ";
    if (f.bomb) {
      s += "One bomb is falling at column " + f.bombCol + ", " + f.bombPct +
        " percent from the top" +
        (f.bombCol === f.shipCol && f.bombPct >= 55 ? ", close to your ship" : "") + ". ";
    } else {
      s += "No bombs in the air. ";
    }
    s += f.gunReady ? "Your gun is ready." : "Your gun is cooling down.";
    return legend ? s + LEGEND : s;
  }

  function repProse(f, legend) {
    var s = "Space Invaders. Your ship is in column " + f.shipCol + " of 10. ";
    s += f.lowCol === null
      ? "The wave is cleared; no aliens on screen. "
      : "The lowest alien is " + relWord(f.lowCol - f.shipCol) + ", " +
        f.rowsUp + " row" + (f.rowsUp > 1 ? "s" : "") + " up. ";
    if (f.bomb) {
      var d = f.bombCol - f.shipCol;
      var height = f.bombPct >= 70 ? "near the ground, about to land"
        : f.bombPct >= 40 ? "halfway down" : "high in the air";
      s += "One bomb is falling " +
        (d === 0 ? "straight toward your ship" : relWord(d)) + ", " + height + ". ";
    } else {
      s += "No bombs in the air. ";
    }
    s += f.gunReady ? "Your gun is ready." : "Your gun is cooling down.";
    return legend ? s + LEGEND : s;
  }

  function repRaw(f) {
    return "space_invaders ship_col=" + f.shipCol +
      " alien_low_col=" + (f.lowCol === null ? "none" : f.lowCol) +
      " alien_low_rows_up=" + (f.rowsUp === null ? "none" : f.rowsUp) + " " +
      (f.bomb ? "bomb_col=" + f.bombCol + " bomb_pct_top=" + f.bombPct : "bomb=none") +
      " gun=" + (f.gunReady ? "ready" : "cooling");
  }

  function repFeatures(f, legend) {
    var s = repProse(f, false);
    if (f.lowCol !== null) {
      s += f.stack > 0
        ? " Your line of fire: " + f.stack + " alien" + (f.stack > 1 ? "s" : "") + " stacked above your column."
        : " Your line of fire is clear: no alien above your column.";
    }
    if (f.bomb && f.bombEta !== null) {
      s += " It lands in " + (f.bombEta < 1 ? "less than a second." : "about " + Math.round(f.bombEta) + " second" + (Math.round(f.bombEta) > 1 ? "s" : "") + ".");
    }
    s += f.shieldPct === null
      ? " No shield above your ship; you are in the open."
      : " A shield stands above your ship, " + Math.round(f.shieldPct * 100) + " percent intact.";
    return legend ? s + LEGEND : s;
  }

  function repAnticipation(f, legend) {
    var s = repFeatures(f, false);
    // own momentum
    s += G.shipDir < 0 ? " You are moving left." : G.shipDir > 0 ? " You are moving right."
      : " You are holding position.";
    // fleet momentum: steps until the march hits a wall
    var aliveAll = G.aliens.filter(function (a) { return a.alive; });
    if (aliveAll.length) {
      var steps = Infinity;
      aliveAll.forEach(function (a) {
        var swid = 24;
        steps = Math.min(steps, G.dir > 0 ? (W - 12 - (a.x + swid)) / 10 : (a.x - 12) / 10);
      });
      s += " The fleet is marching " + (G.dir > 0 ? "right" : "left") +
        ", about " + Math.max(1, Math.ceil(steps)) + " steps" + (steps < 1 ? " or fewer" : "") + " from the wall.";
    }
    // bomb course counterfactual
    if (f.bomb && f.bombEta !== null) {
      var drift = G.shipDir * f.bombEta * 230 / 60;   // cols drifted at full speed over the bomb's fall
      var predCol = col10(G.shipX + 13 + drift);
      if (predCol === f.bombCol) {
        s += " If you keep your course, you will be under the bomb when it lands.";
      } else {
        s += " Keeping your course, you will be " + Math.abs(predCol - f.bombCol) +
          " column" + (Math.abs(predCol - f.bombCol) > 1 ? "s" : "") + " from where the bomb lands.";
      }
    }
    // time to line up with the target
    if (f.lowCol !== null && f.lowCol !== f.shipCol) {
      s += " At full speed you line up with the lowest alien in about " +
        (Math.abs(f.lowCol - f.shipCol) / 3.8).toFixed(1) + " seconds.";
    }
    return legend ? s + LEGEND : s;
  }

  /* telegraphic + quantized: same facts, fewest tokens, coarse buckets so
     consecutive ticks often repeat the exact text (server state-snapshot cache) */
  function repTelegraphic(f, legend) {
    function qCols(d) {
      if (d === 0) return "directly above ship";
      var a = Math.abs(d);
      var n = a < 1.5 ? "1 col" : a < 3.5 ? "2-3 cols" : a < 6.5 ? "4-6 cols" : "7+ cols";
      return n + " " + (d > 0 ? "right" : "left") + " of ship";
    }
    var s = "Ship col " + f.shipCol + "/10. ";
    s += f.lowCol === null
      ? "No aliens on screen. "
      : "Lowest alien " + qCols(f.lowCol - f.shipCol) + ", " + f.rowsUp + " rows up. ";
    if (f.bomb) {
      var h = f.bombPct >= 55 ? "about to land" : f.bombPct >= 30 ? "mid-air" : "high";
      var eta = f.bombEta < 1 ? "<1s" : "~" + Math.round(f.bombEta) + "s";
      s += "Bomb " + qCols(f.bombCol - f.shipCol) + ", " + h + ", lands " + eta + ". ";
    } else {
      s += "No bombs. ";
    }
    s += f.gunReady ? "Gun ready. "
      : "Gun cooling, " + (f.tss === null ? "just fired" : f.tss + "s since shot") + ". ";
    s += f.stack > 0 ? "Line of fire: " + f.stack + " alien" + (f.stack > 1 ? "s" : "") + " above. "
      : "Line of fire clear. ";
    if (f.fleetSteps !== null) {
      s += "Fleet marches " + f.fleetDir + ", " + f.fleetSteps + " steps from wall. ";
    }
    if (window.JEVTELE) {
      var log = window.JEVTELE.recentShots();
      if (log.length) s += "Last shots: " + log.join("; ") + ". ";
    }
    if (legend) {
      s += "Rubric: gun hits only when ship col = alien col; dodge away from bombs at own col.";
    }
    return s;
  }

  function serialize() {
    var f = gameFacts();
    switch ((window.LAB && window.LAB.rep) || "prose+features") {
      case "col": return repCol(f, false);
      case "col+legend": return repCol(f, true);
      case "prose": return repProse(f, false);
      case "prose+legend": return repProse(f, true);
      case "raw": return repRaw(f);
      case "anticipation": return repAnticipation(f, true);
      case "telegraphic": return repTelegraphic(f, true);
      default: return repTelegraphic(f, true);
    }
  }

  function buildRequest(stateText) {
    return {
      model: "jev-latest",
      state: stateText,
      questions: {
        danger: { type: "noul", instructions: "Is the ship about to be hit by a bomb?" },
        bomb_left: { type: "noul", instructions: "Is the nearest bomb to the left of the ship?" },
        alien_left: { type: "noul", instructions: "Is the lowest alien to the left of the ship?" },
        fire: { type: "noul", instructions: "Is the ship aiming at an alien right now?" },
      },
    };
  }

  /* ---- HUD ---- */

  var latencies = [];
  var responseTimes = [];
  var stripCtx = dom.strip.getContext("2d");

  function setLed(cls, label) {
    dom.led.className = "led " + cls;
    dom.ledLabel.textContent = label;
  }

  function getCss2(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawStrip() {
    var c = stripCtx, w = dom.strip.width, h = dom.strip.height;
    var SCALE = 400;
    c.clearRect(0, 0, w, h);
    c.fillStyle = getCss2("--surface-2");
    c.fillRect(0, 0, w, h);
    var n = latencies.length, bw = 8, gap = 2;
    var i, x, bh, v;
    for (i = 0; i < n; i++) {
      v = Math.min(latencies[i], SCALE) / SCALE;
      bh = Math.max(2, v * (h - 4));
      c.fillStyle = getCss2(latencies[i] > 300 ? "--amber" : "--phosphor");
      c.fillRect(w - (n - i) * (bw + gap), h - bh, bw, bh);
    }
    // rolling-mean trendline (window 10) in ink
    if (n >= 3) {
      c.strokeStyle = getCss2("--ink");
      c.lineWidth = 2;
      c.beginPath();
      for (i = 0; i < n; i++) {
        var lo = Math.max(0, i - 9);
        var seg = latencies.slice(lo, i + 1);
        var mean = seg.reduce(function (s, x2) { return s + x2; }, 0) / seg.length;
        var y = h - 2 - Math.min(mean, SCALE) / SCALE * (h - 4);
        x = w - (n - i) * (bw + gap) + bw / 2;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    // p50/p95 readouts
    if (n >= 4) {
      var sorted = latencies.slice().sort(function (a, b) { return a - b; });
      dom.p50.textContent = sorted[Math.floor(n / 2)];
      dom.p95.textContent = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    }
  }

  function showAnswers(ans, res) {
    var danger = ans.danger ? ans.danger.noul : null;
    dom.dangerBar.style.width = danger === null ? "0%" : (danger * 100).toFixed(1) + "%";
    dom.dangerAns.textContent = danger === null ? "—" :
      (danger > 0.5 ? "YES " + danger.toFixed(2) : danger.toFixed(2));
    dom.dangerAns.classList.toggle("hot", danger !== null && danger > 0.5);

    var fire = ans.fire ? ans.fire.noul : null;
    dom.fireBar.style.width = fire === null ? "0%" : (fire * 100).toFixed(1) + "%";
    dom.fireAns.textContent = fire === null ? "—" : fire.toFixed(2);

    var bombSide = ans.bomb_left ? ans.bomb_left.noul : null;
    dom.bombSideBar.style.width = bombSide === null ? "0%" : (bombSide * 100).toFixed(1) + "%";
    dom.bombSideAns.textContent = bombSide === null ? "—" :
      (bombSide > 0.5 ? "LEFT " + bombSide.toFixed(2) : "RIGHT " + (1 - bombSide).toFixed(2));

    dom.applied.textContent = "ACTION: " + res;
  }

  function parseInfer(serverTiming) {
    var m = /inference;dur=([\d.]+)/.exec(serverTiming || "");
    return m ? Math.round(parseFloat(m[1]) * 10) / 10 : null;
  }

  function parseQueue(serverTiming) {
    var t = /total;dur=([\d.]+)/.exec(serverTiming || "");
    var i = /inference;dur=([\d.]+)/.exec(serverTiming || "");
    if (!t) return null;
    var q = parseFloat(t[1]) - (i ? parseFloat(i[1]) : 0);
    return Math.max(0, Math.round(q * 10) / 10);
  }

  /* ---- flight loop ---- */

  var busy = false;

  /* latency log: one row per response; CSV export for analysis */
  window.JEVLOG = {
    rows: [],
    csv: function () {
      var head = "t_iso,ms,infer_ms,tokens,danger,fire,mode\n";
      var body = this.rows.map(function (r) {
        return [r.t, r.ms, r.infer === null ? "" : r.infer, r.tokens,
                r.danger === undefined || r.danger === null ? "" : r.danger,
                r.fire === undefined || r.fire === null ? "" : r.fire, r.mode].join(",");
      }).join("\n");
      var blob = new Blob([head + body + "\n"], { type: "text/csv" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "jev-latency.csv";
      a.click();
      URL.revokeObjectURL(a.href);
      return this.rows.length + " rows exported";
    },
  };

  async function brainTick() {
    if (busy || G.mode !== "brain" || G.paused) return;
    busy = true;
    setLed("busy", "BUSY");
    var stateText = serialize();
    if (window.JEVTELE) window.JEVTELE.tick(gameFacts().stack > 0);
    var payload = buildRequest(stateText);
    var t0 = performance.now();
    var url = (window.LAB && window.LAB.lane === "gpu") ? URL_GPU : URL_CPU;
    try {
      var r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      var data = await r.json();
      var ms = performance.now() - t0;
      var ans = data.answers || {};

      window.JEVLOG.rows.push({
        t: new Date().toISOString(),
        ms: Math.round(ms * 10) / 10,
        infer: parseInfer(r.headers.get("Server-Timing")),
        queue: parseQueue(r.headers.get("Server-Timing")),
        tokens: data.usage ? data.usage.input_tokens : null,
        danger: ans.danger ? Math.round(ans.danger.noul * 100) / 100 : null,
        fire: ans.fire ? Math.round(ans.fire.noul * 100) / 100 : null,
        mode: "brain",
      });

      latencies.push(Math.round(ms));
      if (latencies.length > 39) latencies.shift();
      var now = performance.now();
      responseTimes.push(now);
      responseTimes = responseTimes.filter(function (t) { return t > now - 3000; });

      dom.wireState.classList.remove("err");
      dom.wireState.textContent = stateText;
      if (dom.wireErr) dom.wireErr.style.display = "none";

      var res = JG.applyBrain({
        danger: ans.danger ? ans.danger.noul : 0,
        bomb_left: ans.bomb_left ? ans.bomb_left.noul : 0.5,
        alien_left: ans.alien_left ? ans.alien_left.noul : 0.5,
        fire: ans.fire ? ans.fire.noul : 0,
      });

      showAnswers(ans, res);
      dom.latNum.textContent = Math.round(ms);
      dom.inferMs.textContent = (parseInfer(r.headers.get("Server-Timing")) ?? "—") + "MS";
      var q = parseQueue(r.headers.get("Server-Timing"));
      dom.queueMs.textContent = (q === null ? "—" : Math.round(q)) + "MS";
      dom.tokens.textContent = data.usage ? data.usage.input_tokens : "—";
      dom.dps.textContent = (responseTimes.length / 3).toFixed(1);
      drawStrip();
      setLed("on", "LINKED");
    } catch (err) {
      setLed("err", "DOWN");
      if (dom.wireErr) {
        dom.wireErr.textContent = "jev unreachable (" + err.message + ") — retrying every " +
          (TICK_MS / 1000).toFixed(2).replace(/0$/, "") + " s; the ship keeps its last heading.";
        dom.wireErr.style.display = "block";
      }
    } finally {
      busy = false;
    }
  }

  /* self-pacing: next request fires as soon as the previous one returns (min gap 30 ms) */
  (function pace() {
    if (G.mode === "brain") {
      if (!busy && !G.paused) brainTick();
      setTimeout(pace, 30);
    } else {
      if (G.mode === "random" && !G.paused) JG.randomTick();
      setTimeout(pace, TICK_MS);
    }
  })();

  drawStrip();
})();
