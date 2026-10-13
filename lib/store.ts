import { get, put } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";

/**
 * Tiny storage layer: Vercel Blob (private store) when a token is present,
 * otherwise a local folder so `npm run dev` works without any setup.
 */
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const localDir = path.join(process.cwd(), ".local-store");

export interface Stored {
  buf: Buffer;
  updatedAt: Date;
}

export async function readStored(name: string): Promise<Stored | null> {
  if (useBlob) {
    const res = await get(name, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { buf, updatedAt: new Date(res.blob.uploadedAt) };
  }
  try {
    const p = path.join(localDir, name);
    const [buf, st] = await Promise.all([fs.readFile(p), fs.stat(p)]);
    return { buf, updatedAt: st.mtime };
  } catch {
    return null;
  }
}

export async function writeStored(name: string, body: Buffer | string, contentType: string) {
  if (useBlob) {
    await put(name, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return;
  }
  const p = path.join(localDir, name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}

export const CURRENT_FILE = "apex/current.xlsx";
export const PRICE_CACHE = "apex/prices.json";
