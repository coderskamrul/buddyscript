import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small accessible dialog. The design ships no modal, so this is new Tailwind
 * UI — but it still has to behave: Escape closes it, a backdrop click closes it,
 * focus moves into it, the page behind it does not scroll, and focus returns to
 * whatever opened it.
 */
export default function Modal({ open, onClose, title, children, footer }) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    panelRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    // A modal over a scrollable feed that still scrolls the feed is a classic
    // annoyance; lock the body while it is open.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="bs-ui fixed inset-0 z-[1080] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        // Only a click that starts on the backdrop closes — dragging a text
        // selection out of the panel should not dismiss it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-card outline-none dark:bg-[#242526]"
      >
        <header className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-ink dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M1 1l12 12M13 1L1 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <footer className="border-t border-black/5 px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
