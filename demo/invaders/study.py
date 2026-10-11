#!/usr/bin/env python3
"""jev Space Invaders decision-quality study.

Ablations, each measured on a seeded labeled scenario set (n=120):
  1. world representation: columns / prose / raw numbers / +rubric legend
  2. question phrasing per task (danger x2, fire x4, alignment/direction x4)
  3. few-shot rubric lines inside the state (legend vs none)

Every request is a real POST to the local jev server. Results -> study.json.
"""
import json
import random
import statistics
import urllib.request
from itertools import product

URL = "http://127.0.0.1:8017/v1/systemone"
rng = random.Random(42)


def ask(state, questions):
    payload = {"model": "jev-latest", "state": state, "questions": questions}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["answers"]


# ---------------------------------------------------------------- scenarios

def make_scenarios(n=120):
    """Each scenario: ship col, lowest-alien col, rows-up, bomb (col, pct) or None."""
    scs = []
    ship_cols = [0, 1, 2, 4, 5, 6, 8, 9]
    for i in range(n):
        ship = rng.choice(ship_cols)
        alien = rng.randrange(10)
        rows_up = rng.choice([2, 3, 5, 8])
        bomb = None
        r = rng.random()
        if r < 0.40:      # near threat
            bomb = (max(0, min(9, ship + rng.choice([-1, 0, 0, 1]))), rng.choice([60, 70, 80, 90]))
        elif r < 0.65:    # mid distance
            bomb = (max(0, min(9, ship + rng.choice([-3, -2, 2, 3]))), rng.choice([30, 45, 55]))
        elif r < 0.80:    # far, harmless
            bomb = (rng.randrange(10), rng.choice([10, 20, 30]))
        # gun always ready: fire labels are about aiming, not cooldown
        scs.append(dict(ship=ship, alien=alien, rows=rows_up, bomb=bomb))
    return scs


# ground truth
def y_danger(sc):   # bomb at ship column, close to landing
    b = sc["bomb"]
    return b is not None and b[0] == sc["ship"] and b[1] >= 55

def y_fire(sc):     # aligned under the lowest alien
    return sc["alien"] == sc["ship"]

def y_bomb_left(sc):
    return sc["bomb"] is not None and sc["bomb"][0] < sc["ship"]

def y_alien_left(sc):
    return sc["alien"] < sc["ship"]

def y_dodge_dir(sc):   # -1 away-left, +1 away-right (bomb threats only)
    b = sc["bomb"]
    if b is None or abs(b[0] - sc["ship"]) > 2 or b[1] < 40:
        return 0
    return 1 if b[0] < sc["ship"] else -1 if b[0] > sc["ship"] else 0  # directly above -> ambiguous


# ------------------------------------------------------- world representations

LEGEND = (" Reminder: your gun only hits an alien when the ship's column equals that "
          "alien's column. When a bomb is falling at your own column, dodge away from it.")

def rel_word(d):
    return {0: "directly above your ship", 1: "1 column to the right of your ship"}.get(
        d, f"{abs(d)} columns to the {'right' if d > 0 else 'left'} of your ship")

def rep_col(sc):
    s = (f"Space Invaders. Your ship is in column {sc['ship']} of 10. "
         f"40 aliens remain; the lowest is at column {sc['alien']}, {sc['rows']} rows above you. ")
    if sc["bomb"]:
        s += (f"One bomb is falling at column {sc['bomb'][0]}, {sc['bomb'][1]} percent from the top"
              + (", close to your ship" if sc["bomb"][0] == sc["ship"] and sc["bomb"][1] >= 55 else "")
              + ". ")
    else:
        s += "No bombs in the air. "
    return s + "Your gun is ready."

def rep_col_legend(sc):
    return rep_col(sc) + LEGEND

def rep_prose(sc):
    s = ("Space Invaders. Your ship is in column "
         f"{sc['ship']} of 10. The lowest alien is {rel_word(sc['alien'] - sc['ship'])}, "
         f"{sc['rows']} rows up. ")
    if sc["bomb"]:
        d = sc["bomb"][0] - sc["ship"]
        height = ("near the ground, about to land" if sc["bomb"][1] >= 70 else
                  "halfway down" if sc["bomb"][1] >= 40 else "high in the air")
        s += (f"One bomb is falling {rel_word(d).replace('above your ship', 'straight toward your ship')}, "
              f"{height}. ")
    else:
        s += "No bombs in the air. "
    return s + "Your gun is ready."

def rep_prose_legend(sc):
    return rep_prose(sc) + LEGEND

def rep_raw(sc):
    b = sc["bomb"]
    s = (f"space_invaders ship_col={sc['ship']} alien_low_col={sc['alien']} "
         f"alien_low_rows_up={sc['rows']} ")
    s += (f"bomb_col={b[0]} bomb_pct_top={b[1]}" if b else "bomb=none")
    return s + " gun=ready"

