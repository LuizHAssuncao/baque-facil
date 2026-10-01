export const OFFLINE_MESSAGE = "baque-facil-offline";
export const OFFLINE_CACHE_PREFIX = "baque-facil-";

export type OfflineStatus = {
  type: typeof OFFLINE_MESSAGE;
  release: string;
  ready: boolean;
  count: number;
  missing: number;
  windows?: number;
};
