// Theme images (backgrounds, sponsor logos): PNG, JPEG, WebP or GIF, checked by their bytes
// (never trusting the name or the browser's type), stored in DATA_DIR/uploads under a random
// name, and served from /uploads/ with a long cache (a name never changes content).

import { randomBytes } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_MB = 5;
export const MAX_UPLOADS = 500;

export function imageType(buf: Buffer): "png" | "jpg" | "webp" | "gif" | undefined {
  if (buf.length < 12) return undefined;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "gif";
  return undefined;
}

export class Uploads {
  readonly dir: string;
  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "uploads");
  }

  async save(buf: Buffer): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
    const type = imageType(buf);
    if (!type) return { ok: false, error: "That isn't a PNG, JPEG, WebP or GIF image." };
    await mkdir(this.dir, { recursive: true });
    const count = (await readdir(this.dir).catch(() => [])).length;
    if (count >= MAX_UPLOADS) return { ok: false, error: "The image store is full. Ask staff to tidy up old boards." };
    const file = `${randomBytes(10).toString("hex")}.${type}`;
    await writeFile(path.join(this.dir, file), buf, { flag: "wx" });
    return { ok: true, file };
  }
}
