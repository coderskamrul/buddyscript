/** Placeholder shown while the first feed page loads, shaped like a real post
 *  card so the layout doesn't jump when the content arrives. */
export default function PostSkeleton() {
  return (
    <div
      className="_feed_inner_timeline_post_area _b_radious6 _padd_b24 _padd_t24 _mar_b16 bs-ui"
      aria-hidden="true"
    >
      <div className="_padd_r24 _padd_l24">
        <div className="flex items-center gap-3">
          <span className="bs-skeleton h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <span className="bs-skeleton block h-4 w-40 rounded" />
            <span className="bs-skeleton block h-3 w-24 rounded" />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <span className="bs-skeleton block h-4 w-full rounded" />
          <span className="bs-skeleton block h-4 w-4/5 rounded" />
        </div>

        <span className="bs-skeleton mt-4 block h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}
