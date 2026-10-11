"""Deep dive on the channel-breakout family (the only one positive in both halves)."""
import sys, itertools
import numpy as np, pandas as pd
from lab import load, run, metrics, portfolio
import strats as S

pd.set_option("display.width", 250, "display.max_columns", 40, "display.max_rows", 200)
TF = sys.argv[1] if len(sys.argv) > 1 else "4h"
d = load(TF)
t0 = min(x.index[0] for x in d.values()); t1 = max(x.index[-1] for x in d.values())
split = t0 + 0.6 * (t1 - t0); span = (t1 - t0) / 24
bh = 1 if TF == "1h" else 4
base = dict(don_n=18 if TF == "4h" else 24, vol_mult=2.0, stop_atr=3.0 if TF == "4h" else 3.0, tgt_r=4, t1_r=0, time_stop=42 if TF == "4h" else 168)


def show(label, p, coins=None, extra=None):
    t = run(d, S.donchian, p, coins=coins)
    if extra is not None:
        t = extra(t)
    m = metrics(t, split, span)
    pf2 = portfolio(t, max_open=2); pf4 = portfolio(t, max_open=4); pf6 = portfolio(t, max_open=6)
    print(f"{label:38s} n={m['n']:5d} /day={m['per_day']:5.2f} wr={m['wr']:.2f} avgR={m['avg_r']:+.3f} pf={m['pf']} in={m['in_r']:+.3f} out={m['out_r']:+.3f} "
          f"L={m['long_r']} S={m['short_r']} coins+={m['coins_pos']} hold={m['hold_h']*bh:.0f}h | mo2 {pf2['taken']} {pf2['ret_pct']:+.0f}% dd{pf2['mdd_pct']:.0f} | "
          f"mo4 {pf4['taken']} {pf4['ret_pct']:+.0f}% dd{pf4['mdd_pct']:.0f} | mo6 {pf6['taken']} {pf6['ret_pct']:+.0f}% dd{pf6['mdd_pct']:.0f}")
    return t


print(f"{TF}: {len(d)} coins, {span:.0f} days, split at {pd.to_datetime(split*3600, unit='s').date()}")
t = show("base", base)
# by half-year
t["dt"] = pd.to_datetime(t.entry_h * 3600, unit="s")
print(t.groupby(t.dt.dt.to_period("Q")).net_r.agg(["count", "mean", lambda x: (x > 0).mean()]).round(3).T.to_string())
print("by side:", t.groupby("dir").net_r.agg(["count", "mean"]).round(3).to_dict())
print("exit reasons:", t.groupby("reason").net_r.agg(["count", "mean"]).round(2).to_dict())
for k, vals in dict(don_n=[6, 12, 18, 30, 42], vol_mult=[0, 1.0, 1.5, 2.0, 3.0], stop_atr=[1.0, 1.5, 2.0, 3.0, 4.0], tgt_r=[1.5, 2, 3, 4, 6, 0],
                    time_stop=[6, 12, 24, 42, 84], trend_n=[50, 100, 200, 400]).items():
    for v in vals:
        p = dict(base); p[k] = v
        if TF == "1h" and k in ("time_stop",):
            p[k] = v * 4
        if TF == "1h" and k == "don_n":
            p[k] = v * 4
        show(f"{k}={p[k]}", p)
print("--- exits that raise win rate")
for t1r, be, tg, trail in [(1.0, True, 4, 0), (1.0, True, 0, 2.0), (1.5, True, 4, 0), (1.0, False, 4, 0), (0.5, True, 4, 0), (0, True, 0, 0)]:
    p = dict(base, t1_r=t1r, be=be, tgt_r=tg, trail=trail)
    show(f"t1={t1r} be={be} tgt={tg} trail={trail}", p)
