# jev-invaders

Space Invaders in the browser, piloted by [jevos-v4](https://huggingface.co/feder-cr/jev):
a 0.9B text classifier that reads the battlefield as prose and answers four yes/no
questions per tick — *bomb incoming? bomb left? alien left? aiming at an alien?* —
steering, dodging and firing on its own judgments. Every number on screen is live.

## Run

```bash
# 1. the jev server (CPU lane; ~4 judgments/s)
jev serve --port 8017

# 2. static files + reverse proxy (no CORS on jev, so /v1/* forwards to :8017)
python3 demo/invaders/server.py       # serves http://127.0.0.1:8099
```

Open `http://127.0.0.1:8099/`, pick BRAIN. A GPU lane (llama.cpp q4 GGUF, ~15-23
judgments/s) can be mounted behind `/v1/gpu/*`; toggle it in the LAB strip.

## Results (5 episodes x 90 s, GPU lane, p50 46 ms)

| metric | value |
|---|---|
| median score | 610-790 (best 1050) |
| kills / episode | 38-62 |
| shot accuracy | 94-100% |
| decisions/s | ~15-23 |
| wave reached | 2 |

Random-pilot baseline: median ~130, kills near zero.

## Learnings

- **Prose relations + a two-line rubric beat every coordinate encoding.** Columns,
  10x10 grids, flat JSON, raw numbers all underperform; "the lowest alien is 2 columns
  to the left of your ship" plus a rubric legend took the aim question from 0.28 to 0.88.
- **Thresholds were the bug, not the world.** Danger accuracy 0.56 at P=0.5 is 0.99 at
  P=0.9; fire fires correctly at 0.35. Tune decision costs, not representations.
- **Telegraphic + quantized state earns server-cache hits** (identical text on quiet
  ticks) — latency p50 46 ms for a 5-question batch.
- **Death forensics: detection is not the failure mode.** 11 of 13 recorded deaths had
  danger P above the gate; the ship died dancing between two bombs because the dodge
  direction re-flipped every tick. Fix: pick the lane with max clearance from every
  bomb column and commit to it for 400 ms (hysteresis).
- **The gun-state phrasing is innocent.** Raw seconds vs bucketed vs omitted cooldown
  text: fire P 0.89-0.92 across all variants. Under-firing is geometric (no connect
  line), not linguistic.
- **Engine bugs masquerade as AI failures.** A 2x2-px ship hitbox, explosion particles
  living 350 s (ms-vs-s units), a 900 s respawn pause, and bullets tunneling through
  aliens between frames all looked like "the model plays badly". Fix the physics first.
- **Two clients on one GPU** serialize into ~10x latency. One tab, one lane.

Division of labor that works: jev owns *when* (danger trigger, fire trigger, target
side); the deterministic engine owns *how* (predictive shot gate replays the march and
refuses shots that would miss, executes patrol proportionally, holds position on target).

## Known issues / next

- `FIRE HELD (no shot line)` dominates the early game — firing rate is low until the
  fleet descends. Lever: more connect-line opportunities, not more trigger pulls.
- Occasional low-scoring episodes from a fire-trigger stall (static quantized state +
  cache). Firing-rate chart in the brain panel makes it visible.
- Threshold study was dev-set-tuned; a sealed test split is owed before quoting numbers.

Demo code: GPL-3.0. `study.py` regenerates `study.json` (seeded, labeled scenarios).
