/**
 * The stem model's files (spec 15): HT-Demucs v4, forward-only export `webnn/stem-separator`
 * (MIT) on Hugging Face, pinned to a revision and verified by SHA-256. Downloaded once into
 * Cache Storage, so later runs (and offline use) don't fetch it again. Runs in Workers.
 */

export type ModelFile = { url: string; bytes: number; sha256: string };
/** `data`: the external weights file, when the graph keeps them outside (`*.onnx.data`). */
export type ModelDescriptor = { graph: ModelFile; data: (ModelFile & { name: string }) | null };

const REVISION = "b56f9e66ceffca2401f83d2469dadaddd06e4994";
const BASE = `https://huggingface.co/webnn/stem-separator/resolve/${REVISION}/onnx`;

export const HTDEMUCS: ModelDescriptor = {
  graph: { url: `${BASE}/htdemucs_fwd.onnx`, bytes: 2_385_507, sha256: "555f511fb653348a1c9495ab6b6091767d1920798f3fba68629a1fe5b135a45f" },
  data: {
    name: "htdemucs_fwd.onnx.data",
    url: `${BASE}/htdemucs_fwd.onnx.data`,
    bytes: 168_361_984,
    sha256: "23a7c68669c041363caaef94641e961dc8c4e16b9891cb87f58f0e199a5e8820",
  },
};

/** Not prefixed `mm-toolkit-`: the service worker deletes those on every app update. */
export const MODEL_CACHE = "stem-models-v1";

export class ModelDownloadError extends Error {
  constructor(readonly kind: "network" | "damaged") {
    super(kind);
  }
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

const filesOf = (model: ModelDescriptor) => [model.graph, ...(model.data ? [model.data] : [])];

/** Whether every file of `model` is already cached (no network). */
export async function modelCached(model: ModelDescriptor = HTDEMUCS): Promise<boolean> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    for (const file of filesOf(model)) if (!(await cache.match(file.url))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Read the response body, reporting bytes received. */
async function readAll(response: Response, onBytes: (n: number) => void): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The model's bytes: from the cache, else downloaded (with `onProgress(0…1)`), verified and
 * cached. A cached file that fails verification is dropped and fetched again once.
 */
export async function loadModel(
  model: ModelDescriptor = HTDEMUCS,
  onProgress: (fraction: number) => void = () => {},
): Promise<{ graph: Uint8Array; data: { path: string; data: Uint8Array } | null }> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const total = filesOf(model).reduce((sum, f) => sum + f.bytes, 0);
  let received = 0;

  const fetchFile = async (file: ModelFile): Promise<Uint8Array> => {
    // Cache Storage only takes http(s) keys; anything else (tests' data: URLs) just isn't cached.
    const hit = await cache?.match(file.url).catch(() => undefined);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if ((await sha256(bytes)) === file.sha256) {
        received += file.bytes;
        onProgress(received / total);
        return bytes;
      }
      await cache?.delete(file.url).catch(() => false);
    }
    let response: Response;
    try {
      response = await fetch(file.url, { mode: "cors", credentials: "omit" });
    } catch {
      throw new ModelDownloadError("network");
    }
    if (!response.ok) throw new ModelDownloadError("network");
    const bytes = await readAll(response, (n) => {
      received += n;
      onProgress(Math.min(1, received / total));
    });
    if ((await sha256(bytes)) !== file.sha256) throw new ModelDownloadError("damaged");
    await cache?.put(file.url, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
    return bytes;
  };

  const graph = await fetchFile(model.graph);
  const data = model.data ? { path: model.data.name, data: await fetchFile(model.data) } : null;
  onProgress(1);
  return { graph, data };
}
