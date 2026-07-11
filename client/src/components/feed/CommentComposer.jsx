import { forwardRef, useState } from 'react';
import { avatarFor } from '../../utils/format';

const MAX_CHARS = 2000;

/**
 * The comment/reply input, reusing the design's own `_feed_inner_comment_box`
 * markup. Enter submits, Shift+Enter makes a newline — the convention people
 * already expect from every comment box they've used.
 */
const CommentComposer = forwardRef(function CommentComposer(
  { currentUser, onSubmit, pending, placeholder = 'Write a comment', autoFocus = false, onCancel },
  ref
) {
  const [value, setValue] = useState('');

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || pending) return;

    // Clear optimistically so the box is ready for the next comment; restore the
    // text if the request fails, otherwise the user loses what they typed.
    setValue('');
    try {
      await onSubmit(trimmed);
    } catch {
      setValue(trimmed);
    }
  };

  return (
    <div className="_feed_inner_comment_box">
      <form
        className="_feed_inner_comment_box_form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="_feed_inner_comment_box_content">
          <div className="_feed_inner_comment_box_content_image">
            <img src={avatarFor(currentUser)} alt="" className="_comment_img" />
          </div>
          <div className="_feed_inner_comment_box_content_txt">
            <textarea
              ref={ref}
              className="form-control _comment_textarea bs-autosize"
              placeholder={placeholder}
              value={value}
              maxLength={MAX_CHARS}
              autoFocus={autoFocus}
              aria-label={placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
                if (event.key === 'Escape' && onCancel) onCancel();
              }}
            />
          </div>
        </div>

        <div className="_feed_inner_comment_box_icon">
          <button
            type="submit"
            className="_feed_inner_comment_box_icon_btn"
            disabled={!value.trim() || pending}
            aria-label="Post comment"
            title="Post comment"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 14 13" aria-hidden="true">
              <path
                fill="#377DFF"
                fillRule="evenodd"
                d="M6.37 7.879l2.438 3.955a.335.335 0 00.34.162c.068-.01.23-.05.289-.247l3.049-10.297a.348.348 0 00-.09-.35.341.341 0 00-.34-.088L1.75 4.03a.34.34 0 00-.247.289.343.343 0 00.16.347L5.666 7.17 9.2 3.597a.5.5 0 01.712.703L6.37 7.88zM9.097 13c-.464 0-.89-.236-1.14-.641L5.372 8.165l-4.237-2.65a1.336 1.336 0 01-.622-1.331c.074-.536.441-.96.957-1.112L11.774.054a1.347 1.347 0 011.67 1.682l-3.05 10.296A1.332 1.332 0 019.098 13z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
});

export default CommentComposer;
