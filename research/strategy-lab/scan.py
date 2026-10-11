"""Grid scan: every variant is scored on the first 60% (in) and the last 40% (out) of the period."""
import itertools, sys, json
import pandas as pd
from lab import load, run, metrics, portfolio
import strats as S

TF = sys.argv[1] if len(sys.argv) > 1 else "1h"
ONLY = sys.argv[2].split(",") if len(sys.argv) > 2 else None
data = load(TF)
bar_h = 1 if TF == "1h" else 4
t0 = min(df.index[0] for df in data.values())
t1 = max(df.index[-1] for df in data.values())
split = t0 + 0.6 * (t1 - t0)
span_days = (t1 - t0) / 24
k = bar_h  # hours per bar, to keep holding periods comparable

LIM = [(0, 0.0), (3, 0.5)]
GRID = {
    "rsi2_mr": dict(fn=S.rsi2_mr, grid=dict(lo=[5, 10], stop_atr=[3.0, 6.0], time_stop=[12 // k or 3, 24 // k], trend_n=[200], lim=LIM)),
    "bb_fade": dict(fn=S.bb_fade, grid=dict(bb_k=[2.5, 3.0], stop_atr=[2.0, 4.0], time_stop=[24 // k, 72 // k], trend=[True, False], lim=LIM)),
    "flush_bounce": dict(fn=S.flush_bounce, grid=dict(move_atr=[2.0, 3.0], vol_mult=[2.0, 4.0], time_stop=[6 // k or 2, 24 // k], tgt_r=[0, 1.5], lim=LIM)),
    "donchian": dict(fn=S.donchian, grid=dict(don_n=[max(24 // k, 6), 72 // k], vol_mult=[1.0, 2.0], stop_atr=[1.5, 3.0], tgt_r=[2, 4], t1_r=[0, 1], time_stop=[48 // k, 168 // k])),
    "asia_breakout": dict(fn=S.asia_breakout, grid=dict(cutoff=[12, 16, 20], stop=["mid", "far"], trend=[True, False], time_stop=[24], tgt_r=[0, 2])),
    "funding_fade": dict(fn=S.funding_fade, grid=dict(q=[0.9, 0.97], fast=[10, 20], stop_atr=[1.5, 3.0], tgt_r=[1.5, 3], time_stop=[24 // k or 6, 72 // k])),
    "ema_pullback": dict(fn=S.ema_pullback, grid=dict(t1_r=[0, 1.0], tgt_r=[2, 3], time_stop=[24 // k, 72 // k], trend_n=[200, 100], lim=[(0, 0.0), (3, 0.25)])),
}

rows = []
for name, g in GRID.items():
    if ONLY and name not in ONLY:
        continue
    if TF != "1h" and name == "asia_breakout":
        continue
    keys = list(g["grid"])
    for combo in itertools.product(*[g["grid"][kk] for kk in keys]):
        p = dict(zip(keys, combo))
        if "lim" in p:
            p["lim_bars"], p["lim_atr"] = p.pop("lim")
        t = run(data, g["fn"], p)
        m = metrics(t, split, span_days)
        if m.get("n", 0) == 0:
            continue
        pf = portfolio(t)
        rows.append(dict(strat=name, **{kk: v for kk, v in p.items()}, **m, **{f"p_{a}": b for a, b in pf.items()}))
    print(name, "done", file=sys.stderr)

df = pd.DataFrame(rows)
df.to_pickle(f"scan_{TF}.pkl")
cols = ["strat", "n", "per_day", "wr", "avg_r", "pf", "in_r", "out_r", "out_wr", "coins_pos", "hold_h", "mdd_r", "p_taken", "p_ret_pct", "p_mdd_pct"]
pd.set_option("display.width", 250, "display.max_columns", 40, "display.max_rows", 400)
for name in df.strat.unique():
    d = df[df.strat == name].copy()
    d["score"] = d[["in_r", "out_r"]].min(axis=1)
    d = d.sort_values("score", ascending=False)
    pk = [c for c in d.columns if c not in cols and c not in ("score",) and not c.startswith("p_") and c not in
          ("long_n", "long_r", "short_r", "in_n", "out_n", "avg_pct")]
    print(f"\n=== {name}: {len(d)} variants, best by min(in,out) avg R; positive both halves: {int(((d.in_r > 0) & (d.out_r > 0)).sum())}")
    print(d[pk + cols[1:]].head(6).to_string(index=False))
