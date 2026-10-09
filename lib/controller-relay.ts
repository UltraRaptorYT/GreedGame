export type ControllerCommand =
  | { type: "roll"; value: number }
  | { type: "decision"; choices: Record<string, "help" | "pass"> };

export type ControllerScreenStatus = {
  phase: string;
  decision: null | {
    key: number;
    title: string;
    description: string;
    help: number;
    teams: Array<{ id: string; name: string; color: string }>;
  };
};

export type RoomCredentials = { roomId: string; roomKey: string };
