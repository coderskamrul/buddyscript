import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

fs.mkdirSync(env.uploadDir, { recursive: true });

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    // The client's filename is never trusted: it can carry path traversal
    // ("../../server.js") or a double extension ("evil.php.png"). We discard it
    // and mint a random name with an extension derived from the allowlist.
    const ext = ALLOWED.get(file.mimetype) || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only JPG, PNG, WEBP or GIF images are allowed.'));
    }
    return cb(null, true);
  },
}).single('image');

export const publicUrlFor = (file) => (file ? `/uploads/${path.basename(file.filename)}` : null);
