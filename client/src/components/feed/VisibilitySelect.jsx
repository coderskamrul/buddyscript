import { cn } from '../../utils/format';

const OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    hint: 'Anyone on Buddy Script can see this post.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M1.6 8h12.8M8 1.6c1.6 1.8 2.4 4 2.4 6.4S9.6 12.6 8 14.4C6.4 12.6 5.6 10.4 5.6 8S6.4 3.4 8 1.6z"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    ),
  },
  {
    value: 'private',
    label: 'Only me',
    hint: 'Only you can see this post.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
];

/**
 * Public/private toggle. Rendered as a radiogroup rather than a <select> so the
 * consequence of each choice ("Only you can see this post") is visible before
 * the user commits — getting this wrong is the one mistake in this app that
 * cannot be taken back.
 */
export default function VisibilitySelect({ value, onChange, disabled = false }) {
  const active = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  return (
    <div className="bs-ui flex items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Who can see this post"
        className="inline-flex rounded-full bg-black/[0.04] p-1 dark:bg-white/10"
      >
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              title={option.hint}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
                selected
                  ? 'bg-white text-brand shadow-sm dark:bg-[#3a3b3c] dark:text-white'
                  : 'text-muted hover:text-ink dark:hover:text-white',
                disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>

      <span className="hidden text-xs text-muted sm:inline">{active.hint}</span>
    </div>
  );
}
