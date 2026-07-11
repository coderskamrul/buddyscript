import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bs-theme';

/**
 * The design's light/dark switch.
 *
 * main.css keys its dark theme off `._dark_wrapper` as an ancestor selector, and
 * the original custom.js put that class on `._layout_main_wrapper`. We put it on
 * <body> instead: every one of those rules is a descendant selector, so they all
 * still match, and it additionally covers the modal and toast layers, which
 * portal to document.body and would otherwise stay light while the page went
 * dark. Tailwind's `dark:` variant is wired to the same class, so new UI follows.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    // Light is the default, matching the original custom.js (`let darkMode = false`).
    // Following the OS preference instead would open the app in dark mode for
    // anyone whose Mac is set to dark, which is not what the design does.
    return window.localStorage.getItem(STORAGE_KEY) === 'dark';
  });

  useEffect(() => {
    document.body.classList.toggle('_dark_wrapper', dark);
    window.localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="_layout_mode_swithing_btn">
      <button
        type="button"
        className="_layout_swithing_btn_link"
        onClick={() => setDark((value) => !value)}
        aria-pressed={dark}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <div className="_layout_swithing_btn">
          <div className="_layout_swithing_btn_round" />
        </div>
        <div className="_layout_change_btn_ic1">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="16" fill="none" viewBox="0 0 11 16" aria-hidden="true">
            <path
              fill="#fff"
              d="M2.727 14.977l.04-.498-.04.498zm-1.72-.49l.489-.11-.489.11zM3.232 1.212L3.514.8l-.282.413zM9.792 8a6.5 6.5 0 00-6.5-6.5v-1a7.5 7.5 0 017.5 7.5h-1zm-6.5 6.5a6.5 6.5 0 006.5-6.5h1a7.5 7.5 0 01-7.5 7.5v-1zm-.525-.02c.173.013.348.02.525.02v1c-.204 0-.405-.008-.605-.024l.08-.997zm-.261-1.83A6.498 6.498 0 005.792 7h1a7.498 7.498 0 01-3.791 6.52l-.495-.87zM5.792 7a6.493 6.493 0 00-2.841-5.374L3.514.8A7.493 7.493 0 016.792 7h-1zm-3.105 8.476c-.528-.042-.985-.077-1.314-.155-.316-.075-.746-.242-.854-.726l.977-.217c-.028-.124-.145-.09.106-.03.237.056.6.086 1.165.131l-.08.997zm.314-1.956c-.622.354-1.045.596-1.31.792a.967.967 0 00-.204.185c-.01.013.027-.038.009-.12l-.977.218a.836.836 0 01.144-.666c.112-.162.27-.3.433-.42.324-.24.814-.519 1.41-.858L3 13.52zM3.292 1.5a.391.391 0 00.374-.285A.382.382 0 003.514.8l-.563.826A.618.618 0 012.702.95a.609.609 0 01.59-.45v1z"
            />
          </svg>
        </div>
        <div className="_layout_change_btn_ic2">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4.389" stroke="#fff" transform="rotate(-90 12 12)" />
            <path
              stroke="#fff"
              strokeLinecap="round"
              d="M3.444 12H1M23 12h-2.444M5.95 5.95L4.222 4.22M19.778 19.779L18.05 18.05M12 3.444V1M12 23v-2.445M18.05 5.95l1.728-1.729M4.222 19.779L5.95 18.05"
            />
          </svg>
        </div>
      </button>
    </div>
  );
}
