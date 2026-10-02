/** In-memory File System Access API subset (directory/file handles) for Node tests. */

const domError = (name: string) => Object.assign(new Error(name), { name });

export class FakeFileHandle {
  readonly kind = "file" as const;
  data = new Uint8Array();
  lastModified = Date.now();
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    return new File([this.data], this.name, { lastModified: this.lastModified });
  }
  async createWritable(): Promise<WritableStream<Uint8Array>> {
    const chunks: Uint8Array[] = [];
    return new WritableStream<Uint8Array>({
      write: (chunk) => void chunks.push(chunk),
      close: () => {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        this.data = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          this.data.set(c, offset);
          offset += c.length;
        }
        this.lastModified = Date.now();
      },
    });
  }
}

export class FakeDirectoryHandle {
  readonly kind = "directory" as const;
  readonly entries = new Map<string, FakeFileHandle | FakeDirectoryHandle>();
  constructor(readonly name = "root") {}
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeDirectoryHandle) throw domError("TypeMismatchError");
    if (entry) return entry;
    if (!options?.create) throw domError("NotFoundError");
    const created = new FakeFileHandle(name);
    this.entries.set(name, created);
    return created;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeFileHandle) throw domError("TypeMismatchError");
    if (entry) return entry;
    if (!options?.create) throw domError("NotFoundError");
    const created = new FakeDirectoryHandle(name);
    this.entries.set(name, created);
    return created;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) throw domError("NotFoundError");
  }
  async *keys(): AsyncIterable<string> {
    yield* [...this.entries.keys()];
  }
}

/** Cast helper: the fakes implement the subset our code uses. */
export const asDir = (dir: FakeDirectoryHandle) => dir as unknown as FileSystemDirectoryHandle;
