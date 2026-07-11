import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/format';

const ToastContext = createContext(null);

let nextId = 0;

/**
 * Minimal toast system. Errors in this app are mostly network/validation
 * failures on optimistic actions, and silently rolling back with no explanation
 * is the worst possible UX — every mutation surfaces its failure here.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, tone = 'error') => {
      const id = ++nextId;
      setToasts((current) => [...current, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 4500)
      );
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      error: (message) => push(message, 'error'),
      success: (message) => push(message, 'success'),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="bs-ui pointer-events-none fixed bottom-5 left-1/2 z-[1090] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
          // Announced by screen readers without stealing focus.
          role="status"
          aria-live="polite"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-card',
                toast.tone === 'success' ? 'bg-[#0f9d58] text-white' : 'bg-[#d93025] text-white'
              )}
            >
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="shrink-0 opacity-80 transition hover:opacity-100"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M1 1l12 12M13 1L1 13"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a <ToastProvider>.');
  return context;
}