REPS = {
    "col": rep_col,
    "col+legend": rep_col_legend,
    "prose": rep_prose,
    "prose+legend": rep_prose_legend,
    "raw": rep_raw,
}

# ------------------------------------------------------------ question variants

QUESTIONS = {
    # task: danger
    "danger/hit":      ("danger", {"type": "noul", "instructions": "Is the ship about to be hit by a bomb?"}, y_danger),
    "danger/land":     ("danger", {"type": "noul", "instructions": "Is a bomb about to land on the ship?"}, y_danger),
    # task: fire
    "fire/should":     ("fire", {"type": "noul", "instructions": "Should the ship fire its gun right now?"}, y_fire),
    "fire/line":       ("fire", {"type": "noul", "instructions": "Is an alien in the line of fire right now?"}, y_fire),
    "fire/hit":        ("fire", {"type": "noul", "instructions": "Would firing now likely hit an alien?"}, y_fire),
    "fire/aiming":     ("fire", {"type": "noul", "instructions": "Is the ship aiming at an alien right now?"}, y_fire),
    # task: spatial
    "spatial/bombL":   ("spatial", {"type": "noul", "instructions": "Is the nearest bomb to the left of the ship?"}, y_bomb_left),
    "spatial/alienL":  ("spatial", {"type": "noul", "instructions": "Is the lowest alien to the left of the ship?"}, y_alien_left),
}

BATCH = {name: spec[1] for name, spec in QUESTIONS.items()}
# plus one choice question for dodge direction (bomb scenarios only)
BATCH["dodge/choice"] = {"type": "choice", "instructions": "Which way should the ship move right now?",
                         "criteria": {"left": "move left", "right": "move right"}}


def score(rows, labels):
    """accuracy@0.5 + separation (mean P | yes - mean P | no)."""
    pos = [p for p, y in zip(rows, labels) if y]
    neg = [p for p, y in zip(rows, labels) if not y]
    if not pos or not neg:
        return None
    acc = sum((p > 0.5) == bool(y) for p, y in zip(rows, labels)) / len(labels)
    return dict(acc=round(acc, 3), n=len(labels),
                p_yes=round(statistics.mean(pos), 3), p_no=round(statistics.mean(neg), 3),
                sep=round(statistics.mean(pos) - statistics.mean(neg), 3))


def main():
    scs = make_scenarios()
    results = {}
    # rows[rep][qname] -> list of P per scenario (choice -> P(right))
    for rep_name, fn in REPS.items():
        per_q = {q: [] for q in BATCH}
        for sc in scs:
            a = ask(fn(sc), BATCH)
            for qname in QUESTIONS:
                per_q[qname].append(a[qname]["noul"])
            per_q["dodge/choice"].append(a["dodge/choice"]["probabilities"]["right"])
        labels = {
            "danger": [y_danger(sc) for sc in scs],
            "fire": [y_fire(sc) for sc in scs],
            "spatial/bombL": [y_bomb_left(sc) for sc in scs],
            "spatial/alienL": [y_alien_left(sc) for sc in scs],
            "dodge": [y_dodge_dir(sc) for sc in scs],
        }
        for qname, (task, _spec, _y) in QUESTIONS.items():
            lkey = qname if qname.startswith("spatial/") else qname.split("/")[0]
            s = score(per_q[qname], labels[lkey])
            if s:
                results[f"{rep_name} | {qname}"] = s
        # dodge direction accuracy from choice (threat scenarios only, exclude ambiguous)
        rows = [p for p, lab in zip(per_q["dodge/choice"], labels["dodge"]) if lab != 0]
        labs = [lab for lab in labels["dodge"] if lab != 0]
        if rows:
            acc = sum((p > 0.5) == (lab > 0) for p, lab in zip(rows, labs)) / len(rows)
            results[f"{rep_name} | dodge/choice"] = dict(acc=round(acc, 3), n=len(rows),
                                                         p_yes=None, p_no=None, sep=None)
    with open("/home/pln/Work/Decisions/jevos/demo/study.json", "w") as f:
        json.dump({"seed": 42, "scenarios": len(scs), "results": results}, f, indent=1)

    tasks = ("danger", "fire", "spatial", "dodge")
    for task in tasks:
        print(f"\n=== {task} ===")
        for key, s in results.items():
            if f" | {task}/" in key:
                extra = f" sep={s['sep']:+.3f}" if s["sep"] is not None else ""
                print(f"  {key:34s} acc={s['acc']:.3f} (n={s['n']}){extra}")


if __name__ == "__main__":
    main()
