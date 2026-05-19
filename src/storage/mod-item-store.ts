import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import { parseIndexList } from './index-list';
import type { ModItem } from '../types/mod-item';

export async function saveModItems(kv: KVStore, items: ModItem[]): Promise<void> {
  const existingRaw = await kv.get(KEYS.modItemIndex);
  const existing = parseIndexList(existingRaw);
  const newIds = items.map((i) => i.id);
  const merged = Array.from(new Set([...existing, ...newIds]));
  await Promise.all(items.map((item) => kv.put(KEYS.modItem(item.id), JSON.stringify(item))));
  await kv.put(KEYS.modItemIndex, JSON.stringify(merged));
}

export async function saveModItem(kv: KVStore, item: ModItem): Promise<void> {
  await kv.put(KEYS.modItem(item.id), JSON.stringify(item));
  const existingRaw = await kv.get(KEYS.modItemIndex);
  const existing = parseIndexList(existingRaw);
  if (!existing.includes(item.id)) {
    existing.push(item.id);
    await kv.put(KEYS.modItemIndex, JSON.stringify(existing));
  }
}

export async function getAllModItemIds(kv: KVStore): Promise<string[]> {
  const raw = await kv.get(KEYS.modItemIndex);
  return parseIndexList(raw);
}

export async function getModItem(kv: KVStore, id: string): Promise<ModItem | null> {
  const raw = await kv.get(KEYS.modItem(id));
  return raw ? JSON.parse(raw as string) : null;
}
