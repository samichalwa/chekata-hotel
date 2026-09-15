import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getCurrentEnvironment } from "./db-context";

// Persistent, gitignored upload root at the project root (NOT under dist/,
// which is wiped and rebuilt on every deploy — see script/build.ts). Works
// identically in dev (tsx, cwd = project root) and production (node
// dist/index.cjs launched via PM2 from /var/www/app, cwd = /var/www/app).
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

// Isolated file storage for the Test environment (Phase 6). Files uploaded
// while signed in to Test land here instead of in the real uploads/ tree,
// and "Copy live to test" replaces this whole directory with a fresh copy
// of Live's files — so Test never reads or writes a real production file.
export const TEST_UPLOADS_ROOT = path.join(process.cwd(), "uploads-test");

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB decoded

export interface SaveUploadInput {
  category: string; // e.g. "tenants" | "accommodation" — becomes a subdirectory
  filename?: string; // original filename, used only to sniff an extension as a fallback
  dataBase64: string; // raw base64 payload, with or without a data: URL prefix
  mimeType: string;
}

export interface SaveUploadResult {
  url: string; // e.g. "/uploads/accommodation/ab12cd34.jpg" (or "/test-uploads/..." in Test)
}

export class UploadValidationError extends Error {}

// Decodes and writes a base64 file upload to uploads/<category>/<randomname>.<ext>,
// returning the public URL to serve it from (mounted via express.static in routes.ts).
export function saveBase64Upload(input: SaveUploadInput): SaveUploadResult {
  const { category, dataBase64, mimeType } = input;
  if (!/^[a-z0-9_-]+$/i.test(category)) {
    throw new UploadValidationError("Invalid upload category.");
  }
  if (!dataBase64) {
    throw new UploadValidationError("No file data provided.");
  }

  const ext = MIME_EXT[mimeType.toLowerCase()];
  if (!ext) {
    throw new UploadValidationError(`Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WEBP, PDF.`);
  }

  // Strip a data: URL prefix if present (data:image/jpeg;base64,....).
  const commaIdx = dataBase64.indexOf(",");
  const raw = dataBase64.startsWith("data:") && commaIdx !== -1 ? dataBase64.slice(commaIdx + 1) : dataBase64;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw new UploadValidationError("Could not decode file data.");
  }
  if (buffer.length === 0) {
    throw new UploadValidationError("Uploaded file is empty.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("File is too large (max 10MB).");
  }

  const isTest = getCurrentEnvironment() === "test";
  const root = isTest ? TEST_UPLOADS_ROOT : UPLOADS_ROOT;
  const urlPrefix = isTest ? "/test-uploads" : "/uploads";

  const dir = path.join(root, category);
  fs.mkdirSync(dir, { recursive: true });

  const name = `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);

  return { url: `${urlPrefix}/${category}/${name}` };
}
