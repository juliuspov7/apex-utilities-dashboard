import { get, put } from "@vercel/blob";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * Tiny storage layer: Vercel Blob (private store) when a token is present,
 * otherwise a local folder (STORE_DIR or ./.local-store) so `npm run dev` and the tests work without any setup.
 * Writes can be conditional (optimistic locking): see writeStored.
 */
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const localDir = process.env.STORE_DIR || path.join(process.cwd(), ".local-store");

export interface Stored {
  buf: Buffer;
  updatedAt: Date;
  etag?: string;
}

export class ConflictError extends Error {}

const hash = (b: Buffer) => `"${createHash("sha1").update(b).digest("hex")}"`;

export async function readStored(name: string): Promise<Stored | null> {
  if (useBlob) {
    const res = await get(name, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { buf, updatedAt: new Date(res.blob.uploadedAt), etag: res.blob.etag.replace(/^W\//, "") };
  }
  try {
    const p = path.join(localDir, name);
    const [buf, st] = await Promise.all([fs.readFile(p), fs.stat(p)]);
    return { buf, updatedAt: st.mtime, etag: hash(buf) };
  } catch {
    return null;
  }
}

let localLock: Promise<unknown> = Promise.resolve();

/**
 * ifMatch: undefined = unconditional write; a string = only if the stored version still has this ETag;
 * null = only if the file does not exist yet. A failed condition throws ConflictError.
 */
export async function writeStored(name: string, body: Buffer | string, contentType: string, ifMatch?: string | null) {
  if (useBlob) {
    try {
      await put(name, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: ifMatch === null ? false : true,
        contentType,
        ...(typeof ifMatch === "string" ? { ifMatch } : {}),
      });
    } catch (e) {
      if (ifMatch !== undefined && /precondition|etag|412|409|already exists|conflicting operation|conditional request/i.test(`${(e as Error).name} ${(e as Error).message}`)) throw new ConflictError("state changed concurrently");
      throw e;
    }
    return;
  }
  const p = path.join(localDir, name);
  const run = async () => {
    if (ifMatch !== undefined) {
      const cur = await fs.readFile(p).then(hash, () => null);
      if (cur !== ifMatch) throw new ConflictError("state changed concurrently");
    }
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, body);
    // atomic: readers never see a half-written file (Windows can briefly refuse a rename while the target is being read)
    for (let i = 0; ; i++) {
      try { await fs.rename(tmp, p); break; }
      catch (e) {
        if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  };
  const next = localLock.then(run, run); // check-and-write is atomic within this process
  localLock = next.catch(() => undefined);
  return next;
}

export const CURRENT_FILE = "apex/current.xlsx";
export const PRICE_CACHE = "apex/prices.json";
