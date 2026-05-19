import { redis } from '@devvit/web/server';

export type KvLike = {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; count?: number }): Promise<string[]>;
};

export function makeKvStore(): KvLike {
  return {
    async get(key: string): Promise<string | undefined> {
      const val = await redis.get(key);
      return val ?? undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      await redis.del(key);
    },
    async list(): Promise<string[]> {
      return [];
    },
  };
}
