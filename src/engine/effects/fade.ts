/**
 * Post-effect fades (spec 03 "Fades"), matching moviepy's `FadeIn`/`FadeOut` and
 * `AudioFadeIn`/`AudioFadeOut` as chained by the desktop `render_track`.
 */

/** Desktop `RenderSettings.fade`. */
export const FADE_SECONDS = 0.5;

/** `fade = min(settings.fade, actual_duration / 2)`. */
export const fadeLength = (actualDuration: number) => Math.min(FADE_SECONDS, actualDuration / 2);

/**
 * Gain at time `t` of `FadeOut(fade).apply(FadeIn(fade).apply(clip))`: each factor is 1
 * outside its window, so the product only dips at the start and end.
 */
export function videoFadeGain(t: number, duration: number, fade: number): number {
  if (fade <= 0) return 1;
  const fadeIn = t >= fade ? 1 : t / fade;
  const fadeOut = duration - t >= fade ? 1 : (duration - t) / fade;
  return fadeIn * fadeOut;
}

/** Audio fade in/out over `fade` seconds, in place: `min(t/fade, 1) * min((dur - t)/fade, 1)` per sample. */
export function applyAudioFade(planes: Float32Array[], frames: number, sampleRate: number, fade: number): void {
  if (fade <= 0) return;
  const duration = frames / sampleRate;
  const edge = Math.min(frames, Math.ceil(fade * sampleRate) + 1);
  const gain = (n: number) => {
    const t = n / sampleRate;
    return Math.min(t / fade, 1) * Math.min((duration - t) / fade, 1);
  };
  for (const plane of planes) {
    for (let n = 0; n < edge; n++) plane[n] = plane[n]! * gain(n);
    for (let n = Math.max(edge, frames - edge); n < frames; n++) plane[n] = plane[n]! * gain(n);
  }
}
