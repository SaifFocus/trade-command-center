// Pure-JS LZ4 frame decoder (no checksum verification). Works in workerd and Node.
export function lz4FrameDecode(src: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let total = 0;
  let p = 0;
  const u32 = (i: number) => (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
  while (p + 4 <= src.length) {
    const magic = u32(p);
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) { p += 8 + u32(p + 4); continue; } // skippable frame
    if (magic !== 0x184d2204) throw new Error("lz4: bad magic");
    p += 4;
    const flg = src[p];
    const bd = src[p + 1];
    p += 2;
    const blockChecksum = (flg >> 4) & 1;
    const contentSize = (flg >> 3) & 1;
    const contentChecksum = (flg >> 2) & 1;
    const dictId = flg & 1;
    if (contentSize) p += 8;
    if (dictId) p += 4;
    p += 1; // header checksum
    const maxBlock = [0, 0, 0, 0, 65536, 262144, 1048576, 4194304][(bd >> 4) & 7] || 4194304;
    // Linked blocks may reference previous output, so decode into one growing window.
    let win = new Uint8Array(maxBlock * 2);
    let wlen = 0;
    for (;;) {
      const sz = u32(p);
      p += 4;
      if (sz === 0) break;
      const raw = (sz & 0x80000000) !== 0;
      const len = sz & 0x7fffffff;
      if (wlen + maxBlock > win.length) {
        // flush all but last 64KB (max match distance)
        const keep = Math.min(wlen, 65536);
        out.push(win.slice(0, wlen - keep)); total += wlen - keep;
        const nw = new Uint8Array(maxBlock * 2);
        nw.set(win.subarray(wlen - keep, wlen));
        win = nw; wlen = keep;
      }
      if (raw) { win.set(src.subarray(p, p + len), wlen); wlen += len; }
      else wlen = decodeBlock(src, p, p + len, win, wlen);
      p += len + (blockChecksum ? 4 : 0);
    }
    out.push(win.slice(0, wlen)); total += wlen;
    if (contentChecksum) p += 4;
  }
  const res = new Uint8Array(total);
  let o = 0;
  for (const c of out) { res.set(c, o); o += c.length; }
  return res;
}

function decodeBlock(s: Uint8Array, i: number, end: number, d: Uint8Array, o: number): number {
  while (i < end) {
    const tok = s[i++];
    let lit = tok >> 4;
    if (lit === 15) { let b; do { b = s[i++]; lit += b; } while (b === 255); }
    d.set(s.subarray(i, i + lit), o); o += lit; i += lit;
    if (i >= end) break;
    const off = s[i] | (s[i + 1] << 8);
    i += 2;
    let ml = tok & 15;
    if (ml === 15) { let b; do { b = s[i++]; ml += b; } while (b === 255); }
    ml += 4;
    let m = o - off;
    if (off >= ml) { d.copyWithin(o, m, m + ml); o += ml; }
    else for (let k = 0; k < ml; k++) d[o++] = d[m++];
  }
  return o;
}
