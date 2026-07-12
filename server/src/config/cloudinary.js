import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
  // An upload that hangs must not hold an Express worker open indefinitely.
  timeout: 20_000,
});

export { cloudinary };
