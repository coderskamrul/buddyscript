/**
 * The field sets read paths are allowed to pull.
 *
 * A `.populate('author')` with no projection pulls the entire user document into
 * every post of every page — including the password hash and the session array,
 * which are `select: false` and so would not actually leak, but also including
 * every field anyone ever adds to User in the future, which might. Naming the
 * fields once, here, makes "what does a post's author look like on the wire" a
 * single decision instead of a string repeated across five files.
 */
export const AUTHOR_FIELDS = 'firstName lastName avatar';
