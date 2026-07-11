/** Shared inline SVGs, lifted verbatim from the supplied design. */

export const ThumbsUpIcon = ({ filled = false, size = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="feather feather-thumbs-up"
    aria-hidden="true"
  >
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
);

export const HeartIcon = ({ size = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="feather feather-heart"
    aria-hidden="true"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

export const CommentIcon = () => (
  <svg
    className="_reaction_svg"
    xmlns="http://www.w3.org/2000/svg"
    width="21"
    height="21"
    fill="none"
    viewBox="0 0 21 21"
    aria-hidden="true"
  >
    <path
      stroke="#000"
      d="M1 10.5c0-.464 0-.696.009-.893A9 9 0 019.607 1.01C9.804 1 10.036 1 10.5 1v0c.464 0 .696 0 .893.009a9 9 0 018.598 8.598c.009.197.009.429.009.893v6.046c0 1.36 0 2.041-.317 2.535a2 2 0 01-.602.602c-.494.317-1.174.317-2.535.317H10.5c-.464 0-.696 0-.893-.009a9 9 0 01-8.598-8.598C1 11.196 1 10.964 1 10.5v0z"
    />
    <path stroke="#000" strokeLinecap="round" strokeLinejoin="round" d="M6.938 9.313h7.125M10.5 14.063h3.563" />
  </svg>
);

export const ShareIcon = () => (
  <svg
    className="_reaction_svg"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="21"
    fill="none"
    viewBox="0 0 24 21"
    aria-hidden="true"
  >
    <path
      stroke="#000"
      strokeLinejoin="round"
      d="M23 10.5L12.917 1v5.429C3.267 6.429 1 13.258 1 20c2.785-3.52 5.248-5.429 11.917-5.429V20L23 10.5z"
    />
  </svg>
);

export const MoreIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="4" height="17" fill="none" viewBox="0 0 4 17" aria-hidden="true">
    <circle cx="2" cy="2" r="2" fill="#C4C4C4" />
    <circle cx="2" cy="8" r="2" fill="#C4C4C4" />
    <circle cx="2" cy="15" r="2" fill="#C4C4C4" />
  </svg>
);

export const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 18 18" aria-hidden="true">
    <path
      stroke="#1890FF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.2"
      d="M8.25 3H3a1.5 1.5 0 00-1.5 1.5V15A1.5 1.5 0 003 16.5h10.5A1.5 1.5 0 0015 15V9.75"
    />
    <path
      stroke="#1890FF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.2"
      d="M13.875 1.875a1.591 1.591 0 112.25 2.25L9 11.25 6 12l.75-3 7.125-7.125z"
    />
  </svg>
);

export const DeleteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 18 18" aria-hidden="true">
    <path
      stroke="#1890FF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.2"
      d="M2.25 4.5h13.5M6 4.5V3a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0112 3v1.5m2.25 0V15a1.5 1.5 0 01-1.5 1.5h-7.5a1.5 1.5 0 01-1.5-1.5V4.5h10.5zM7.5 8.25v4.5M10.5 8.25v4.5"
    />
  </svg>
);

export const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 3 }}>
    <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
