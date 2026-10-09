import { createClient } from "@supabase/supabase-js";
import type {
  ControllerCommand,
  ControllerScreenStatus,
  RoomCredentials,
} from "@/lib/controller-relay";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRoomCredentials(value: unknown): value is RoomCredentials {
  if (!value || typeof value !== "object") return false;
  const credentials = value as Partial<RoomCredentials>;
  return typeof credentials.roomId === "string" &&
    UUID_PATTERN.test(credentials.roomId) &&
    typeof credentials.roomKey === "string" &&
    UUID_PATTERN.test(credentials.roomKey);
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured on the server.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function validScreenStatus(status: unknown): status is ControllerScreenStatus {
  if (!status || typeof status !== "object") return false;
  const value = status as ControllerScreenStatus;
  return typeof value.phase === "string" && (
    value.decision === null || (
      Boolean(value.decision) &&
      Number.isInteger(value.decision.key) &&
      typeof value.decision.title === "string" &&
      typeof value.decision.description === "string" &&
      Number.isInteger(value.decision.help) &&
      Array.isArray(value.decision.teams) &&
      value.decision.teams.every(team =>
        typeof team.id === "string" &&
        typeof team.name === "string" &&
        typeof team.color === "string"
      )
    )
  );
}

function validCommand(command: unknown): command is ControllerCommand {
  if (!command || typeof command !== "object") return false;
  const value = command as ControllerCommand;
  return (
    (value.type === "roll" &&
      Number.isInteger(value.value) &&
      value.value >= 1 && value.value <= 6) ||
    (value.type === "decision" &&
      Boolean(value.choices) &&
      typeof value.choices === "object" &&
      Object.keys(value.choices).length > 0 &&
      Object.values(value.choices).every(choice => choice === "help" || choice === "pass"))
  );
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.action === "create") {
    const credentials = { roomId: body.roomId, roomKey: body.roomKey };
    if (!isRoomCredentials(credentials)) {
      return Response.json({ error: "Invalid game room credentials." }, { status: 400 });
    }
    try {
      const { data, error } = await getSupabase().rpc("cash_dash_create_room", {
        p_room_id: credentials.roomId,
        p_room_key: credentials.roomKey,
        p_initial_state: null,
      });
      if (error) throw error;
      if (!data) return Response.json({ error: "Could not create the game room." }, { status: 409 });
      return Response.json({ created: true });
    } catch (error) {
      console.error("Cash Dash room creation failed", error);
      return Response.json({ error: "Could not create a shared game room." }, { status: 503 });
    }
  }

  const credentials = { roomId: body.roomId, roomKey: body.roomKey };
  if (!isRoomCredentials(credentials)) {
    return Response.json({ error: "A valid game room link is required." }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    if (body.action === "poll") {
      const { data, error } = await supabase.rpc("cash_dash_get_room", {
        p_room_id: credentials.roomId,
        p_room_key: credentials.roomKey,
        p_since: Math.max(0, Number(body.since ?? 0) || 0),
        p_mark_screen_seen: body.screenSeen === true,
      });
      if (error) throw error;
      if (!data) return Response.json({ error: "Game room not found." }, { status: 404 });
      const response = body.includeRealtimeConfig === true
        ? {
            ...data,
            realtime: {
              url: process.env.SUPABASE_URL,
              publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
            },
          }
        : data;
      return Response.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    if (Object.prototype.hasOwnProperty.call(body, "gameState")) {
      if (!body.gameState || typeof body.gameState !== "object" || JSON.stringify(body.gameState).length > 100_000) {
        return Response.json({ error: "Invalid game state." }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("cash_dash_set_game_state", {
        p_room_id: credentials.roomId,
        p_room_key: credentials.roomKey,
        p_game_state: body.gameState,
      });
      if (error) throw error;
      if (!data) return Response.json({ error: "Game room not found." }, { status: 404 });
      return Response.json({ stored: true });
    }

    if (Object.prototype.hasOwnProperty.call(body, "screenStatus")) {
      if (!validScreenStatus(body.screenStatus)) {
        return Response.json({ error: "Invalid game screen status." }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("cash_dash_set_screen_status", {
        p_room_id: credentials.roomId,
        p_room_key: credentials.roomKey,
        p_screen_status: body.screenStatus,
      });
      if (error) throw error;
      if (!data) return Response.json({ error: "Game room not found." }, { status: 404 });
      return Response.json({ stored: true });
    }

    if (!validCommand(body.command)) {
      return Response.json({ error: "Invalid facilitator input." }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("cash_dash_send_command", {
      p_room_id: credentials.roomId,
      p_room_key: credentials.roomKey,
      p_command: body.command,
    });
    if (error) throw error;
    if (data === null) return Response.json({ error: "Game room not found." }, { status: 404 });
    return Response.json({ sent: true, id: data });
  } catch (error) {
    console.error("Cash Dash room update failed", error);
    return Response.json({ error: "Could not update the shared game room." }, { status: 503 });
  }
}
