/* LAB: live config + study ablation chart. Values feed brain.js / game.js via window.LAB. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  window.LAB = {
    rep: "telegraphic",
    jevSteer: true,
    jevDodge: true,
    autoloop: true,
    dangerP: 0.9,
    fireP: 0.35,
    lane: "gpu",
  };

  /* ---- controls ---- */

  /* URL overrides for studies/validation: ?rep=prose+features&fireP=0.2&dangerP=0.9 */
  (function () {
    var qs = new URLSearchParams(location.search);
    if (qs.get("fireP")) window.LAB.fireP = parseFloat(qs.get("fireP"));
    if (qs.get("dangerP")) window.LAB.dangerP = parseFloat(qs.get("dangerP"));
    if (qs.get("rep")) window.LAB.rep = qs.get("rep");
  })();

  $("labRep").value = window.LAB.rep;
  var REP_LABEL = {
    "col": "columns", "col+legend": "columns + rubric", "prose": "prose",
    "prose+legend": "prose + rubric", "prose+features": "prose + features",
    "telegraphic": "telegraphic + quantized", "raw": "raw numbers",
  };
  function wireCapText() {
    var cap = $("wireCap");
    if (cap) cap.textContent = "WORLD: " + REP_LABEL[window.LAB.rep].toUpperCase() +
      " · 5 QUESTIONS, EVERY ~250 MS";
  }
  wireCapText();
  $("labRep").addEventListener("change", function (e) {
    window.LAB.rep = e.target.value;
    wireCapText();
    var ws = $("wireState");
    if (ws) ws.textContent = "world switched to: " + REP_LABEL[window.LAB.rep];
  });
  bindCheck("labSteer", "jevSteer");
  var laneBtn = document.getElementById("labLane");
  if (laneBtn) laneBtn.addEventListener("click", function () {
    window.LAB.lane = window.LAB.lane === "gpu" ? "cpu" : "gpu";
    laneBtn.textContent = "LANE: " + window.LAB.lane.toUpperCase();
    laneBtn.setAttribute("aria-pressed", String(window.LAB.lane === "gpu"));
    var ep = document.querySelector(".brain-endpoint");
    if (ep) ep.textContent = window.LAB.lane === "gpu"
      ? "jevos-v4 q4 GGUF · 127.0.0.1:8153 · RTX 4080"
      : "jevos-v4 · 127.0.0.1:8017 · 0.9B · CPU";
  });
  bindCheck("labDodge", "jevDodge");
  bindCheck("labLoop", "autoloop");
  bindRange("labDanger", "dangerP", "labDangerV");
  bindRange("labFire", "fireP", "labFireV");

  var csvBtn = document.getElementById("csvBtn");
  if (csvBtn) csvBtn.addEventListener("click", function () {
    csvBtn.textContent = window.JEVLOG.csv();
    setTimeout(function () { csvBtn.textContent = "LOG ↓CSV"; }, 1500);
  });

  function bindCheck(id, key) {
    $(id).addEventListener("change", function (e) { window.LAB[key] = e.target.checked; });
  }
  function bindRange(id, key, out) {
    $(id).addEventListener("input", function (e) {
      window.LAB[key] = parseFloat(e.target.value);
      $(out).textContent = window.LAB[key].toFixed(2);
    });
  }

  /* ---- study chart (data from study.py -> study.json) ---- */

  var METRICS = [
    { key: "danger", label: "DANGER?" },
    { key: "fire", label: "AIM?" },
    { key: "spatial", label: "SIDE?" },
    { key: "dodge", label: "DODGE?" },
  ];
  // which study rows feed each metric, per representation
  var PICK = {
    "col":         { fire: "col | fire/aiming", spatial: "col | spatial/alienL", dodge: "col | dodge/choice", danger: "col | danger/hit" },
    "col+legend":  { fire: "col+legend | fire/aiming", spatial: "col+legend | spatial/alienL", dodge: "col+legend | dodge/choice", danger: "col+legend | danger/hit" },
    "prose":       { fire: "prose | fire/aiming", spatial: "prose | spatial/alienL", dodge: "prose | dodge/choice", danger: "prose | danger/hit" },
    "prose+legend":{ fire: "prose+legend | fire/aiming", spatial: "prose+legend | spatial/alienL", dodge: "prose+legend | dodge/choice", danger: "prose+legend | danger/hit" },
    "raw":         { fire: "raw | fire/aiming", spatial: "raw | spatial/alienL", dodge: "raw | dodge/choice", danger: "raw | danger/hit" },
  };
  var BEST = { fire: "prose+legend", spatial: "prose+legend", dodge: "prose+legend" };

  fetch("study.json").then(function (r) { return r.json(); }).then(render).catch(function () {
    $("labChart").innerHTML = '<p class="lab-note">study.json not found; run study.py.</p>';
  });

  function render(study) {
    var R = study.results;
    var chart = $("labChart");
    chart.innerHTML = "";
    Object.keys(PICK).forEach(function (rep) {
      var row = document.createElement("div");
      row.className = "chart-row" + (rep === window.LAB.rep ? " current" : "");
      var name = document.createElement("span");
      name.className = "chart-rep";
      name.textContent = rep;
      row.appendChild(name);
      var bars = document.createElement("div");
      bars.className = "chart-bars";
      METRICS.forEach(function (m) {
        var s = R[PICK[rep][m.key]];
        var v = s ? s.acc : null;
        var cell = document.createElement("span");
        cell.className = "chart-cell";
        var best = BEST[m.key] === rep;
        cell.innerHTML =
          '<span class="chart-m">' + m.label + "</span>" +
          '<span class="bar"><span class="bar-fill' + (best ? " best" : "") + '" style="width:' +
          (v === null ? 0 : v * 100).toFixed(0) + '%"></span></span>' +
          '<span class="chart-v">' + (v === null ? "—" : v.toFixed(2)) + "</span>";
        bars.appendChild(cell);
      });
      row.appendChild(bars);
      chart.appendChild(row);
    });
    var note = document.createElement("p");
    note.className = "lab-note";
    note.textContent = "accuracy at P=0.5, n=" + study.scenarios + " seeded scenarios (seed " +
      study.seed + "), ground-truth labeled. Best per metric in solid green.";
    chart.appendChild(note);
  }
})();
