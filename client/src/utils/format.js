const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** "5 minute ago" style stamps, matching the wording used in the design. */
export function timeAgo(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (seconds < 45) return 'just now';
  if (seconds < HOUR) {
    const minutes = Math.max(1, Math.floor(seconds / MINUTE));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (seconds < DAY) {
    const hours = Math.floor(seconds / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (seconds < WEEK) {
    const days = Math.floor(seconds / DAY);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** Compact counts, so a viral post shows "12.4K" rather than blowing the layout. */
export function compactCount(value) {
  const count = Number(value) || 0;
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K`.replace('.0', '');
  return `${(count / 1_000_000).toFixed(1)}M`.replace('.0', '');
}

const FALLBACK_AVATARS = [
  '/assets/images/profile-1.png',
  '/assets/images/post_img.png',
  '/assets/images/txt_img.png',
  '/assets/images/comment_img.png',
];

/**
 * Users have no uploaded avatar in this build, so we deterministically pick one
 * of the design's own portraits from the user id — the same person always gets
 * the same face, which reads as intentional rather than random.
 */
export function avatarFor(user, fallbackIndex = 0) {
  if (user?.avatar) return user.avatar;

  const id = String(user?.id ?? '');
  if (!id) return FALLBACK_AVATARS[fallbackIndex % FALLBACK_AVATARS.length];

  const hash = [...id].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return FALLBACK_AVATARS[hash % FALLBACK_AVATARS.length];
}

export const initialsFor = (user) =>
  `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || '?';

export const cn = (...classes) => classes.filter(Boolean).join(' ');
