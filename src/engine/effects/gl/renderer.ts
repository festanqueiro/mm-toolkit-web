/**
 * WebGL2 effect cascade (spec 03): the GPU twin of `cpu/effects.applyEffectChain` plus the
 * video fade. Works on an `OffscreenCanvas` in a Worker (render) or an `HTMLCanvasElement`
 * (live preview). Effects ping-pong between two RGBA8 framebuffers; the final result is
 * flipped onto the canvas, where `CanvasSource`/`VideoFrame` can capture it.
 */

import { pyRound } from "../../py";
import { BLUR_SAMPLES, MAX_ZOOM, STRENGTH_FLOOR } from "../cpu/effects";
import { createImage, type Image8 } from "../cpu/image";
import { invertAffineF32, linearTaps, rotationMatrix } from "../cpu/resample";
import { glitchPlan, vhsSeed } from "../plan";
import { rotateAngle, type EffectSettings } from "../settings";
import { FADE, GLITCH, OVERLAY, PRESENT, RADIAL_BLUR, ROTATE, VERTEX, VHS } from "./shaders";

export type FrameSource = Image8 | TexImageSource;

export type FrameOptions = {
  /** Seconds from the start of the output (drives Rotate, VHS grain and Glitch). */
  time: number;
  settings: EffectSettings;
  /** Bass envelope value for this frame; `null`/absent leaves Bass-reactive Blur off. */
  bassStrength?: number | null;
  /** Video fade gain from `videoFadeGain`; 1 (default) = no fade. */
  fadeGain?: number;
};

type Pass = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };

export class WebGLUnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available in this browser.");
  }
}

export class GlEffectRenderer {
  readonly width: number;
  readonly height: number;
  private readonly gl: WebGL2RenderingContext;
  private readonly passes: Record<"overlay" | "blur" | "rotate" | "vhs" | "glitch" | "fade" | "present", Pass>;
  private readonly frame: Target;
  private readonly ping: [Target, Target];
  private readonly background: WebGLTexture;
  private readonly overlay: WebGLTexture;
  private readonly tapsX: WebGLTexture;
  private readonly tapsY: WebGLTexture;
  private hasBackground = false;
  /** The last Image8 uploaded as the frame; a still visual is uploaded once, not per frame. */
  private lastFrame: Image8 | null = null;
  private hasOverlay = false;
  private result: Target;

  constructor(canvas: OffscreenCanvas | HTMLCanvasElement, width: number, height: number) {
    this.width = canvas.width = width;
    this.height = canvas.height = height;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new WebGLUnavailableError();
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.bindVertexArray(gl.createVertexArray());
    gl.viewport(0, 0, width, height);

    this.passes = {
      overlay: this.link(OVERLAY),
      blur: this.link(RADIAL_BLUR),
      rotate: this.link(ROTATE),
      vhs: this.link(VHS),
      glitch: this.link(GLITCH),
      fade: this.link(FADE),
      present: this.link(PRESENT),
    };
    this.frame = this.target();
    this.ping = [this.target(), this.target()];
    this.result = this.frame;
    this.background = this.texture();
    this.overlay = this.texture();
    this.tapsX = this.texture();
    this.tapsY = this.texture();
  }

  /** The job's background frame (`buildBackgroundFrame`), revealed by Rotate. Canvas-sized. */
  setBackground(image: Image8): void {
    this.upload(this.background, image);
    this.hasBackground = true;
  }

  /** The fitted RGBA overlay (`fitOverlayFrame`), or `null` for none. Canvas-sized. */
  setOverlay(image: Image8 | null): void {
    this.hasOverlay = image !== null;
    if (image) this.upload(this.overlay, image);
  }

  /** Run the cascade on one canvas-sized visual frame and draw it to the canvas. */
  render(source: FrameSource, options: FrameOptions): void {
    const gl = this.gl;
    const { time, settings } = options;
    const isImage = "data" in source && (source as Image8).data instanceof Uint8Array;
    if (!isImage || source !== this.lastFrame) this.upload(this.frame.texture, source);
    this.lastFrame = isImage ? (source as Image8) : null;
    let current = this.frame;
    const next = () => (current === this.ping[0] ? this.ping[1] : this.ping[0]);
    const apply = (pass: Pass, set: (uniform: (name: string) => WebGLUniformLocation | null) => void, extra: WebGLTexture[] = []) => {
      const target = next();
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.draw(pass, current.texture, extra, set);
      current = target;
    };

    for (const key of settings.order) {
      if (key === "overlay") {
        const opacity = settings.overlay.opacity;
        if (!settings.overlay.enabled || !this.hasOverlay || opacity <= 0) continue;
        apply(this.passes.overlay, (u) => gl.uniform1f(u("u_opacity"), opacity), [this.overlay]);
      } else if (key === "bass_blur") {
        const strength = options.bassStrength;
        if (!settings.bass_blur.enabled || strength == null || strength <= STRENGTH_FLOOR) continue;
        this.uploadBlurTaps(strength);
        apply(this.passes.blur, () => {}, [this.tapsX, this.tapsY]);
      } else if (key === "rotate") {
        if (!settings.rotate.enabled) continue;
        if (!this.hasBackground) throw new Error("Rotate needs a background frame.");
        const inverse = invertAffineF32(rotationMatrix(this.width / 2, this.height / 2, rotateAngle(time, settings.rotate.rpm)));
        apply(this.passes.rotate, (u) => gl.uniform1fv(u("u_inverse"), inverse), [this.background]);
      } else if (key === "vhs") {
        const amount = settings.vhs.amount;
        if (!settings.vhs.enabled || amount <= 0) continue;
        const shift = Math.max(1, pyRound(6 * amount)) % this.width;
        apply(this.passes.vhs, (u) => {
          gl.uniform1i(u("u_shiftLeft"), shift);
          gl.uniform1i(u("u_shiftRight"), (this.width - shift) % this.width);
          gl.uniform1f(u("u_scan"), 1 - 0.35 * amount);
          gl.uniform1f(u("u_sd"), 10 * amount);
          gl.uniform1ui(u("u_seed"), vhsSeed(time));
          gl.uniform1f(u("u_dry"), 1 - amount);
          gl.uniform1f(u("u_wet"), amount);
        });
      } else if (key === "glitch") {
        const amount = settings.glitch.amount;
        if (!settings.glitch.enabled || amount <= 0) continue;
        const plan = glitchPlan(amount, time, this.width, this.height);
        const mod = (v: number) => ((v % this.width) + this.width) % this.width;
        const table = new Int32Array(3 * plan.slices.length || 3);
        plan.slices.forEach((s, i) => table.set([s.y0, s.y1, mod(s.shift)], i * 3));
        apply(this.passes.glitch, (u) => {
          gl.uniform3iv(u("u_slices"), table);
          gl.uniform1i(u("u_count"), plan.slices.length);
          gl.uniform1i(u("u_blue"), mod(plan.blueShift));
          gl.uniform1f(u("u_dry"), 1 - amount);
          gl.uniform1f(u("u_wet"), amount);
        });
      }
    }

    const gain = options.fadeGain ?? 1;
    if (gain < 1) apply(this.passes.fade, (u) => gl.uniform1f(u("u_gain"), Math.max(0, gain)));

    this.result = current;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.draw(this.passes.present, current.texture, [], () => {});
  }

