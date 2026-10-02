/** Waveform peaks: min/max of the mono mix per column, accumulated from streamed chunks. */
export class PeakAccumulator {
  /** Interleaved `[min0, max0, min1, max1, …]`; columns with no audio stay 0. */
  readonly peaks: Float32Array;

  constructor(
    readonly columns: number,
    private readonly totalFrames: number,
  ) {
    this.peaks = new Float32Array(columns * 2);
  }

  /** Add planar `channels` that start at absolute frame `offset`. */
  add(channels: Float32Array[], offset: number): void {
    const n = channels[0]?.length ?? 0;
    const count = channels.length;
    const perColumn = Math.max(1, this.totalFrames / this.columns);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let c = 0; c < count; c++) v += channels[c]![i]!;
      v /= count;
      const column = Math.min(this.columns - 1, Math.floor((offset + i) / perColumn));
      if (v < this.peaks[column * 2]!) this.peaks[column * 2] = v;
      if (v > this.peaks[column * 2 + 1]!) this.peaks[column * 2 + 1] = v;
    }
  }
}
