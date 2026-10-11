"""Candidate setups. Each returns dict(sig, stopd, exit_long, exit_short, atr) aligned to df (signal at bar close)."""
import numpy as np
import pandas as pd
from lab import ema, rsi, atr


def _trend(df, p):
    """Higher-timeframe trend: +1 above EMA(n), -1 below. n in bars of this timeframe."""
    e = ema(df.c, p.get("trend_n", 200))
    return np.sign(df.c - e)


def rsi2_mr(df, p):
    """Connors-style: buy deep short-term oversold in an uptrend, exit on a close above SMA(5); shorts mirrored."""
    r = rsi(df.c, p.get("rsi_n", 2))
    tr = _trend(df, p)
    a = atr(df, 14)
    lo, hi = p.get("lo", 10), 100 - p.get("lo", 10)
    sig = pd.Series(0, index=df.index)
    sig[(r < lo) & (tr > 0)] = 1
    if p.get("shorts", True):
        sig[(r > hi) & (tr < 0)] = -1
    sma = df.c.rolling(p.get("exit_n", 5)).mean()
    stopd = a * p["stop_atr"] if p.get("stop_atr") else pd.Series(np.nan, index=df.index)
    return dict(sig=sig, stopd=stopd, exit_long=df.c > sma, exit_short=df.c < sma, atr=a)


def bb_fade(df, p):
    """Close outside Bollinger(20,k) against a flat/with trend; exit at the middle band."""
    n, k = p.get("bb_n", 20), p.get("bb_k", 2.5)
    m = df.c.rolling(n).mean()
    sd = df.c.rolling(n).std()
    a = atr(df, 14)
    tr = _trend(df, p) if p.get("trend", True) else pd.Series(0, index=df.index)
    sig = pd.Series(0, index=df.index)
    sig[(df.c < m - k * sd) & (tr >= 0)] = 1
    if p.get("shorts", True):
        sig[(df.c > m + k * sd) & (tr <= 0)] = -1
    stopd = a * p.get("stop_atr", 2.0)
    return dict(sig=sig, stopd=stopd, exit_long=df.c >= m, exit_short=df.c <= m, atr=a)


def flush_bounce(df, p):
    """Capitulation/liquidation-style flush: one bar falls > m*ATR with volume > v*avg and closes off the low
    -> fade it for a short hold. Mirrored for blow-off spikes."""
    a = atr(df, 14).shift(1)
    vavg = df.v.rolling(48).mean().shift(1)
    rng = df.h - df.l
    body = df.c - df.o
    m, vm = p.get("move_atr", 2.5), p.get("vol_mult", 3.0)
    wick = p.get("wick", 0.25)  # close at least this fraction of the range off the extreme
    down = (-body > m * a) & (df.v > vm * vavg) & ((df.c - df.l) >= wick * rng)
    up = (body > m * a) & (df.v > vm * vavg) & ((df.h - df.c) >= wick * rng)
    sig = pd.Series(0, index=df.index)
    sig[down] = 1
    if p.get("shorts", True):
        sig[up] = -1
    stopd = rng * p.get("stop_rng", 1.0)  # stop beyond the flush bar's extreme (approx: 1 range from close)
    stopd = stopd.clip(lower=0.5 * a)
    ema20 = ema(df.c, 20)
    el = df.c >= ema20 if p.get("exit_ema", True) else pd.Series(False, index=df.index)
    es = df.c <= ema20 if p.get("exit_ema", True) else pd.Series(False, index=df.index)
    return dict(sig=sig, stopd=stopd, exit_long=el, exit_short=es, atr=atr(df, 14))


def donchian(df, p):
    """Close beyond the prior N-bar high/low with volume > v*avg, in the higher-timeframe trend direction."""
    n = p.get("don_n", 48)
    hh = df.h.rolling(n).max().shift(1)
    ll = df.l.rolling(n).min().shift(1)
    vavg = df.v.rolling(48).mean().shift(1)
    a = atr(df, 14)
    tr = _trend(df, p)
    vm = p.get("vol_mult", 1.5)
    sig = pd.Series(0, index=df.index)
    sig[(df.c > hh) & (df.v > vm * vavg) & (tr > 0)] = 1
    if p.get("shorts", True):
        sig[(df.c < ll) & (df.v > vm * vavg) & (tr < 0)] = -1
    stopd = a * p.get("stop_atr", 2.0)
    return dict(sig=sig, stopd=stopd, exit_long=pd.Series(False, index=df.index), exit_short=pd.Series(False, index=df.index), atr=a)


