/**
 * Seeds a small, realistic dataset so the feed can be reviewed without clicking
 * through registration first.
 *
 *   npm run seed          (from /server)
 *
 * Every seeded user's password is Passw0rd123. Sign in as demo@buddyscript.dev.
 * Safe to re-run: it clears only the records it created.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/User.js';
import { Post, VISIBILITY } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { Like, TARGET_TYPE } from '../models/Like.js';

const PASSWORD = 'Passw0rd123';

const PEOPLE = [
  { firstName: 'Demo', lastName: 'User', email: 'demo@buddyscript.dev' },
  { firstName: 'Karim', lastName: 'Saif', email: 'karim@buddyscript.dev' },
  { firstName: 'Radovan', lastName: 'Skillarena', email: 'radovan@buddyscript.dev' },
  { firstName: 'Steve', lastName: 'Jobs', email: 'steve@buddyscript.dev' },
];

const POSTS = [
  { by: 1, content: '-Healthy Tracking App', image: '/assets/images/timeline_img.png', visibility: VISIBILITY.PUBLIC },
  { by: 2, content: 'Shipped the new design system today. Six months of work finally in production.', visibility: VISIBILITY.PUBLIC },
  { by: 3, content: 'Stay hungry, stay foolish.', visibility: VISIBILITY.PUBLIC },
  { by: 0, content: 'My private notes to self — nobody else can see this one.', visibility: VISIBILITY.PRIVATE },
  { by: 0, content: 'First day on Buddy Script. Say hello!', visibility: VISIBILITY.PUBLIC },
];

const COMMENTS = [
  { post: 0, by: 2, content: 'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout.' },
  { post: 0, by: 3, content: 'Clean work. What did you build the charts with?' },
  { post: 1, by: 0, content: 'Congratulations! This looks great.' },
  { post: 4, by: 1, content: 'Welcome aboard 👋' },
];

const REPLIES = [
  { comment: 0, by: 1, content: 'Thanks! Took a while to get the spacing right.' },
  { comment: 0, by: 0, content: 'Agreed, the typography really carries it.' },
  { comment: 1, by: 1, content: 'Recharts, with a custom theme.' },
];

async function seed() {
  await connectDatabase();

  const emails = PEOPLE.map((person) => person.email);
  const existing = await User.find({ email: { $in: emails } }).select('_id').lean();
  const existingIds = existing.map((user) => user._id);

  if (existingIds.length) {
    const posts = await Post.find({ author: { $in: existingIds } }).select('_id').lean();
    const postIds = posts.map((post) => post._id);
    const comments = await Comment.find({ post: { $in: postIds } }).select('_id').lean();
    const commentIds = comments.map((comment) => comment._id);

    await Promise.all([
      Like.deleteMany({ target: { $in: [...postIds, ...commentIds] } }),
      Comment.deleteMany({ post: { $in: postIds } }),
      Post.deleteMany({ _id: { $in: postIds } }),
      User.deleteMany({ _id: { $in: existingIds } }),
    ]);
    console.log(`[seed] cleared ${existingIds.length} previous demo users and their content`);
  }

  // create() (not insertMany) so the pre-save hook hashes each password.
  const users = [];
  for (const person of PEOPLE) {
    users.push(await User.create({ ...person, password: PASSWORD }));
  }
  console.log(`[seed] created ${users.length} users`);

  const posts = [];
  for (const spec of POSTS) {
    posts.push(
      await Post.create({
        author: users[spec.by]._id,
        content: spec.content,
        image: spec.image ?? null,
        visibility: spec.visibility,
      })
    );
  }
  console.log(`[seed] created ${posts.length} posts (1 private)`);

  const comments = [];
  for (const spec of COMMENTS) {
    comments.push(
      await Comment.create({
        post: posts[spec.post]._id,
        author: users[spec.by]._id,
        content: spec.content,
      })
    );
  }

  const replies = [];
  for (const spec of REPLIES) {
    const parent = comments[spec.comment];
    replies.push(
      await Comment.create({
        post: parent.post,
        author: users[spec.by]._id,
        parent: parent._id,
        content: spec.content,
      })
    );
  }
  console.log(`[seed] created ${comments.length} comments and ${replies.length} replies`);

  // Likes, spread across posts, comments and replies.
  const likes = [];
  const addLike = (userIdx, targetType, target) =>
    likes.push({ user: users[userIdx]._id, targetType, target: target._id });

  [0, 1, 2, 3].forEach((idx) => addLike(idx, TARGET_TYPE.POST, posts[0]));
  [0, 3].forEach((idx) => addLike(idx, TARGET_TYPE.POST, posts[1]));
  [0, 1, 2].forEach((idx) => addLike(idx, TARGET_TYPE.POST, posts[2]));
  [1, 2].forEach((idx) => addLike(idx, TARGET_TYPE.COMMENT, comments[0]));
  addLike(0, TARGET_TYPE.COMMENT, comments[1]);
  [0, 2].forEach((idx) => addLike(idx, TARGET_TYPE.COMMENT, replies[0]));

  await Like.insertMany(likes);

  // Rebuild the denormalized counters from the rows we just wrote, so the seeded
  // state is exactly what the app's own $inc path would have produced.
  for (const post of posts) {
    const [likeCount, commentCount] = await Promise.all([
      Like.countDocuments({ targetType: TARGET_TYPE.POST, target: post._id }),
      Comment.countDocuments({ post: post._id }),
    ]);
    await Post.updateOne({ _id: post._id }, { $set: { likeCount, commentCount } });
  }

  for (const comment of [...comments, ...replies]) {
    const [likeCount, replyCount] = await Promise.all([
      Like.countDocuments({ targetType: TARGET_TYPE.COMMENT, target: comment._id }),
      Comment.countDocuments({ parent: comment._id }),
    ]);
    await Comment.updateOne({ _id: comment._id }, { $set: { likeCount, replyCount } });
  }

  console.log(`[seed] created ${likes.length} likes and rebuilt counters`);

  // Make sure the indexes declared on the schemas actually exist in Atlas.
  await Promise.all([
    User.syncIndexes(),
    Post.syncIndexes(),
    Comment.syncIndexes(),
    Like.syncIndexes(),
  ]);
  console.log('[seed] indexes synced');

  console.log('\nDone. Sign in with:');
  console.log('  email:    demo@buddyscript.dev');
  console.log(`  password: ${PASSWORD}`);

  await disconnectDatabase();
  process.exit(0);
}

seed().catch(async (error) => {
  console.error('[seed] failed:', error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
