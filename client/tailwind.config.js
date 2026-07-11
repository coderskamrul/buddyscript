/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // The design's own dark theme is driven by an `._dark_wrapper` class on the
  // layout root, so Tailwind's `dark:` variant is wired to that same class
  // rather than introducing a second, competing dark-mode mechanism.
  darkMode: ['selector', '._dark_wrapper'],
  corePlugins: {
    // The supplied design ships its own reset via common.css/bootstrap.min.css.
    // Tailwind's preflight would fight it and visibly change the design.
    preflight: false,
    // Bootstrap's .container drives the whole page layout. Tailwind defines a
    // .container too, and it would win the cascade and break every grid row.
    container: false,
    // Tailwind's visibility utilities include `.collapse` (visibility: collapse),
    // which is the SAME class name Bootstrap puts on the navbar. Tailwind loads
    // last, so it won, and the entire header (search, nav icons, profile menu)
    // rendered invisible. Dropping this plugin gives up `visible`/`invisible`,
    // which this app does not use, and hands `.collapse` back to Bootstrap.
    visibility: false,
  },
  theme: {
    extend: {
      colors: {
        // Pulled from the design's own palette so new UI matches the old.
        brand: '#377DFF',
        ink: '#1A1A1A',
        muted: '#666666',
      },
      boxShadow: {
        card: '0 4px 20px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
};
