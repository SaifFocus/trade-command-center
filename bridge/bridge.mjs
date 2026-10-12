// APEX Invo Bridge — runs on Saif's computer.
// Keeps an Edge (or Chrome) browser logged into Invo, opens each Invo portfolio APEX follows, and sends APEX the JSON
// the Invo app itself downloaded. It never builds Invo API requests, never trades and never stores your Invo password
// (you log in yourself; the session lives in ./profile). APEX does all parsing, so Invo changes are fixed on the APEX
// side without touching this file.
//
//   node bridge.mjs --init     create this computer's secret (secret.txt) and print its SHA-256 for APEX
//   node bridge.mjs --login    open a visible browser to log in to Invo (stops a running bridge first)
//   node bridge.mjs            run the bridge (normally started hidden by start-hidden.vbs)
//   node bridge.mjs --once     one round, then exit (testing)
//   node bridge.mjs --stop     stop a running bridge
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const F = (n) => path.join(DIR, n);
const cfg = { apexUrl: "https://apextradyr.lovable.app", browser: "msedge", headless: true, ...readJson(F("config.json")) };
const args = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } }
function log(...a) {
  const line = `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  console.log(line);
  try {
    if (fs.existsSync(F("bridge.log")) && fs.statSync(F("bridge.log")).size > 5_000_000) fs.renameSync(F("bridge.log"), F("bridge.old.log"));
    fs.appendFileSync(F("bridge.log"), line + "\n");
  } catch { /* logging must never stop the bridge */ }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const runningPid = () => { const p = Number(readText(F("bridge.pid"))); return p && p !== process.pid && alive(p) ? p : null; };
function readText(p) { try { return fs.readFileSync(p, "utf8").trim(); } catch { return ""; } }

/** Asks a running bridge to close its browser and exit (stop.flag), then forces it after 40 s. */
async function stopRunning() {
  const pid = runningPid();
  if (!pid) return false;
  fs.writeFileSync(F("stop.flag"), String(Date.now()));
  for (let i = 0; i < 160 && alive(pid); i++) await sleep(250);
  if (alive(pid)) { try { process.kill(pid); } catch { /* already gone */ } await sleep(2000); }
  try { fs.unlinkSync(F("stop.flag")); } catch { /* ignore */ }
  log(`stopped bridge process ${pid}`);
  return true;
}
const stopRequested = () => fs.existsSync(F("stop.flag"));

async function launch(headless) {
  const { chromium } = await import("playwright-core");
  const channels = [cfg.browser, "msedge", "chrome"].filter((c, i, a) => c && a.indexOf(c) === i);
  let lastErr;
  for (const channel of channels) {
    try {
      // "chromium" = Playwright's own browser or config.executablePath (testing); otherwise an installed Edge/Chrome.
      const which = channel === "chromium" ? (cfg.executablePath ? { executablePath: cfg.executablePath } : {}) : { channel };
      return await chromium.launchPersistentContext(F("profile"), {
        ...which, headless, viewport: headless ? { width: 1280, height: 900 } : null,
        args: headless ? [] : ["--start-maximized"],
      });
    } catch (e) { lastErr = e; log(`could not start ${channel}: ${String(e?.message ?? e).split("\n")[0]}`); }
  }
  throw lastErr ?? new Error("no browser found (install Microsoft Edge or Google Chrome)");
}

// ---------------------------------------------------------------- init / login / stop
if (args.has("--init")) {
  if (!fs.existsSync(F("secret.txt"))) fs.writeFileSync(F("secret.txt"), crypto.randomBytes(32).toString("hex"));
  const hash = crypto.createHash("sha256").update(readText(F("secret.txt"))).digest("hex");
  fs.writeFileSync(F("secret-hash.txt"), hash + "\n");
  console.log("\nThis computer's bridge secret is in secret.txt (keep it private).");
  console.log("APEX only needs its fingerprint, saved in secret-hash.txt:\n  " + hash + "\n");
  process.exit(0);
}
if (args.has("--stop")) { const ok = await stopRunning(); console.log(ok ? "Bridge stopped." : "Bridge was not running."); process.exit(0); }
if (args.has("--login")) {
  await stopRunning();
  const ctx = await launch(false);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://app.invoapp.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("\nLog in to Invo in the browser window that just opened.");
  console.log("When you can see the Invo app, close that browser window.\n");
  await new Promise((r) => ctx.on("close", r));
  console.log("Login saved.");
  process.exit(0);
}

// ---------------------------------------------------------------- run
const secret = readText(F("secret.txt"));
if (!secret) { log("no secret.txt: run setup.cmd first"); process.exit(1); }
if (runningPid()) { log(`bridge already running (pid ${runningPid()}), exiting`); process.exit(0); }
try { fs.unlinkSync(F("stop.flag")); } catch { /* no stale flag */ }
fs.writeFileSync(F("bridge.pid"), String(process.pid));
process.on("exit", () => { if (readText(F("bridge.pid")) === String(process.pid)) try { fs.unlinkSync(F("bridge.pid")); } catch { /* ignore */ } });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(0));

async function apex(pathname, init = {}) {
  const res = await fetch(cfg.apexUrl + pathname, {
    ...init, headers: { "x-bridge-secret": secret, "user-agent": `APEX-Invo-Bridge/${VERSION}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${pathname} HTTP ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return JSON.parse(text);
}

