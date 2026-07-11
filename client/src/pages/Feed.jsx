import { useEffect, useRef, useState } from 'react';
import Header from '../components/layout/Header';
import MobileBottomNav from '../components/layout/MobileBottomNav';
import LeftSidebar from '../components/layout/LeftSidebar';
import RightSidebar from '../components/layout/RightSidebar';
import ThemeToggle from '../components/layout/ThemeToggle';
import Stories from '../components/feed/Stories';
import CreatePost from '../components/feed/CreatePost';
import PostCard from '../components/feed/PostCard';
import PostSkeleton from '../components/feed/PostSkeleton';
import { useFeed } from '../hooks/useFeed';
import { cn } from '../utils/format';

const TABS = [
  { value: 'all', label: 'All posts' },
  { value: 'mine', label: 'My posts' },
];

export default function Feed() {
  const [scope, setScope] = useState('all');
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useFeed(scope);

  const sentinelRef = useRef(null);

  // Infinite scroll via IntersectionObserver rather than a scroll listener:
  // a scroll handler fires on every frame and has to measure the DOM to decide
  // anything, which is exactly the kind of jank a feed cannot afford.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      // Start loading before the sentinel is actually visible, so the next page
      // is usually there by the time the user reaches it.
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posts = data?.pages.flatMap((page) => page.posts) ?? [];

  return (
    <div className="_layout _layout_main_wrapper">
      <ThemeToggle />

      <div className="_main_layout">
        <Header />
        <MobileBottomNav />

        <div className="container _custom_container">
          <div className="_layout_inner_wrap">
            <div className="row">
              <LeftSidebar />

              <div className="col-xl-6 col-lg-6 col-md-12 col-sm-12">
                <div className="_layout_middle_wrap">
                  <div className="_layout_middle_inner">
                    <Stories />
                    <CreatePost scope={scope} />

                    {/* New: lets a user confirm at a glance that a private post
                        is theirs alone. Not in the original design, but private
                        posts are invisible in "All posts" without it. */}
                    <div className="bs-ui _mar_b16 flex gap-2 rounded-lg bg-white p-1.5 shadow-card dark:bg-[#242526]">
                      {TABS.map((tab) => (
                        <button
                          key={tab.value}
                          type="button"
                          onClick={() => setScope(tab.value)}
                          aria-pressed={scope === tab.value}
                          className={cn(
                            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
                            scope === tab.value
                              ? 'bg-brand text-white'
                              : 'text-muted hover:bg-black/5 dark:hover:bg-white/10'
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {isLoading ? (
                      <>
                        <PostSkeleton />
                        <PostSkeleton />
                      </>
                    ) : null}

                    {isError ? (
                      <div className="bs-ui _b_radious6 _mar_b16 bg-white p-6 text-center dark:bg-[#242526]">
                        <p className="text-sm text-[#d93025]">
                          {error?.message || 'We could not load the feed.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => refetch()}
                          className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
                        >
                          Try again
                        </button>
                      </div>
                    ) : null}

                    {!isLoading && !isError && posts.length === 0 ? (
                      <div className="bs-ui _b_radious6 _mar_b16 bg-white p-10 text-center dark:bg-[#242526]">
                        <p className="m-0 text-base font-semibold text-ink dark:text-white">
                          {scope === 'mine' ? 'You have not posted yet' : 'Nothing here yet'}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {scope === 'mine'
                            ? 'Anything you post — public or private — will show up here.'
                            : 'Be the first to share something with everyone.'}
                        </p>
                      </div>
                    ) : null}

                    {posts.map((post) => (
                      <PostCard key={post.id} post={post} scope={scope} />
                    ))}

                    {/* Tripwire for the next page. */}
                    <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

                    {isFetchingNextPage ? <PostSkeleton /> : null}

                    {!hasNextPage && posts.length > 0 ? (
                      <p className="bs-ui _mar_b16 py-4 text-center text-sm text-muted">
                        You're all caught up.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <RightSidebar />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
