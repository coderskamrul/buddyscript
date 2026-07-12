import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const uploadImage = multer({
  // Memory, not disk. The bytes are on their way to Cloudinary, so staging them
  // on the container's filesystem first would mean a temp file to write, read
  // back and then remember to delete — for a file we never wanted locally. The
  // 5MB cap below is what keeps the buffer bounded.
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    // A courtesy check on a client-supplied header: it rejects the honest
    // mistake early, before we spend an upload on it. The control that actually
    // holds is Cloudinary's `resource_type: 'image'`, which decodes the bytes.
    if (!ALLOWED.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only JPG, PNG, WEBP or GIF images are allowed.'));
    }
    return cb(null, true);
  },
}).single('image');
