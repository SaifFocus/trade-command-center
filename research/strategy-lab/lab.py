"""APEX strategy lab: fast, honest backtests on Hyperliquid 1h/4h candles + funding.

Conventions (match the paper desk):
- Signal on a closed bar i; entry at bar i+1 open with slippage against us.
- Costs per side = fee_pct + slip_pct of notional (taker 0.045% + 0.05% slippage by default).
- Stops/targets checked intrabar; if a bar touches both, the stop is assumed first (conservative).
- Funding: longs pay +rate * notional each hour held (sign flips for shorts).
- One position per coin at a time. Results in R (R = |entry - initial stop|) and in % of notional.
"""
import json, math, os
import numpy as np
import pandas as pd
from numba import njit

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
FEE = 0.045 / 100
SLIP = 0.05 / 100


def load(tf="1h"):
    """Returns dict coin -> DataFrame indexed by bar-open hour (int) with o,h,l,c,v,f (funding over the bar)."""
    if tf == "1h":
        raw = json.load(open(os.path.join(DATA, "h1.json")))
        fr = json.load(open(os.path.join(DATA, "f1.json")))
        out = {}
        for coin, rows in raw.items():
            a = np.array(rows)
            df = pd.DataFrame(a[:, 1:6], index=a[:, 0].astype(np.int64), columns=["o", "h", "l", "c", "v"])
            df = df[~df.index.duplicated()].sort_index()
            f = pd.Series(0.0, index=df.index)
            if coin in fr:
                fa = np.array(fr[coin])
                fs = pd.Series(fa[:, 1], index=fa[:, 0].astype(np.int64) - 1)  # paid at end of the previous bar
                fs = fs[~fs.index.duplicated()]
                f = fs.reindex(df.index).fillna(0.0)
            df["f"] = f.values
            out[coin] = df
        return out
    raw = json.load(open(os.path.join(DATA, "h4.json")))
    out = {}
    for coin, rows in raw.items():
        a = np.array(rows)
        df = pd.DataFrame(a[:, 1:7], index=a[:, 0].astype(np.int64), columns=["o", "h", "l", "c", "v", "f"])
        df = df[~df.index.duplicated()].sort_index()
        out[coin] = df
    return out


# ---------------------------------------------------------------- indicators
def ema(s, n):
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(c, n):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100.0).where(dn.notna())