const mentions = (c, id) => (c.url ?? "").includes(id) || (c.req ?? "").includes(id);
async function waitQuiet(caps, settleMs) {
  const t0 = Date.now(); let n = caps.length, lastChange = Date.now();
  while (Date.now() - t0 < Math.max(settleMs, 2000) + 9000) {
    await sleep(250);
    if (caps.length !== n) { n = caps.length; lastChange = Date.now(); }
    if (Date.now() - t0 >= settleMs && Date.now() - lastChange >= 1500) return;
  }
}

async function visit(page, t, conf) {
  const captures = [];
  const hosts = conf.capture_hosts ?? ["api.invoapp.com"];
  const onResponse = async (resp) => {
    try {
      const u = new URL(resp.url());
      if (!hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) return;
      const req = resp.request();
      if (req.method() === "OPTIONS") return;
      const buf = await resp.body();
      if (buf.length > (conf.max_body_bytes ?? 600_000)) return;
      let body;
      try { body = JSON.parse(buf.toString("utf8")); } catch { return; } // not JSON
      captures.push({ url: resp.url(), method: req.method(), status: resp.status(), req: (req.postData() ?? "").slice(0, 2000), body });
    } catch { /* body unavailable (redirect, aborted): skip */ }
  };
  page.on("response", onResponse);
  try {
    if (!page.url().startsWith(new URL(conf.home_url).origin)) {
      await page.goto(conf.home_url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(5000);
    }
    // In-app navigation keeps the Invo app loaded; a full page load is the fallback.
    await page.evaluate((u) => { history.pushState({}, "", new URL(u).pathname); dispatchEvent(new PopStateEvent("popstate", { state: {} })); }, t.url).catch(() => {});
    await waitQuiet(captures, conf.settle_ms ?? 6000);
    if (!captures.some((c) => mentions(c, t.id))) {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitQuiet(captures, (conf.settle_ms ?? 6000) + 3000);
    }
    // Scroll so the app loads more of a long position list.
    await page.mouse.move(640, 650).catch(() => {});
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 2500).catch(() => {}); await sleep(700); }
    await waitQuiet(captures, 1500);
  } catch (e) {
    return { id: t.id, url: t.url, final_url: page.url(), captures, error: String(e?.message ?? e).split("\n")[0] };
  } finally { page.off("response", onResponse); }
  const finalUrl = page.url();
  const loggedOut = /\/(login|log-in|signin|sign-in|signup|sign-up|welcome|onboarding|auth)\b/i.test(new URL(finalUrl).pathname)
    || (captures.length > 0 && captures.every((c) => c.status === 401 || c.status === 403));
  return { id: t.id, url: t.url, final_url: finalUrl, captures, logged_out: loggedOut };
}

let ctx = null, page = null;
async function ensureBrowser() {
  if (ctx && page && !page.isClosed()) return;
  try { await ctx?.close(); } catch { /* ignore */ }
  ctx = await launch(cfg.headless !== false);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  log(`browser started (${cfg.browser}, headless=${cfg.headless !== false})`);
}

log(`APEX Invo Bridge ${VERSION} starting on ${os.hostname()} -> ${cfg.apexUrl}`);
for (;;) {
  const t0 = Date.now();
  let wait = 60;
  try {
    const conf = await apex("/api/invo/targets");
    wait = conf.cycle_seconds ?? 60;
    if (conf.targets?.length) {
      await ensureBrowser();
      const results = [];
      for (const t of conf.targets) { if (stopRequested()) break; results.push(await visit(page, t, conf)); }
      if (stopRequested()) await shutdown();
      const loggedOut = results.length > 0 && results.filter((r) => r.logged_out).length >= Math.ceil(results.length / 2);
      const body = zlib.gzipSync(Buffer.from(JSON.stringify({ version: VERSION, at: new Date().toISOString(), host: os.hostname(), logged_out: loggedOut, results })));
      const r = await apex("/api/invo/ingest", { method: "POST", headers: { "content-type": "application/json", "x-body-encoding": "gzip" }, body });
      log(`round: ${conf.targets.length} portfolios, ${r.parsed} read, ${r.positions} open positions${r.events?.length ? ", " + r.events.join(", ") : ""}${r.problems?.length ? `, ${r.problems.length} problems` : ""}${loggedOut ? ", LOGGED OUT (run login.cmd)" : ""}`);
      if (loggedOut) wait = Math.max(wait, 600);
    } else log("no Invo portfolios to follow right now");
  } catch (e) {
    log(`error: ${String(e?.message ?? e).split("\n")[0]}`);
    if (e?.status === 401) { log("APEX did not accept this computer's secret: run setup.cmd and send Claude secret-hash.txt"); wait = 300; }
    if (/Target (page|closed)|browser has been closed|crash/i.test(String(e?.message))) { try { await ctx?.close(); } catch { /* ignore */ } ctx = null; page = null; }
  }
  if (args.has("--once")) await shutdown();
  const until = Date.now() + Math.max(15_000, wait * 1000 - (Date.now() - t0));
  while (Date.now() < until) { if (stopRequested()) await shutdown(); await sleep(1000); }
}

async function shutdown() {
  log("bridge stopping");
  try { await ctx?.close(); } catch { /* ignore */ }
  process.exit(0);
}
