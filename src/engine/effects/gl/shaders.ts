/**
 * GLSL ES 3.00 passes for the effect cascade. Every pass reads 8-bit RGBA textures with
 * `texelFetch` (no hardware filtering) and writes integer-valued colours, reproducing the
 * CPU reference's arithmetic and its uint8 truncation/rounding between effects (spec 03).
 * Rows are image rows (row 0 = top) throughout; only `PRESENT` flips for display.
 */

import { BLUR_SAMPLES } from "../cpu/effects";
import { HASH_GLSL, MAX_GLITCH_SLICES } from "../plan";

/** Full-screen triangle from `gl_VertexID`; no vertex buffers needed. */
export const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;
uniform sampler2D u_src;
uniform ivec2 u_size;
out vec4 outColor;
ivec2 here() { return ivec2(gl_FragCoord.xy); }
vec4 fetch(sampler2D s, ivec2 p) { return floor(texelFetch(s, p, 0) * 255.0 + 0.5); }
ivec3 fetchI(sampler2D s, ivec2 p) { return ivec3(fetch(s, p).rgb); }
void emit(vec3 v) { outColor = vec4(clamp(v, 0.0, 255.0) / 255.0, 1.0); }
`;

/** `apply_overlay`: `RGB * α + frame * (1 − α)` with `α = A/255 × opacity`, truncated. */
export const OVERLAY = `${HEADER}
uniform sampler2D u_overlay;
uniform float u_opacity;
void main() {
  ivec2 p = here();
  vec4 o = fetch(u_overlay, p);
  float alpha = (o.a / 255.0) * u_opacity;
  emit(floor(o.rgb * alpha + fetch(u_src, p).rgb * (1.0 - alpha)));
}`;

/**
 * `apply_radial_blur`: the average of ${BLUR_SAMPLES} centre-cropped OpenCV INTER_LINEAR upscales.
 * Taps (left index, 11-bit weight) per zoom are precomputed on the CPU, so the fixed-point
 * maths below is the same integer arithmetic as `cvResizeLinear`.
 */
export const RADIAL_BLUR = `${HEADER}
uniform isampler2D u_tapsX;
uniform isampler2D u_tapsY;
void main() {
  ivec2 p = here();
  ivec3 acc = ivec3(0);
  for (int i = 0; i < ${BLUR_SAMPLES}; i++) {
    ivec2 tx = texelFetch(u_tapsX, ivec2(p.x, i), 0).rg;
    ivec2 ty = texelFetch(u_tapsY, ivec2(p.y, i), 0).rg;
    int x1 = min(tx.x + 1, u_size.x - 1);
    int y1 = min(ty.x + 1, u_size.y - 1);
    int a0 = tx.y, a1 = 2048 - tx.y, b0 = ty.y, b1 = 2048 - ty.y;
    ivec3 s0 = fetchI(u_src, ivec2(tx.x, ty.x)) * a0 + fetchI(u_src, ivec2(x1, ty.x)) * a1;
    ivec3 s1 = fetchI(u_src, ivec2(tx.x, y1)) * a0 + fetchI(u_src, ivec2(x1, y1)) * a1;
    ivec3 v = (((s0 >> 4) * b0 >> 16) + ((s1 >> 4) * b1 >> 16) + 2) >> 2;
    acc += clamp(v, 0, 255);
  }
  emit(vec3(acc / ${BLUR_SAMPLES}));
}`;

/**
 * `apply_rotate`: OpenCV 5 float32 warpAffine (border replicate) blended over the background
 * through the warped coverage mask (border constant 0).
 */
export const ROTATE = `${HEADER}
uniform sampler2D u_background;
uniform float u_inverse[6];
vec3 px(int x, int y) { return fetch(u_src, clamp(ivec2(x, y), ivec2(0), u_size - 1)).rgb; }
float inside(int x, int y) { return (x >= 0 && y >= 0 && x < u_size.x && y < u_size.y) ? 255.0 : 0.0; }
void main() {
  ivec2 p = here();
  float fx = float(p.x), fy = float(p.y);
  float sx = u_inverse[0] * fx + u_inverse[1] * fy + u_inverse[2];
  float sy = u_inverse[3] * fx + u_inverse[4] * fy + u_inverse[5];
  int ix = int(floor(sx)), iy = int(floor(sy));
  float a = sx - float(ix), b = sy - float(iy);
  vec3 p00 = px(ix, iy), p01 = px(ix + 1, iy), p10 = px(ix, iy + 1), p11 = px(ix + 1, iy + 1);
  vec3 v0 = p00 + a * (p01 - p00);
  vec3 v1 = p10 + a * (p11 - p10);
  vec3 rotated = clamp(roundEven(v0 + b * (v1 - v0)), 0.0, 255.0);
  float c00 = inside(ix, iy), c01 = inside(ix + 1, iy), c10 = inside(ix, iy + 1), c11 = inside(ix + 1, iy + 1);
  float w0 = c00 + a * (c01 - c00);
  float w1 = c10 + a * (c11 - c10);
  float alpha = clamp(roundEven(w0 + b * (w1 - w0)), 0.0, 255.0) / 255.0;
  emit(floor(rotated * alpha + fetch(u_background, p).rgb * (1.0 - alpha)));
}`;

/** `apply_vhs`: channel shift, even-row scanlines, hashed grain, then `addWeighted`. */
export const VHS = `${HEADER}
${HASH_GLSL}
uniform int u_shiftLeft;   // (x + shift) mod w reads the R source
uniform int u_shiftRight;  // (x − shift) mod w, as a non-negative offset
uniform float u_scan;
uniform float u_sd;
uniform uint u_seed;
uniform float u_dry;
uniform float u_wet;
void main() {
  ivec2 p = here();
  int w = u_size.x;
  vec3 dry = fetch(u_src, p).rgb;
  vec3 shifted = vec3(
    fetch(u_src, ivec2((p.x + u_shiftLeft) % w, p.y)).r,
    dry.g,
    fetch(u_src, ivec2((p.x + u_shiftRight) % w, p.y)).b);
  float factor = (p.y % 2 == 0) ? u_scan : 1.0;
  vec3 noise = vec3(vhsNoise(p.x, p.y, 0, u_seed), vhsNoise(p.x, p.y, 1, u_seed), vhsNoise(p.x, p.y, 2, u_seed));
  vec3 wet = clamp(floor(shifted * factor + u_sd * noise), 0.0, 255.0);
  emit(roundEven(dry * u_dry + wet * u_wet));
}`;

/** `apply_glitch`: per-row roll from the CPU-drawn slice table, blue split, `addWeighted`. */
export const GLITCH = `${HEADER}
uniform ivec3 u_slices[${MAX_GLITCH_SLICES}];  // y0, y1, shift mod w
uniform int u_count;
uniform int u_blue;  // blue shift mod w
uniform float u_dry;
uniform float u_wet;
void main() {
  ivec2 p = here();
  int w = u_size.x;
  int roll = 0;
  for (int i = 0; i < ${MAX_GLITCH_SLICES}; i++) {
    if (i < u_count && p.y >= u_slices[i].x && p.y < u_slices[i].y) roll += u_slices[i].z;
  }
  roll %= w;
  vec3 wet = fetch(u_src, ivec2((p.x - roll + w) % w, p.y)).rgb;
  wet.b = fetch(u_src, ivec2((p.x - (roll + u_blue) % w + w) % w, p.y)).b;
  emit(roundEven(fetch(u_src, p).rgb * u_dry + wet * u_wet));
}`;

/** Video fade: `astype(uint8)` of `frame × gain`. */
export const FADE = `${HEADER}
uniform float u_gain;
void main() { emit(floor(fetch(u_src, here()).rgb * u_gain)); }`;

/** Copy to the default framebuffer, flipping rows so row 0 shows at the top. */
export const PRESENT = `${HEADER}
void main() {
  ivec2 p = here();
  outColor = vec4(texelFetch(u_src, ivec2(p.x, u_size.y - 1 - p.y), 0).rgb, 1.0);
}`;
