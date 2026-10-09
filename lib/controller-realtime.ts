import { createClient } from "@supabase/supabase-js";

export type RoomRealtimeConfig = {
  url: string;
  publishableKey: string;
};

export function createRoomRealtimeClient(config: RoomRealtimeConfig) {
  return createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