def asia_breakout(df, p):
    """Range of 00:00-08:00 UTC; first close outside it between 08:00 and cutoff opens a trade; stop at the range middle
    (or other side); time exit at end of day handled by time_stop."""
    hour = (df.index.values % 24)
    day = df.index.values // 24
    d = pd.DataFrame({"h": df.h.values, "l": df.l.values, "c": df.c.values, "hour": hour, "day": day}, index=df.index)
    asia = d[d.hour < 8].groupby("day").agg(ah=("h", "max"), al=("l", "min"))
    d = d.join(asia, on="day")
    a = atr(df, 14)
    sig = pd.Series(0, index=df.index)
    win = (d.hour >= 8) & (d.hour < p.get("cutoff", 16))
    up = win & (d.c > d.ah)
    dn = win & (d.c < d.al)
    # first breakout per day only
    first_up = up & ~up.groupby(d.day).cumsum().shift(1).fillna(0).astype(bool)
    first_dn = dn & ~dn.groupby(d.day).cumsum().shift(1).fillna(0).astype(bool)
    tr = _trend(df, p) if p.get("trend", False) else pd.Series(0, index=df.index)
    sig[first_up & (tr >= 0)] = 1
    sig[first_dn & (tr <= 0)] = -1
    width = (d.ah - d.al)
    stopd = (d.c - (d.ah + d.al) / 2).abs() if p.get("stop", "mid") == "mid" else (d.c - np.where(sig > 0, d.al, d.ah)).abs()
    stopd = pd.Series(np.maximum(stopd.values, 0.3 * a.values), index=df.index)
    eod = pd.Series(hour == 23, index=df.index)
    return dict(sig=sig, stopd=stopd, exit_long=eod, exit_short=eod, atr=a)


def funding_fade(df, p):
    """Hourly funding at an extreme versus its own trailing 30-day distribution and price losing momentum
    (close below EMA(fast)) -> fade the crowded side."""
    f = df.f
    f24 = f.rolling(24).mean()
    look = p.get("look", 720)
    q_hi = f24.rolling(look, min_periods=look // 2).quantile(p.get("q", 0.95)).shift(1)
    q_lo = f24.rolling(look, min_periods=look // 2).quantile(1 - p.get("q", 0.95)).shift(1)
    e = ema(df.c, p.get("fast", 20))
    a = atr(df, 14)
    sig = pd.Series(0, index=df.index)
    sig[(f24 > q_hi) & (f24 > 0) & (df.c < e) & (df.c.shift(1) >= e.shift(1))] = -1
    sig[(f24 < q_lo) & (df.c > e) & (df.c.shift(1) <= e.shift(1))] = 1
    stopd = a * p.get("stop_atr", 2.0)
    return dict(sig=sig, stopd=stopd, exit_long=pd.Series(False, index=df.index), exit_short=pd.Series(False, index=df.index), atr=a)


def ema_pullback(df, p):
    """Trend pullback on the fast timeframe: in an uptrend (EMA50 > EMA200, close > EMA200) the low tags EMA20/50 and
    the bar closes green above EMA20 -> long. Mirror for shorts. Stop below the last 6 bars' low."""
    e20, e50, e200 = ema(df.c, 20), ema(df.c, 50), ema(df.c, p.get("trend_n", 200))
    a = atr(df, 14)
    up = (e50 > e200) & (df.c > e200)
    dn = (e50 < e200) & (df.c < e200)
    near_l = ((df.l - e20).abs() <= 0.5 * a) | ((df.l - e50).abs() <= 0.5 * a)
    near_h = ((df.h - e20).abs() <= 0.5 * a) | ((df.h - e50).abs() <= 0.5 * a)
    sig = pd.Series(0, index=df.index)
    sig[up & near_l & (df.c > e20) & (df.c > df.o)] = 1
    if p.get("shorts", True):
        sig[dn & near_h & (df.c < e20) & (df.c < df.o)] = -1
    lo6 = df.l.rolling(6).min()
    hi6 = df.h.rolling(6).max()
    stopd = pd.Series(np.where(sig > 0, df.c - lo6 + 0.1 * a, hi6 - df.c + 0.1 * a), index=df.index)
    stopd = stopd.where(stopd > 0.5 * a, 0.5 * a)
    return dict(sig=sig, stopd=stopd, exit_long=pd.Series(False, index=df.index), exit_short=pd.Series(False, index=df.index), atr=a)
