/**
 * The browser half of `server/src/services/postImage.js`. Keep the two in step:
 * same folder, same transformation, same rule for legacy paths.
 *
 * The API sends a post's image as a bare Cloudinary file name (`imageId`) as
 * well as a ready-made URL (`image`). Rebuilding the URL here rather than only
 * consuming the one the server sent is what lets the browser ask for the size it
 * actually needs — a phone should not download a 1200px image to paint it 390px
 * wide, and only the browser knows its own viewport and pixel density.
 */
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const FOLDER = import.meta.env.VITE_CLOUDINARY_FOLDER || 'buddyscript/posts';

/**
 * f_auto  — AVIF/WebP to browsers that take it, JPEG to those that don't.
 * q_auto  — per-image quality, tuned by Cloudinary against the actual content.
 * c_limit — scale down to fit, never up past the stored asset.
 */
const DELIVERY = 'f_auto,q_auto,c_limit';

export const cloudinaryUrl = (fileName, width) => {
  if (!CLOUD_NAME || !fileName) return null;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${DELIVERY},w_${width}/${FOLDER}/${fileName}`;
};

// The feed column tops out around 636px, but a 3x phone screen wants ~1200 for
// the same slot. Handing the browser the whole ladder lets it pick one.
const WIDTHS = [400, 600, 800, 1200];

/**
 * Returns `undefined` — not an empty string — when there is nothing to offer
 * (a legacy `/uploads` post, or an unconfigured cloud name), because React omits
 * the attribute entirely for `undefined` and the browser falls back to `src`.
 * An empty `srcset` would instead be parsed as "no candidates".
 */
export const cloudinarySrcSet = (fileName) => {
  if (!CLOUD_NAME || !fileName) return undefined;
  return WIDTHS.map((width) => `${cloudinaryUrl(fileName, width)} ${width}w`).join(', ');
};
