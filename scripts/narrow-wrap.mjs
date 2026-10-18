/**
 * The 34-column wrap behind `node scripts/record-gate-demo.mjs --narrow`,
 * kept apart from the recorder so tests can feed it lines without running
 * Playwright or ffmpeg.
 */
export const COLS = 34;
export const IND = "  ";

// Greedy word wrap. A soft break drops the spaces at the break (kept in `join`),
// a token longer than a row is split (join ""), so rows can always be re-joined exactly.
export function wrapLine(s) {
  if (s.length <= COLS) return [{ text: s, join: "" }];
  const rows = [];
  let cur = "";
  let pend = "";
  let join = "";
  const flush = (next) => {
    rows.push({ text: cur, join });
    cur = IND;
    join = next;
  };
  for (const tok of s.match(/ +|[^ ]+/g)) {
    if (tok[0] === " ") {
      pend += tok;
      continue;
    }
    if (cur.length + pend.length + tok.length <= COLS) {
      cur += pend + tok;
      pend = "";
      continue;
    }
    if (cur.trim()) flush(pend);
    else cur += pend;
    pend = "";
    let w = tok;
    while (cur.length + w.length > COLS) {
      const room = COLS - cur.length;
      cur += w.slice(0, room);
      w = w.slice(room);
      flush("");
    }
    cur += w;
  }
  rows.push({ text: cur + pend, join });
  return rows;
}

/**
 * Every wrapped row, whitespace-only and leading-indent rows included, must fit
 * the column budget; a wider row would be clipped by the canvas. wrapLine does
 * not guarantee this on its own: a 40-space line, trailing spaces, or an indent
 * wider than a row each come back over-long, so this check is the guard.
 */
export function assertRowsFit(rows, src) {
  for (const row of rows) {
    if (!(row.length <= COLS)) {
      throw new Error(`wrapped row is ${row.length} columns, over ${COLS}: ${JSON.stringify(row)} (from ${JSON.stringify(src)})`);
    }
  }
}
