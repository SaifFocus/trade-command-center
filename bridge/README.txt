APEX Invo Bridge
================

What it does
  Keeps a Microsoft Edge browser (its own profile in the "profile" folder, separate from your normal browsers)
  logged into Invo as you. Every few minutes it opens each Invo portfolio APEX follows and sends APEX the data
  the Invo app itself loaded. APEX turns new positions into paper follow signals and $100 Mimic test copies.
  It only reads. It never trades, posts or changes anything in Invo, and your Invo password is never stored.

First time
  1. Double-click setup.cmd  (installs Node.js if needed, then the bridge's one library, then opens Invo to log in)
  2. Log in to Invo in the window that opens, then close that window.
  3. Double-click install-autostart.cmd  (starts the bridge now and every time you log in to Windows)

Everyday
  Nothing to do. The computer must be on and awake for Invo follows to work (on-chain follows run in the cloud anyway).
  bridge.log in this folder shows each round.

If APEX says "logged out of Invo"
  Double-click login.cmd, log in again, close the window.

Stop it
  stop.cmd stops it until next login. uninstall-autostart.cmd stops it for good.

Files
  secret.txt       this computer's key for APEX. Keep it private. APEX only stores its fingerprint.
  profile\         the bridge browser's Invo session.
  config.json      APEX address and browser (msedge or chrome).
