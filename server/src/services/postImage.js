/**
 * Post images live in Cloudinary. The database stores **only the file name** —
 * not a path, not a URL:
 *
 *   image: "qk3n8x2vp1aw7dyt"      →  buddyscript/posts/qk3n8x2vp1aw7dyt
 *
 * The folder and the delivery host are configuration, not data, so keeping them
 * out of the row means moving CDN, renaming the folder or changing the delivery
 * transformation is a config edit rather than a migration over every post ever
 * written. The URL is rebuilt from the name on the way out — by this module on
 * the server, and by its mirror at `client/src/utils/cloudinary.js` in the
 * browser. Both must agree, so any change here belongs there too.
 */
import { cloudinary } from '../config/cloudinary.js';
import { env } from '../config/env.js';

const { cloudName, folder } = env.cloudinary;

/**
 * Posts written before the move to Cloudinary — and the ones `npm run seed`
 * creates — hold a path ("/uploads/a1b2.png", "/assets/images/timeline_img.png")
 * rather than a file name. A Cloudinary name never begins with a slash, so the
 * leading slash is a reliable discriminator and old posts keep rendering.
 */
export const isLegacyPath = (image) => typeof image === 'string' && image.startsWith('/');

/**
 * f_auto  — serve AVIF/WebP to browsers that take it, JPEG to those that don't.
 * q_auto  — per-image quality, tuned by Cloudinary against the actual content.
 * c_limit — scale down to fit the requested width, never up past the original.
 */
const DELIVERY = 'f_auto,q_auto,c_limit';

/** The widest image the feed will ever ask for; also the default `src`. */
export const DEFAULT_WIDTH = 1200;

export function postImageUrl(image, width = DEFAULT_WIDTH) {
  if (!image) return null;
  if (isLegacyPath(image)) return image;

  // No version component: names are unique and assets are never overwritten, so
  // a given URL always resolves to the same bytes. That is what makes it safe to
  // cache the image immutably and forever.
  return `https://res.cloudinary.com/${cloudName}/image/upload/${DELIVERY},w_${width}/${folder}/${image}`;
}

/**
 * Streams the buffer multer parsed straight to Cloudinary and resolves to the
 * file name to store. Nothing is written to the container's disk on the way.
 */
export function uploadPostImage(file) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        // Cloudinary rejects anything that is not a decodable image, which is
        // the real control — the mimetype multer filtered on is client-supplied
        // and a determined caller can set it to whatever they like.
        resource_type: 'image',

        // The client's filename is never used: it can carry path traversal
        // ("../../server.js") or a double extension ("evil.php.png"). Cloudinary
        // mints a random name instead, and `overwrite: false` means one upload
        // can never clobber another's asset.
        use_filename: false,
        unique_filename: true,
        overwrite: false,

        // Downscale once, on the way in. A 12MP phone photo is stored at 1600px,
        // which is already bigger than any slot the feed renders it in — so we
        // pay for the pixels nobody will see exactly zero times, instead of on
        // every read. Re-encoding also strips EXIF, and EXIF carries the GPS
        // coordinates the photo was taken at.
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        // public_id comes back folder-qualified ("buddyscript/posts/abc"); the
        // folder is config, so only the last segment is worth storing.
        return resolve(result.public_id.split('/').pop());
      }
    );

    stream.end(file.buffer);
  });
}

/** Fire-and-forget cleanup, so a deleted post does not leave its bytes behind. */
export async function destroyPostImage(image) {
  if (!image || isLegacyPath(image)) return;

  try {
    await cloudinary.uploader.destroy(`${folder}/${image}`, { invalidate: true });
  } catch (error) {
    // The row is already gone and the user's request succeeded. An asset that
    // outlives it costs a few KB; failing the request here would cost the user
    // their delete.
    console.error(`[cloudinary] could not delete "${image}":`, error.message);
  }
}
