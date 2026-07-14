import { User } from '../models/User.js';

export const findById = (id) => User.findById(id).lean();

export const findByIdWithSessions = (id) => User.findById(id).select('+sessions');

/** Password and sessions are `select: false`, so they must be asked for by name. */
export const findByEmailWithSecrets = (email) =>
  User.findOne({ email }).select('+password +sessions');

export const existsByEmail = (email) => User.exists({ email });

export const create = (data) => User.create(data);

export const replaceSessions = (id, sessions) => User.updateOne({ _id: id }, { $set: { sessions } });

export const pullSession = (id, tokenHash) =>
  User.updateOne({ _id: id }, { $pull: { sessions: { tokenHash } } });

/**
 * The push-vs-pull routing read, on the write path of every post. One document,
 * two fields — kept deliberately tiny because a post creation waits on it.
 */
export const findReach = (id) => User.findById(id).select('followerCount').lean();
