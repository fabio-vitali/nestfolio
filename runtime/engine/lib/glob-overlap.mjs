// glob-overlap.mjs — pure predicate: do two path-globs share at least one concrete matching path?
// Segment-DP over '/'-split segments. Supports: literal, '*' (one segment, may contain intra-segment
// wildcards like '*.ts'), '**' (zero or more segments). No filesystem access — this is a decidable
// question over the two patterns (§11 findByScope overlap predicate).

/** Do two single-segment wildcard patterns (only '*' meta) share a common string? */
function segTokensOverlap(a, b) {
  // DP over characters; '*' matches any run (including empty) WITHIN a segment.
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (b.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (i === a.length && j === b.length) res = true;
    else {
      const ca = i < a.length ? a[i] : null;
      const cb = j < b.length ? b[j] : null;
      if (ca === '*') res = go(i + 1, j) || (j < b.length && go(i, j + 1));      // a's * absorbs 0..n of b
      else if (cb === '*') res = go(i, j + 1) || (i < a.length && go(i + 1, j)); // b's * absorbs 0..n of a
      else if (ca !== null && cb !== null && ca === cb) res = go(i + 1, j + 1);  // literal match
      else res = false;
    }
    memo.set(key, res);
    return res;
  };
  return go(0, 0);
}

const split = (g) => g.split('/').filter((s) => s.length > 0);

export function globsOverlap(a, b) {
  const A = split(a), B = split(b);
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (B.length + 1) + j;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (i === A.length && j === B.length) res = true;
    else if (i < A.length && A[i] === '**') res = go(i + 1, j) || (j < B.length && go(i, j + 1)); // ** absorbs 0..n of B
    else if (j < B.length && B[j] === '**') res = go(i, j + 1) || (i < A.length && go(i + 1, j)); // ** absorbs 0..n of A
    else if (i < A.length && j < B.length) res = segTokensOverlap(A[i], B[j]) && go(i + 1, j + 1);
    else res = false;
    memo.set(key, res);
    return res;
  };
  return go(0, 0);
}
