"""Portfolio Monte Carlo on engine trades: $100, risk-based sizing, min order, leverage cap, max_open slots.
Simultaneous signals are taken in random order (the live desk can't know which of them will work)."""
import json, sys
import numpy as np, pandas as pd
from lab import portfolio

def load_ts(f, setups=None):
    t = pd.DataFrame(json.load(open(f)))
    if setups: t = t[t.setup.isin(setups)]
    R = (t.entry_px - t.stop_px).abs()
    t = pd.DataFrame({"coin": t.coin, "setup": t.setup, "entry_h": t.entry_t / 3.6e6, "exit_h": t.exit_t / 3.6e6 + 3.5,  # exit at bar close
                      "net_r": t.net_r, "net_pct": t.net_r * R / t.entry_px * 100, "stop_pct": R / t.entry_px * 100, "sample": t["sample"], "dir": np.where(t.side == "long", 1, -1)})
    return t.reset_index(drop=True)

def mc(t, runs=200, **kw):
    out = []
    rng = np.random.default_rng(7)
    for _ in range(runs):
        tt = t.sample(frac=1, random_state=int(rng.integers(1e9))).reset_index(drop=True)
        out.append(portfolio(tt, **kw))
    d = pd.DataFrame(out)
    return dict(taken=int(d.taken.median()), per_week=round(d.taken.median() / (836 / 7), 1), ret_med=round(d.ret_pct.median()), ret_p10=round(d.ret_pct.quantile(0.1)),
                ret_p90=round(d.ret_pct.quantile(0.9)), killed=round(d.killed.notna().mean(), 2) if 'killed' in d else None, dd_med=round(d.mdd_pct.median()), dd_p90=round(d.mdd_pct.quantile(0.9)), wr=round(d.wr.median(), 2), loss_runs=round((d.ret_pct < 0).mean(), 2))

if __name__ == "__main__":
    f = sys.argv[1]; setups = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    t = load_ts(f, setups)
    print(f, setups, len(t), "trades, avg R", round(t.net_r.mean(), 3))
    for risk in (1.0, 1.5):
        for mo in (2, 3, 4, 6):
            print(f"risk {risk}% max_open {mo}:", mc(t, runs=100, risk_pct=risk, max_open=mo))
