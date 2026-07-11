import Modal from '../ui/Modal';
import { useLikers } from '../../hooks/useLike';
import { avatarFor } from '../../utils/format';

/**
 * "Who liked this" for a post, comment or reply. Paginated — a post with 40,000
 * likes must not try to render 40,000 rows.
 */
export default function LikersModal({ open, onClose, targetType, targetId, title = 'Likes' }) {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLikers({ targetType, targetId, enabled: open });

  const likers = data?.pages.flatMap((page) => page.likers) ?? [];

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {isLoading ? (
        <ul className="space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <li key={row} className="flex items-center gap-3">
              <span className="bs-skeleton h-10 w-10 rounded-full" />
              <span className="bs-skeleton h-4 w-40 rounded" />
            </li>
          ))}
        </ul>
      ) : null}

      {isError ? (
        <p className="py-6 text-center text-sm text-[#d93025]">
          {error?.message || 'Could not load likes.'}
        </p>
      ) : null}

      {!isLoading && !isError && likers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No likes yet. Be the first.</p>
      ) : null}

      {likers.length > 0 ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {likers.map((liker) => (
            <li key={liker.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
              <img
                src={avatarFor(liker)}
                alt=""
                width="40"
                height="40"
                loading="lazy"
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
              <span className="text-sm font-medium text-ink dark:text-white">
                {liker.fullName}
                {liker.isMe ? <span className="ml-1 font-normal text-muted">(You)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasNextPage ? (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-3 w-full rounded-lg border border-black/10 py-2 text-sm font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60"
        >
          {isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </Modal>
  );
}
