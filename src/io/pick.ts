/**
 * File and folder selection that works in every engine (spec 10): a transient
 * `<input type=file>` (with `webkitdirectory` for folders) and drag & drop.
 * Handle-based pickers (persistable on Chromium) arrive with input persistence.
 */

export type PickedFile = { file: File; relativePath?: string };
export type Picked = { files: PickedFile[]; folder: string | null };

const EMPTY: Picked = { files: [], folder: null };

/** Open the browser's picker. Resolves with nothing picked when the user cancels. */
export function pickFiles(options: { accept?: string; multiple?: boolean; directory?: boolean } = {}): Promise<Picked> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.accept) input.accept = options.accept;
    input.multiple = !!options.multiple;
    if (options.directory) input.webkitdirectory = true;
    input.style.display = "none";
    const done = (picked: Picked) => {
      input.remove();
      resolve(picked);
    };
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])].map((file) => ({ file, relativePath: file.webkitRelativePath || undefined }));
      const folder = options.directory ? (files[0]?.relativePath?.split("/")[0] ?? null) : null;
      done({ files, folder });
    });
    input.addEventListener("cancel", () => done(EMPTY));
    document.body.append(input);
    input.click();
  });
}

const readEntries = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
const entryFile = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/**
 * Files from a drop. A dropped folder yields its direct children only (desktop parity);
 * `folder` is its name. Otherwise the dropped files, with `folder` null.
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<Picked> {
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const directory = entries.find((e) => e.isDirectory) as FileSystemDirectoryEntry | undefined;
  if (directory) {
    const reader = directory.createReader();
    const children: FileSystemEntry[] = [];
    for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) children.push(...batch);
    const files = await Promise.all(children.filter((e) => e.isFile).map((e) => entryFile(e as FileSystemFileEntry)));
    return { files: files.map((file) => ({ file, relativePath: `${directory.name}/${file.name}` })), folder: directory.name };
  }
  return { files: [...transfer.files].map((file) => ({ file })), folder: null };
}