  /** Read back the last rendered frame as RGB, row 0 = top (tests, CPU fallbacks). */
  readPixels(): Image8 {
    const gl = this.gl;
    const rgba = new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.result.framebuffer);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = createImage(this.width, this.height, 3);
    for (let p = 0; p < this.width * this.height; p++) out.data.set(rgba.subarray(p * 4, p * 4 + 3), p * 3);
    return out;
  }

  /** Free GPU resources; the canvas can be reused afterwards. */
  dispose(): void {
    const gl = this.gl;
    for (const pass of Object.values(this.passes)) gl.deleteProgram(pass.program);
    for (const t of [this.frame, ...this.ping]) {
      gl.deleteFramebuffer(t.framebuffer);
      gl.deleteTexture(t.texture);
    }
    for (const t of [this.background, this.overlay, this.tapsX, this.tapsY]) gl.deleteTexture(t);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // ------------------------------------------------------------------ internals

  private uploadBlurTaps(strength: number): void {
    const { width, height } = this;
    const xs = new Int32Array(width * BLUR_SAMPLES * 2);
    const ys = new Int32Array(height * BLUR_SAMPLES * 2);
    for (let i = 1; i <= BLUR_SAMPLES; i++) {
      const zoom = 1 + (MAX_ZOOM * strength * i) / BLUR_SAMPLES;
      const fill = (out: Int32Array, size: number, zoomed: number) => {
        const taps = linearTaps(zoomed, size);
        const offset = Math.floor((zoomed - size) / 2);
        const row = (i - 1) * size * 2;
        for (let d = 0; d < size; d++) {
          out[row + d * 2] = taps.index[d + offset]!;
          out[row + d * 2 + 1] = taps.weight[(d + offset) * 2]!;
        }
      };
      fill(xs, width, pyRound(width * zoom));
      fill(ys, height, pyRound(height * zoom));
    }
    const gl = this.gl;
    for (const [texture, data, size] of [
      [this.tapsX, xs, width],
      [this.tapsY, ys, height],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32I, size, BLUR_SAMPLES, 0, gl.RG_INTEGER, gl.INT, data);
    }
  }

  private draw(pass: Pass, source: WebGLTexture, extra: WebGLTexture[], set: (uniform: (name: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    gl.useProgram(pass.program);
    const uniform = (name: string) => {
      if (!pass.uniforms.has(name)) pass.uniforms.set(name, gl.getUniformLocation(pass.program, name));
      return pass.uniforms.get(name)!;
    };
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(uniform("u_src"), 0);
    const samplers = pass === this.passes.blur ? ["u_tapsX", "u_tapsY"] : pass === this.passes.overlay ? ["u_overlay"] : ["u_background"];
    extra.forEach((texture, i) => {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniform(samplers[i]!), 1 + i);
    });
    gl.uniform2i(uniform("u_size"), this.width, this.height);
    set(uniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private upload(texture: WebGLTexture, source: FrameSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if ("data" in source && source.data instanceof Uint8Array) {
      const image = source as Image8;
      if (image.width !== this.width || image.height !== this.height) {
        throw new Error(`Frame is ${image.width}×${image.height}, expected ${this.width}×${this.height}.`);
      }
      const rgba = image.channels === 4 ? image.data : toRgba(image);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    }
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private target(): Target {
    const gl = this.gl;
    const texture = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer };
  }

  private link(fragment: string): Pass {
    const gl = this.gl;
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    return { program, uniforms: new Map() };
  }
}

function toRgba(image: Image8): Uint8Array {
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let p = 0; p < image.width * image.height; p++) {
    rgba[p * 4] = image.data[p * 3]!;
    rgba[p * 4 + 1] = image.data[p * 3 + 1]!;
    rgba[p * 4 + 2] = image.data[p * 3 + 2]!;
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}