def atr(df, n=14):
    pc = df.c.shift(1)
    tr = pd.concat([df.h - df.l, (df.h - pc).abs(), (df.l - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


# ---------------------------------------------------------------- per-coin simulator
@njit(cache=True)
def sim(o, h, l, c, f, sig, stopd, exit_long, exit_short, tgt_r, t1_r, t1_frac, be_after_t1, time_stop,
        cost_in, cost_tp, cost_out, trail_atr, atrv, lim_px, lim_bars):
    """sig[i] = +1/-1 at close of bar i. stopd[i] = stop distance in price (NaN = no stop).
    Entry: lim_bars == 0 -> market at o[i+1] (cost_in should be taker+slippage).
           lim_bars > 0  -> limit at lim_px[i] resting for lim_bars bars; fills only if price trades through it
                            (low < limit for longs); fill at min(open, limit). cost_in should be the maker fee.
    Exits: T1/target are resting limits (cost_tp, maker); stop, rule, time exits pay cost_out (taker+slippage).
    One position per coin; stops checked before targets inside a bar (conservative)."""
    n = len(o)
    out = np.zeros((n, 11))  # entry_i, exit_i, dir, net_r, gross_r, fee_r, fund_r, net_pct, bars, reason, signal_i
    k = 0
    i = 0
    while i < n - 1:
        d = sig[i]
        if d == 0 or (np.isnan(stopd[i]) and (tgt_r > 0 or t1_r > 0)):
            i += 1
            continue
        # ---- entry
        ei = -1
        e = 0.0
        if lim_bars == 0:
            ei = i + 1
            e = o[ei]
        else:
            L = lim_px[i]
            for jj in range(i + 1, min(n, i + 1 + lim_bars)):
                if d == 1 and l[jj] < L:
                    ei = jj
                    e = min(o[jj], L)
                    break
                if d == -1 and h[jj] > L:
                    ei = jj
                    e = max(o[jj], L)
                    break
            if ei < 0:
                i += 1
                continue
        sd = stopd[i]
        has_stop = not np.isnan(sd)
        if has_stop:
            stop = e - d * sd
            R = sd
        else:
            stop = np.nan
            R = 0.02 * e  # nominal R = 2% of price for stop-less rules (only used to express results)
        if R <= 0:
            i += 1
            continue
        t1 = e + d * t1_r * R
        tg = e + d * tgt_r * R
        rem = 1.0
        gross = 0.0
        fee = cost_in * e / R
        fund = 0.0
        t1hit = False
        best = e
        reason = 0
        xi = -1
        j = ei
        while j < n:
            fund += d * f[j] * e * rem / R
            # stop first (on a limit-fill bar the stop is only checked if the bar went past it after the fill)
            if not np.isnan(stop):
                hit = (l[j] <= stop) if d == 1 else (h[j] >= stop)
                if hit:
                    px = stop
                    if j > ei and ((d == 1 and o[j] < stop) or (d == -1 and o[j] > stop)):
                        px = o[j]  # gap through the stop
                    gross += rem * (px - e) * d / R
                    fee += cost_out * px * rem / R
                    rem = 0.0
                    reason = 1 if not t1hit else 2
                    xi = j
                    break
            if t1_r > 0 and not t1hit and j > ei - (1 if lim_bars == 0 else 0):
                if (d == 1 and h[j] >= t1) or (d == -1 and l[j] <= t1):
                    gross += t1_frac * (t1 - e) * d / R
                    fee += cost_tp * t1 * t1_frac / R
                    rem -= t1_frac
                    t1hit = True
                    if be_after_t1:
                        stop = e
                    if rem <= 1e-9:
                        reason = 3
                        xi = j
                        break
            if tgt_r > 0 and (lim_bars == 0 or j > ei) and ((d == 1 and h[j] >= tg) or (d == -1 and l[j] <= tg)):
                gross += rem * (tg - e) * d / R
                fee += cost_tp * tg * rem / R
                rem = 0.0
                reason = 4
                xi = j
                break
            if (d == 1 and exit_long[j]) or (d == -1 and exit_short[j]) or (j - i >= time_stop):
                gross += rem * (c[j] - e) * d / R
                fee += cost_out * c[j] * rem / R
                rem = 0.0
                reason = 5 if j - i < time_stop else 6
                xi = j
                break
            if trail_atr > 0 and t1hit and not np.isnan(atrv[j]):
                if (d == 1 and c[j] > best) or (d == -1 and c[j] < best):
                    best = c[j]
                ns = best - d * trail_atr * atrv[j]
                if np.isnan(stop) or (d == 1 and ns > stop) or (d == -1 and ns < stop):
                    stop = ns
            j += 1
        if xi < 0:
            xi = n - 1
            gross += rem * (c[xi] - e) * d / R
            fee += cost_out * c[xi] * rem / R
            reason = 7
        net = gross - fee - fund
        out[k, 0] = ei
        out[k, 1] = xi
        out[k, 2] = d
        out[k, 3] = net
        out[k, 4] = gross
        out[k, 5] = fee
        out[k, 6] = fund
        out[k, 7] = net * R / e * 100
        out[k, 8] = xi - ei + 1
        out[k, 9] = reason
        out[k, 10] = i
        k += 1
        i = xi
    return out[:k]


SLIP_ = SLIP
REASONS = {1: "stop", 2: "be/trail", 3: "t1_all", 4: "target", 5: "exit_rule", 6: "time", 7: "eod"}


MAKER = 0.015 / 100
TAKER = FEE + SLIP


def run(data, fn, p, coins=None, maker=MAKER, taker=TAKER):
    """fn(df, p) -> dict(sig, stopd, exit_long, exit_short) as Series aligned to df. Returns trades DataFrame."""
    rows = []
    for coin, df in data.items():
        if coins is not None and coin not in coins:
            continue
        if len(df) < 300:
            continue
        s = fn(df, p)
        dl = int(p.get("delay", 0))
        if dl:
            for kk in ("sig", "stopd"):
                if s.get(kk) is not None:
                    s[kk] = s[kk].shift(dl)
        sig = s["sig"].fillna(0).astype(np.int64).values
        stopd = s["stopd"].astype(float).values if s.get("stopd") is not None else np.full(len(df), np.nan)
        el = s.get("exit_long", pd.Series(False, index=df.index)).fillna(False).astype(bool).values
        es = s.get("exit_short", pd.Series(False, index=df.index)).fillna(False).astype(bool).values
        a = s.get("atr", pd.Series(np.nan, index=df.index)).astype(float).values
        lim_bars = int(p.get("lim_bars", 0))
        if lim_bars > 0:
            off = float(p.get("lim_atr", 0.0))
            lim = (df.c.values - sig * off * np.nan_to_num(a)) if s.get("lim") is None else s["lim"].astype(float).values
        else:
            lim = np.zeros(len(df))
        cost_in = maker if lim_bars > 0 else taker
        tr = sim(df.o.values, df.h.values, df.l.values, df.c.values, df.f.values, sig, stopd, el, es,
                 float(p.get("tgt_r", 0)), float(p.get("t1_r", 0)), float(p.get("t1_frac", 0.5)), bool(p.get("be", True)),
                 int(p.get("time_stop", 24)), cost_in, maker if p.get("tp_maker", True) else taker, taker,
                 float(p.get("trail", 0)), a, lim, lim_bars)
        if len(tr):
            t = pd.DataFrame(tr, columns=["ei", "xi", "dir", "net_r", "gross_r", "fee_r", "fund_r", "net_pct", "bars", "reason", "si"])
            t["coin"] = coin
            idx = df.index.values
            t["entry_h"] = idx[t.ei.astype(int)]
            t["exit_h"] = idx[t.xi.astype(int)]
            t["stop_pct"] = (s["stopd"].values[t.si.astype(int)] / df.c.values[t.si.astype(int)] * 100) if s.get("stopd") is not None else 2.0
            t["stop_pct"] = t["stop_pct"].fillna(2.0)
            rows.append(t)
    if not rows:
        return pd.DataFrame(columns=["net_r", "entry_h", "exit_h", "coin", "dir", "net_pct", "bars", "stop_pct"])
    return pd.concat(rows, ignore_index=True).sort_values("entry_h").reset_index(drop=True)


# ---------------------------------------------------------------- metrics
def metrics(t, split_h=None, span_days=None):
    if len(t) == 0:
        return dict(n=0)
    n = len(t)
    w = t[t.net_r > 0]
    pos = w.net_r.sum()
    neg = -t[t.net_r <= 0].net_r.sum()
    cum = t.sort_values("exit_h").net_r.cumsum().values
    mdd = float(np.max(np.maximum.accumulate(np.concatenate([[0], cum]))[1:] - cum)) if n else 0
    m = dict(
        n=n, wr=round(len(w) / n, 3), avg_r=round(t.net_r.mean(), 3), pf=round(pos / neg, 2) if neg > 0 else None,
        avg_pct=round(t.net_pct.mean(), 3), hold_h=round(t.bars.mean(), 1), mdd_r=round(mdd, 1),
        long_n=int((t.dir == 1).sum()), long_r=round(t[t.dir == 1].net_r.mean(), 3) if (t.dir == 1).any() else None,
        short_r=round(t[t.dir == -1].net_r.mean(), 3) if (t.dir == -1).any() else None,
    )
    if span_days:
        m["per_day"] = round(n / span_days, 2)
    if split_h is not None:
        a, b = t[t.entry_h < split_h], t[t.entry_h >= split_h]
        m["in_n"], m["in_r"] = len(a), round(a.net_r.mean(), 3) if len(a) else None
        m["out_n"], m["out_r"] = len(b), round(b.net_r.mean(), 3) if len(b) else None
        m["out_wr"] = round((b.net_r > 0).mean(), 3) if len(b) else None
    bc = t.groupby("coin").net_r.mean()
    m["coins_pos"] = f"{int((bc > 0).sum())}/{len(bc)}"
    return m


def portfolio(t, equity0=100.0, risk_pct=1.5, max_risk_pct=2.0, max_open=2, min_order=10.0, lev=3.0, hour_ms=3600, daily=None, weekly=None, kill_dd=None, max_dir=None):
    """Replays trades in time order with $ sizing: risk_pct of equity per trade, notional = risk / stop%,
    clipped to the margin left (leverage cap) and the minimum order. Returns stats on what could actually be taken."""
    if len(t) == 0:
        return dict(taken=0)
    if "dir_" not in t:
        t = t.copy(); t["dir_"] = np.sign(t.net_pct) * 0 + (t["dir"] if "dir" in t else 1)
    ev = []
    for k, r in t.iterrows():
        ev.append((r.entry_h, 1, k))
        ev.append((r.exit_h + 0.5, 0, k))  # exits happen during their bar; the slot is free from the next bar open
    ev.sort(key=lambda x: (x[0], x[1]))
    eq = equity0
    peak = eq
    mdd = 0.0
    openp = {}
    taken = 0
    skipped_slots = skipped_size = 0
    wins = 0
    closed = []  # (time, pnl)
    killed_at = None
    skipped_limits = 0
    for tm, kind, k in ev:
        r = t.loc[k]
        if kind == 1:
            if killed_at is not None:
                continue
            if daily or weekly:
                d24 = sum(p for (x, p) in closed if x > tm - 24)
                d168 = sum(p for (x, p) in closed if x > tm - 168)
                if (daily and -d24 >= eq * daily / 100) or (weekly and -d168 >= eq * weekly / 100):
                    skipped_limits += 1
                    continue
            if len(openp) >= max_open or (max_dir and sum(1 for kk in openp if t.at[kk, "dir_"] == r.dir_) >= max_dir):
                skipped_slots += 1
                continue
            stop_frac = max(float(r.stop_pct), 0.05) / 100
            risk = eq * risk_pct / 100
            notional = risk / stop_frac
            lv = 5.0 if r.coin in ("BTC", "ETH") else lev
            used = sum(v[1] for v in openp.values())
            free = eq - used
            if notional / lv > free:
                notional = free * lv
            if notional < min_order:
                if min_order * stop_frac > eq * max_risk_pct / 100 or min_order / lv > free:
                    skipped_size += 1
                    continue
                notional = min_order
            openp[k] = (notional, notional / lv)
            taken += 1
        else:
            if k not in openp:
                continue
            notional, _ = openp.pop(k)
            pnl = notional * float(r.net_pct) / 100
            wins += pnl > 0
            eq += pnl
            closed.append((tm, pnl))
            peak = max(peak, eq)
            mdd = max(mdd, (peak - eq) / peak)
            if kill_dd and killed_at is None and (peak - eq) / peak * 100 >= kill_dd:
                killed_at = tm
    return dict(taken=taken, skip_slots=skipped_slots, skip_size=skipped_size, skip_limits=skipped_limits,
                killed=None if killed_at is None else round((killed_at - t.entry_h.min()) / 24), final=round(eq, 2),
                ret_pct=round((eq / equity0 - 1) * 100, 1), mdd_pct=round(mdd * 100, 1), wr=round(wins / max(taken, 1), 3))
