/**
 * Butterworth design + zero-phase second-order-section filtering, ported from
 * scipy.signal (`butter(..., output="sos")`, `sosfilt_zi`, `sosfiltfilt`) so the
 * desktop's drop detection and bass envelope can be reproduced numerically
 * (spec 02). Everything runs in float64.
 */

/** One second-order section: [b0, b1, b2, a0, a1, a2] (a0 is always 1). */
export type Section = [number, number, number, number, number, number];

type Complex = { re: number; im: number };

const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

/**
 * Digital low-pass Butterworth filter as SOS, matching `scipy.signal.butter(order, wn,
 * btype="low", output="sos")` for even orders: analogue prototype → `lp2lp` →
 * bilinear transform (fs = 2) → sections ordered with poles closest to the unit
 * circle last, overall gain on the first section.
 */
export function butterLowpassSos(order: number, wn: number): Section[] {
  if (order % 2 !== 0) throw new Error("Only even orders are supported.");
  const fs2 = 4; // 2 * fs, with scipy's normalised fs = 2
  const warped = 2 * 2 * Math.tan((Math.PI * wn) / 2);
  // Analogue prototype poles in the upper half plane: -exp(i·π·m/(2N)), m = -N+1, -N+3, ..., N-1 (scipy.buttap).
  const poles: Complex[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const theta = (Math.PI * m) / (2 * order);
    const p = { re: -Math.cos(theta) * warped, im: -Math.sin(theta) * warped };
    if (p.im > 0) poles.push(p);
  }
  // Bilinear transform of each pole; gain k = warped^N / prod(fs2 - p) over all (conjugate) poles.
  let denominator: Complex = { re: 1, im: 0 };
  const digital = poles.map((p) => {
    const conj = { re: p.re, im: -p.im };
    denominator = cmul(denominator, cmul({ re: fs2 - p.re, im: -p.im }, { re: fs2 - conj.re, im: -conj.im }));
    return cdiv({ re: fs2 + p.re, im: p.im }, { re: fs2 - p.re, im: -p.im });
  });
  const gain = warped ** order / denominator.re;
  // scipy zpk2sos: pairs ordered so the pole nearest the unit circle comes last.
  digital.sort((a, b) => Math.hypot(a.re, a.im) - Math.hypot(b.re, b.im));
  return digital.map((z, index) => {
    const g = index === 0 ? gain : 1;
    return [g, 2 * g, g, 1, -2 * z.re, z.re * z.re + z.im * z.im] as Section;
  });
}

/** Steady-state initial conditions per section for a unit step (`scipy.signal.sosfilt_zi`). */
export function sosfiltZi(sos: Section[]): Array<[number, number]> {
  let scale = 1;
  return sos.map(([b0, b1, b2, , a1, a2]) => {
    // lfilter_zi for a 2nd-order section: solve (I - companion(a)^T) zi = b[1:] - a[1:] * b0.
    const r0 = b1 - a1 * b0;
    const r1 = b2 - a2 * b0;
    // [[1 + a1, -1], [a2, 1]] · [z0, z1] = [r0, r1]
    const det = 1 + a1 + a2;
    const z0 = (r0 + r1) / det;
    const z1 = r1 - a2 * z0;
    const zi: [number, number] = [scale * z0, scale * z1];
    scale *= (b0 + b1 + b2) / (1 + a1 + a2);
    return zi;
  });
}

/** In-place cascade of direct-form-II-transposed sections (`scipy.signal.sosfilt`), with given state. */
function sosfiltInPlace(sos: Section[], data: Float64Array, state: Array<[number, number]>): void {
  for (let n = 0; n < data.length; n++) {
    let x = data[n]!;
    for (let s = 0; s < sos.length; s++) {
      const [b0, b1, b2, , a1, a2] = sos[s]!;
      const z = state[s]!;
      const y = b0 * x + z[0];
      z[0] = b1 * x - a1 * y + z[1];
      z[1] = b2 * x - a2 * y;
      x = y;
    }
    data[n] = x;
  }
}

/**
 * Zero-phase filtering (`scipy.signal.sosfiltfilt` with its defaults: odd padding,
 * padlen = 3 · (2·sections + 1 − trailing-zero correction), steady-state initial conditions).
 */
export function sosfiltfilt(sos: Section[], input: ArrayLike<number>): Float64Array {
  const zerosB = sos.filter((s) => s[2] === 0).length;
  const zerosA = sos.filter((s) => s[5] === 0).length;
  const ntaps = 2 * sos.length + 1 - Math.min(zerosB, zerosA);
  const n = input.length;
  // scipy requires len(x) > padlen; shorter inputs (never real audio) get a reduced pad instead of an error.
  const padlen = Math.max(0, Math.min(3 * ntaps, n - 1));
  const ext = new Float64Array(n + 2 * padlen);
  const first = input[0] ?? 0;
  const last = input[n - 1] ?? 0;
  for (let i = 0; i < padlen; i++) {
    ext[i] = 2 * first - input[padlen - i]!;
    ext[padlen + n + i] = 2 * last - input[n - 2 - i]!;
  }
  for (let i = 0; i < n; i++) ext[padlen + i] = input[i]!;

  const zi = sosfiltZi(sos);
  const x0 = ext[0] ?? 0;
  sosfiltInPlace(sos, ext, zi.map(([a, b]) => [a * x0, b * x0]));
  ext.reverse();
  const y0 = ext[0] ?? 0;
  sosfiltInPlace(sos, ext, zi.map(([a, b]) => [a * y0, b * y0]));
  ext.reverse();
  return ext.slice(padlen, padlen + n);
}
