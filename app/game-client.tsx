"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import type {
  ControllerCommand,
  ControllerScreenStatus,
  RoomCredentials,
} from "@/lib/controller-relay";
import {
  createRoomRealtimeClient,
  type RoomRealtimeConfig,
} from "@/lib/controller-realtime";
import {
  addHistory,
  advanceTurn,
  changeMoney,
  createGame,
  DECISION_EVENTS,
  drawTreasure,
  formatMoney,
  getCurrentTeam,
  normalizeGameState,
  randomIndex,
  REFLECTION_PROMPTS,
  restoreSnapshot,
  scheduleDelayed,
  snapshot,
  TEAM_COLORS,
  TEAM_NAMES,
  type GameSnapshot,
  type GameState,
  type Team,
} from "@/lib/game";

const SAVE_KEY = "greed-game-session-v2";
const ROOM_KEY = "cash-dash-room-v1";
const subscribeSaveStatus = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("zest-save-updated", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("zest-save-updated", callback);
  };
};
const getSaveStatus = () => Boolean(window.localStorage.getItem(SAVE_KEY));

function teamById(game: GameState, id: string) {
  return game.teams.find((team) => team.id === id);
}
function GameButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return (
    <button
      className={`game-button ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const diePips: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DiceRoller({ value, rolling }: { value: number; rolling: boolean }) {
  const angles = useRef({ x: 0, y: 0, z: 0 });
  const [transform, setTransform] = useState("rotateX(0deg) rotateY(0deg) rotateZ(0deg)");

  useEffect(() => {
    if (!rolling) return;
    const tops: Record<number, { x: number; y: number; z: number }> = {
      1: { x: 0, y: 0, z: -90 },
      2: { x: 0, y: 0, z: 0 },
      3: { x: 90, y: 0, z: 0 },
      4: { x: -90, y: 0, z: 0 },
      5: { x: 180, y: 0, z: 0 },
      6: { x: 0, y: 0, z: 90 },
    };
    const top = tops[value] ?? tops[1];
    const next = { ...angles.current };
    for (const axis of ["x", "y", "z"] as const) {
      const current = next[axis];
      const remainder = ((current % 360) + 360) % 360;
      const delta = (top[axis] - remainder + 360) % 360;
      next[axis] = current + delta + (3 + Math.floor(Math.random() * 3)) * 360;
    }
    angles.current = next;
    const frame = window.requestAnimationFrame(() => {
      setTransform(`rotateX(${next.x}deg) rotateY(${next.y}deg) rotateZ(${next.z}deg)`);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [rolling, value]);

  return (
    <span className={`dice3d-stage ${rolling ? "is-rolling" : ""}`} aria-label={`Die showing ${value}`}>
      <span className="dice3d-shadow" />
      <span className="dice3d-cube" style={{ transform }}>
        {[1, 6, 2, 5, 3, 4].map((face) => (
          <span className={`dice3d-face face-${face}`} key={face}>
            <span className="dice3d-pips">
              {Array.from({ length: 9 }, (_, i) => (
                <i className={diePips[face].includes(i) ? "pip-on" : ""} key={i} />
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

export default function GameClient() {
  const [game, setGame] = useState<GameState>(() => createGame());
  const [roomCredentials, setRoomCredentials] =
    useState<RoomCredentials | null>(null);
  const [realtimeConfig, setRealtimeConfig] =
    useState<RoomRealtimeConfig | null>(null);
  const [roomReady, setRoomReady] = useState(false);
  const savedExists = useSyncExternalStore(
    subscribeSaveStatus,
    getSaveStatus,
    () => false,
  );
  const [setupNames, setSetupNames] = useState([...TEAM_NAMES]);
  const [setupConfig, setSetupConfig] = useState({
    startingMoney: 1000,
  });
  const [showTeacher, setShowTeacher] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [contributions, setContributions] = useState<Record<string, number>>(
    {},
  );
  const [revealedReflection, setRevealedReflection] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [rollingResult, setRollingResult] = useState<number | null>(null);
  const [walkingToken, setWalkingToken] = useState<{
    teamId: string;
    position: number;
  } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [controllerLinkCopied, setControllerLinkCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(22 * 60);
  const lastRemoteCommand = useRef(0);
  const remoteCommandHandler = useRef<(command: ControllerCommand) => void>(
    () => undefined,
  );
  const stateSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const controllerHref = roomCredentials
    ? `/controller#room=${encodeURIComponent(roomCredentials.roomId)}&key=${encodeURIComponent(roomCredentials.roomKey)}`
    : "/controller";
  const copyControllerLink = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(controllerHref, window.location.href).toString(),
      );
      setControllerLinkCopied(true);
      window.setTimeout(() => setControllerLinkCopied(false), 2500);
    } catch {
      setNotice(
        "Open the facilitator menu and copy the phone controller link from the address bar.",
      );
    }
  };

  useEffect(() => {
    let active = true;
    const initializeRoom = async () => {
      try {
        let credentials: RoomCredentials | null = null;

        if (!credentials) {
          const raw = window.localStorage.getItem(ROOM_KEY);
          if (raw) {
            try {
              credentials = JSON.parse(raw) as RoomCredentials;
            } catch {
              window.localStorage.removeItem(ROOM_KEY);
            }
          }
        }

        if (!credentials) {
          credentials = {
            roomId: crypto.randomUUID(),
            roomKey: crypto.randomUUID(),
          };
          const created = await fetch("/api/controller", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create", ...credentials }),
          });
          if (!created.ok) throw new Error("Could not create the shared room.");
        }

        if (!active) return;
        window.localStorage.setItem(ROOM_KEY, JSON.stringify(credentials));
        setRoomCredentials(credentials);
        const response = await fetch("/api/controller", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "poll",
            ...credentials,
            screenSeen: true,
            includeRealtimeConfig: true,
          }),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load the shared room.");
        const result = (await response.json()) as {
          gameState?: GameState | null;
          commandId?: number;
          realtime?: RoomRealtimeConfig;
        };
        if (!active) return;
        if (result.gameState) setGame(normalizeGameState(result.gameState));
        if (result.realtime) setRealtimeConfig(result.realtime);
        lastRemoteCommand.current = result.commandId ?? 0;
        setRoomReady(true);
      } catch {
        if (active) setRoomReady(true);
      }
    };
    void initializeRoom();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (game.phase !== "setup") {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
      window.dispatchEvent(new Event("zest-save-updated"));
    }
  }, [game]);

  useEffect(() => {
    if (!roomCredentials || !roomReady) return;
    const saveState = async () => {
      try {
        await fetch("/api/controller", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...roomCredentials, gameState: game }),
        });
      } catch {
        /* Keep the classroom board usable while the room reconnects. */
      }
    };
    stateSaveQueue.current = stateSaveQueue.current.then(saveState, saveState);
  }, [game, roomCredentials, roomReady]);

  useEffect(() => {
    if (game.phase === "setup" || game.phase === "finished") return;
    const timer = window.setInterval(
      () =>
        setRemainingSeconds((seconds) => {
          return Math.max(0, seconds - 1);
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [game.phase]);

  const currentTeam = getCurrentTeam(game);
  const activeEvent =
    DECISION_EVENTS[game.decisionIndex % DECISION_EVENTS.length];
  const screenTeamKey = game.teams
    .map(({ id, name, color }) => `${id}:${name}:${color}`)
    .join("|");
  useEffect(() => {
    if (!roomCredentials) return;
    const screenStatus: ControllerScreenStatus = {
      phase: game.phase,
      decision:
        game.phase === "decision"
          ? {
              key: game.decisionIndex,
              title: activeEvent.title,
              description: activeEvent.description,
              help: activeEvent.help,
              teams: game.teams.map(({ id, name, color }) => ({
                id,
                name,
                color,
              })),
            }
          : null,
    };
    void fetch("/api/controller", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...roomCredentials, screenStatus }),
    }).catch(() => {
      /* Keep the local game running when no phone is connected. */
    });
  }, [game.phase, game.decisionIndex, screenTeamKey, roomCredentials]);
  const safeUpdate = useCallback((fn: (current: GameState) => GameState) => {
    setGame((current) => {
      const before = snapshot(current);
      const changed = fn(current);
      return { ...changed, lastSnapshot: before };
    });
  }, []);

  const startGame = () => {
    const next = createGame(setupNames, {
      ...setupConfig,
      moneyDeck: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    });
    next.phase = "playing";
    next.history = [
      {
        id: crypto.randomUUID(),
        round: 1,
        message: "Cash Dash begins!",
        kind: "system",
      },
    ];
    setGame(next);
    setRemainingSeconds(22 * 60);
    setRevealedReflection(false);
  };
  const resumeGame = () => {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    try {
      setGame(normalizeGameState(JSON.parse(raw) as GameState));
    } catch {
      window.localStorage.removeItem(SAVE_KEY);
      window.dispatchEvent(new Event("zest-save-updated"));
    }
  };
  const newGame = () => {
    if (
      !window.confirm("Start a new game? This will replace the saved session.")
    )
      return;
    window.localStorage.removeItem(SAVE_KEY);
    window.dispatchEvent(new Event("zest-save-updated"));
    setGame(createGame());
    setShowTeacher(false);
  };
  const endGame = () =>
    safeUpdate((current) => {
      let next: GameState = {
        ...current,
        phase: "finished",
        pendingEvents: [],
        eventResults: [],
        activeCard: null,
        selectedAction: null,
        moneyDraw: null,
        treasurePot: 0,
        treasureDraws: 0,
        decisionChoices: {},
        eventMessage: null,
        finishAfterEvent: false,
      };
      for (const event of current.pendingEvents) {
        if (event.choice === "help") {
          next = changeMoney(next, event.teamId, event.amount, event.message);
        } else {
          next = addHistory(
            next,
            `${teamById(current, event.teamId)?.name ?? "A team"} passed on ${event.title} and kept their money.`,
            "choice",
          );
        }
      }
      return addHistory(next, "The facilitator ended the game.", "system");
    });
  const landOnTile = (
    teamIndex: number,
    position: number,
    start: number,
    state: GameState,
    eventIndex: number,
    specialRoll: number,
  ) => {
    let next: GameState = { ...state, phase: "playing" };
    const tile = next.board[position];
    const team = next.teams[teamIndex];
    next = addHistory(next, `${team.name} landed on ${tile.title}.`, "system");
    if (position < start)
      next = changeMoney(next, team.id, 200, "passed Launch Pad (+$200)");
    if (tile.type === "action")
      return {
        ...next,
        activeCard: "ACTION",
        selectedAction: null,
        moneyDraw: null,
      };
    if (tile.type === "treasure")
      return {
        ...next,
        activeCard: "TREASURE",
        treasurePot: 0,
        treasureDraws: 0,
      };
    if (tile.type === "decision") {
      return {
        ...next,
        phase: "decision" as const,
        decisionIndex: eventIndex,
        decisionChoices: {},
        activeCard: DECISION_EVENTS[eventIndex].id,
      };
    }
    if (tile.type === "special") {
      const outcomes = [
        { amount: 300, reason: "found a supply crate (+$300)" },
        { amount: -200, reason: "paid a repair fee (−$200)" },
        { amount: 100, reason: "received a welcome bonus (+$100)" },
        { amount: 0, reason: "nothing changed" },
      ];
      const outcome = outcomes[specialRoll % outcomes.length];
      const changed = changeMoney(
        next,
        team.id,
        outcome.amount,
        outcome.reason,
      );
      return {
        ...changed,
        activeCard: "RESOLVED",
        eventMessage: outcome.reason,
      };
    }
    return { ...next, activeCard: "RESOLVED" };
  };
  const roll = async (value: number) => {
    if (isRolling || game.phase !== "playing" || game.activeCard) return;
    const rollingTeam = getCurrentTeam(game);
    const start = rollingTeam.position;
    const eventIndex = randomIndex(DECISION_EVENTS.length);
    const specialRoll = randomIndex(4);
    setIsRolling(true);
    setRollingResult(value);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    for (let step = 1; step <= value; step += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 115));
      setWalkingToken({
        teamId: rollingTeam.id,
        position: (start + step) % game.board.length,
      });
    }
    safeUpdate((state) => {
      const index = state.currentTeam;
      const before = state.teams[index].position;
      const after = (before + value) % state.board.length;
      let moved: GameState = {
        ...state,
        diceValue: value,
        teams: state.teams.map((team, i) =>
          i === index ? { ...team, position: after } : team,
        ),
      };
      moved = addHistory(
        moved,
        `${state.teams[index].name} rolled ${value} and moved to ${state.board[after].title}.`,
        "system",
      );
      return landOnTile(index, after, before, moved, eventIndex, specialRoll);
    });
    setWalkingToken(null);
    setIsRolling(false);
  };
  const finishTurn = () =>
    safeUpdate((current) =>
      advanceTurn({
        ...current,
        activeCard: null,
        eventMessage: null,
        phase: "playing",
      }),
    );
  const chooseAction = (action: "give" | "take" | "rob") => {
    safeUpdate((current) => ({
      ...current,
      lastSnapshot: snapshot(current),
      selectedAction: action,
      moneyDraw: null,
      activeCard: "WAITING-ACTION-CARD",
    }));
  };
  const enterActionCard = (value: number) => {
    if (game.activeCard !== "WAITING-ACTION-CARD") return;
    safeUpdate((current) => ({
      ...current,
      moneyDraw: value * 100,
      activeCard: current.selectedAction?.toUpperCase() ?? "ACTION",
    }));
  };

  const settleAction = (targetId?: string) =>
    safeUpdate((current) => {
      if (!current.selectedAction || current.moneyDraw === null) return current;
      const team = getCurrentTeam(current);
      const amount = current.moneyDraw;
      let next = { ...current };
      if (current.selectedAction === "give") {
        const given = Math.min(team.money, amount);
        next = changeMoney(
          next,
          team.id,
          -given,
          `gave ${formatMoney(given)} to the Community Chest`,
        );
        next = {
          ...next,
          communityChest: next.communityChest + given,
          teams: next.teams.map((t) =>
            t.id === team.id
              ? {
                  ...t,
                  stats: {
                    ...t.stats,
                    amountGiven: t.stats.amountGiven + given,
                    amountContributedToCommunity:
                      t.stats.amountContributedToCommunity + given,
                  },
                }
              : t,
          ),
        };
      } else if (current.selectedAction === "take") {
        const taken = Math.min(next.communityChest, amount);
        next = {
          ...next,
          communityChest: next.communityChest - taken,
          teams: next.teams.map((t) =>
            t.id === team.id
              ? {
                  ...t,
                  stats: {
                    ...t.stats,
                    amountTakenFromCommunity:
                      t.stats.amountTakenFromCommunity + taken,
                  },
                }
              : t,
          ),
        };
        next = changeMoney(
          next,
          team.id,
          taken,
          `took ${formatMoney(taken)} from the Community Chest`,
        );
      } else if (current.selectedAction === "rob" && targetId) {
        const target = teamById(next, targetId);
        if (target) {
          const taken = Math.min(target.money, amount);
          next = changeMoney(
            next,
            targetId,
            -taken,
            `was robbed by ${team.name}`,
          );
          next = changeMoney(
            next,
            team.id,
            taken,
            `took ${formatMoney(taken)} from ${target.name}`,
          );
          next = {
            ...next,
            teams: next.teams.map((t) =>
              t.id === team.id
                ? {
                    ...t,
                    stats: {
                      ...t.stats,
                      amountStolen: t.stats.amountStolen + taken,
                    },
                  }
                : t,
            ),
          };
        }
      }
      return {
        ...next,
        activeCard: "RESOLVED",
        selectedAction: null,
        moneyDraw: null,
      };
    });

  const drawAgain = (cardValue: number) => {
    if (game.activeCard !== "TREASURE") return;
    const outcome = drawTreasure(cardValue);
    safeUpdate((current) => {
      const team = getCurrentTeam(current);
      const draws = current.treasureDraws + 1;
      let next = {
        ...current,
        treasureDraws: draws,
        teams: current.teams.map((t, i) =>
          i === current.currentTeam
            ? {
                ...t,
                stats: {
                  ...t.stats,
                  treasureDraws: t.stats.treasureDraws + 1,
                  risksTaken:
                    t.stats.risksTaken + (current.treasureDraws > 0 ? 1 : 0),
                },
              }
            : t,
        ),
      };
      if (outcome === "thief") {
        return addHistory(
          {
            ...next,
            activeCard: "THIEF",
            treasurePot: 0,
            phase: "playing",
            eventMessage: `The picture card wiped the unbanked ${formatMoney(current.treasurePot)} pot. Banked tokens are safe.`,
          },
          `${team.name}'s Treasure Temptation ended with a THIEF.`,
          "choice",
        );
      }
      next = {
        ...next,
        treasurePot: current.treasurePot + outcome,
        activeCard: "TREASURE",
        phase: "playing",
      };
      return addHistory(
        next,
        `${team.name} drew ${formatMoney(outcome)} in Treasure Temptation.`,
        "system",
      );
    });
  };
  const bankTreasure = () =>
    safeUpdate((current) => {
      const team = getCurrentTeam(current);
      let next = changeMoney(
        current,
        team.id,
        current.treasurePot,
        `banked ${formatMoney(current.treasurePot)} from Treasure Temptation`,
      );
      next = {
        ...next,
        activeCard: "RESOLVED",
        treasurePot: 0,
        teams: next.teams.map((t) =>
          t.id === team.id
            ? {
                ...t,
                stats: { ...t.stats, timesStopped: t.stats.timesStopped + 1 },
              }
            : t,
        ),
      };
      return addHistory(
        next,
        `${team.name} chose to bank their treasure.`,
        "choice",
      );
    });

  useEffect(() => {
    if (!roomCredentials || !roomReady || !realtimeConfig) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/controller", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "poll",
            ...roomCredentials,
            screenSeen: true,
            since: lastRemoteCommand.current,
          }),
          cache: "no-store",
        });
        const result = (await response.json()) as {
          command: { id: number; value: ControllerCommand } | null;
        };
        if (
          !active ||
          !result.command ||
          result.command.id <= lastRemoteCommand.current
        )
          return;
        lastRemoteCommand.current = result.command.id;
        remoteCommandHandler.current(result.command.value);
      } catch {
        /* Keep local game controls available while the relay reconnects. */
      }
    };
    const supabase = createRoomRealtimeClient(realtimeConfig);
    const channel = supabase
      .channel(`cash-dash:${roomCredentials.roomKey}`)
      .on("broadcast", { event: "room_update" }, () => void poll())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void poll();
      });
    const timer = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [
    roomCredentials,
    roomReady,
    realtimeConfig,
  ]);

  const submitDecision = (updated: Record<string, "help" | "pass">) => {
    if (
      game.phase !== "decision" ||
      !game.teams.every(
        (team) => updated[team.id] === "help" || updated[team.id] === "pass",
      )
    )
      return;
    const eventOutcomes = activeEvent.outcomes;
    const rollsToResolve =
      activeEvent.delayRolls[0] +
      randomIndex(activeEvent.delayRolls[1] - activeEvent.delayRolls[0] + 1);
    const outcomesByTeam = Object.fromEntries(
      game.teams.map((team) => [
        team.id,
        eventOutcomes[randomIndex(eventOutcomes.length)],
      ]),
    );
    safeUpdate((current) => {
      let next: GameState = {
        ...current,
        decisionChoices: updated,
        eventResults: [],
        phase: "playing",
        activeCard: "DECISION-PENDING",
      };
      const event = activeEvent;
      next = addHistory(next, `Class decision: ${event.title}`, "choice");
      for (const team of next.teams) {
        if (updated[team.id] === "help") {
          next = changeMoney(
            next,
            team.id,
            -event.help,
            `helped in ${event.title} (−${formatMoney(event.help)})`,
          );
          next = {
            ...next,
            teams: next.teams.map((t) =>
              t.id === team.id
                ? {
                    ...t,
                    stats: {
                      ...t.stats,
                      amountGiven: t.stats.amountGiven + event.help,
                      peopleHelped: t.stats.peopleHelped + 1,
                      decisionsHelped: t.stats.decisionsHelped + 1,
                    },
                  }
                : t,
            ),
          };
        } else {
          next = addHistory(
            next,
            `${team.name} chose not to help in ${event.title}.`,
            "choice",
          );
          next = {
            ...next,
            teams: next.teams.map((t) =>
              t.id === team.id
                ? {
                    ...t,
                    stats: {
                      ...t.stats,
                      decisionsDeclined: t.stats.decisionsDeclined + 1,
                    },
                  }
                : t,
            ),
          };
        }
        next = scheduleDelayed(
          next,
          team.id,
          event.title,
          updated[team.id] === "help" ? outcomesByTeam[team.id] : 0,
          rollsToResolve,
          event.id,
          updated[team.id] as "help" | "pass",
        );
      }
      return {
        ...next,
        activeCard: "DECISION-PENDING",
        eventMessage: `Choices for ${event.title} have been recorded. The results will be revealed later.`,
      };
    });
  };

  remoteCommandHandler.current = (command) => {
    if (command.type === "roll" && command.value) void roll(command.value);
    if (command.type === "decision") submitDecision(command.choices);
  };

  const beginCooperation = () =>
    safeUpdate((current) => ({
      ...current,
      phase: "cooperation",
      activeCard: "BROKEN SHIP",
      decisionChoices: {},
      eventMessage: null,
    }));
  const resolveCooperation = () =>
    safeUpdate((current) => {
      let next = { ...current };
      let total = 0;
      for (const team of next.teams) {
        const contribution = Math.min(team.money, contributions[team.id] ?? 0);
        total += contribution;
        next = changeMoney(
          next,
          team.id,
          -contribution,
          `contributed ${formatMoney(contribution)} to the ship repair`,
        );
        next = {
          ...next,
          teams: next.teams.map((t) =>
            t.id === team.id
              ? {
                  ...t,
                  stats: {
                    ...t.stats,
                    amountGiven: t.stats.amountGiven + contribution,
                    cooperationContributed:
                      t.stats.cooperationContributed + contribution,
                  },
                }
              : t,
          ),
        };
      }
      const succeeded = total >= 1500;
      if (succeeded)
        for (const team of next.teams)
          next = changeMoney(
            next,
            team.id,
            400,
            "shared ship-repair reward (+$400)",
          );
      next = addHistory(
        next,
        `Class contributed ${formatMoney(total)}. Ship repair ${succeeded ? "succeeded" : "failed"}.`,
        "choice",
      );
      return {
        ...next,
        phase: "playing",
        activeCard: "RESOLVED",
        eventMessage: `The class raised ${formatMoney(total)}. ${succeeded ? "Ship repaired! Every team receives $400." : "The repair failed. Contributions are spent."}`,
      };
    });

  const triggerDecision = () => {
    const decisionIndex = randomIndex(DECISION_EVENTS.length);
    safeUpdate((current) => ({
      ...current,
      decisionIndex,
      phase: "decision",
      activeCard: "teacher-decision",
      decisionChoices: {},
    }));
  };
  const undo = () => {
    if (game.lastSnapshot)
      setGame(restoreSnapshot(game, game.lastSnapshot as GameSnapshot));
  };
  const adjustMoney = (teamId: string, amount: number) =>
    safeUpdate((current) =>
      changeMoney(
        current,
        teamId,
        amount,
        `teacher adjustment ${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`,
      ),
    );
  const setTeamMoney = (team: Team) => {
    const entered = window.prompt(
      `Set ${team.name}'s money (in $100 steps):`,
      String(team.money),
    );
    if (entered === null) return;
    const money = Number(entered);
    if (!Number.isInteger(money) || money < 0 || money % 100 !== 0) {
      window.alert("Enter a non-negative amount in $100 steps.");
      return;
    }
    adjustMoney(team.id, money - team.money);
  };

  const gridPositions = useMemo(() => {
    const points: [number, number][] = [];
    for (let c = 0; c < 7; c++) points.push([1, c + 1]);
    for (let r = 2; r <= 7; r++) points.push([r, 7]);
    for (let c = 5; c >= 0; c--) points.push([7, c + 1]);
    for (let r = 6; r >= 2; r--) points.push([r, 1]);
    return points;
  }, []);

  if (game.phase === "setup")
    return (
      <main className="setup-shell">
        <header className="brandline">
          <span className="logo-mark">C</span>
          <span>
            CASH DASH <b>CLASSROOM GAME</b>
          </span>
          <span className="brand-spacer" />
          <span className="teacher-badge">FACILITATOR SETUP</span>
        </header>
        <section className="setup-card">
          <div className="setup-copy">
            <div className="eyebrow">A CLASSROOM GAME OF CHOICE</div>
            <h1>
              CASH
              <br />
              <span>DASH</span>
            </h1>
            <p>
              Five teams. The facilitator decides when the game ends.
            </p>
            <div className="setup-facts">
              <span>5 TEAMS</span>
              <span>30 MINUTES</span>
              <span>$100 STEPS</span>
            </div>
          </div>
          <div className="setup-form">
            <div className="section-heading">
              <div>
                <span className="eyebrow">BEFORE YOU START</span>
                <h2>Meet the teams</h2>
              </div>
              <span className="step-pill">01 / SETUP</span>
            </div>
            <div className="team-setup-list">
              {setupNames.map((name, i) => (
                <label className="team-edit" key={i}>
                  <span
                    className="team-dot"
                    style={{
                      backgroundColor: TEAM_COLORS[i],
                      color: i === 3 ? "#192335" : "white",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={name}
                    maxLength={22}
                    onChange={(e) =>
                      setSetupNames(
                        setupNames.map((v, n) =>
                          n === i ? e.target.value : v,
                        ),
                      )
                    }
                    aria-label={`Team ${i + 1} name`}
                  />
                </label>
              ))}
            </div>
            <div className="setup-config token-setup">
              <label>
                Starting money <span>($100 per physical token)</span>
                <input
                  type="number"
                  value={setupConfig.startingMoney}
                  min={0}
                  max={9900}
                  step={100}
                  onChange={(e) =>
                    setSetupConfig({
                      ...setupConfig,
                      startingMoney: Number(e.target.value),
                    })
                  }
                />
              </label>
              <div className="rounds-note">
                <b>Play at your pace</b>
                <span>The facilitator ends the game</span>
              </div>
            </div>
            <GameButton onClick={startGame}>
              START THE GAME <span>?</span>
            </GameButton>
            {savedExists && (
              <GameButton onClick={resumeGame} variant="secondary">
                RESUME PREVIOUS GAME
              </GameButton>
            )}
            <div className="setup-links">
              <button onClick={() => setShowRules(true)}>
                HOW TO PLAY - RULES
              </button>
              <Link href={controllerHref}>OPEN PHONE CONTROLLER</Link>
            </div>
            <p className="objective-note">
              Goal: finish with the most money when the facilitator ends the
              game. There is no fixed round limit.
            </p>
          </div>
        </section>
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </main>
    );

  const currentTile = game.board[currentTeam.position];
  const showModal = Boolean(
    game.activeCard ||
    game.phase === "decision" ||
    game.phase === "cooperation" ||
    game.eventMessage,
  );
  const displayedPosition =
    (walkingToken?.teamId === currentTeam.id
      ? walkingToken.position
      : currentTeam.position) + 1;
  const turnStatus =
    game.phase === "paused"
      ? "GAME PAUSED"
      : game.phase === "decision"
        ? "CLASS DECISION IN PROGRESS"
        : game.phase === "cooperation"
          ? "COMMUNITY EVENT"
          : game.phase === "playing" && !game.activeCard
            ? "WAITING FOR PHONE CONTROLLER"
            : "RESOLVE THE SPACE";
  return (
    <main className={`game-shell ${headerVisible ? "header-on" : ""}`}>
      {headerVisible ? (
        <header className="game-topbar">
          <div className="brandline">
            <span className="logo-mark">C</span>
            <span>
              CASH DASH <b>CLASSROOM GAME</b>
            </span>
          </div>
          <div className="game-meta">
            <span className="round-pill">
            <i /> ROUND {game.round}
            </span>
            <span className="timer-pill">
              PLAY {String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:
              {String(remainingSeconds % 60).padStart(2, "0")}
            </span>
          </div>
          <div className="top-actions">
            <button
              className="header-toggle"
              onClick={() => setHeaderVisible(false)}
              aria-label="Hide header"
            >
              1
            </button>
            <button
              className="rules-shortcut"
              onClick={() => setShowRules(true)}
            >
              RULES
            </button>
            <button
              className="icon-button"
              onClick={() => setShowHistory(!showHistory)}
              title="Game history"
            >
              LOG
            </button>
            <button
              className="teacher-pill"
              onClick={() => setShowTeacher(!showTeacher)}
            >
              FACILITATOR <span>v</span>
            </button>
          </div>
        </header>
      ) : (
        <button
          className="header-peek"
          onClick={() => setHeaderVisible(true)}
          aria-label="Show header"
        >
          1
        </button>
      )}
      <div className="game-layout">
        <section className="board-column">
          <div className="board-heading">
            <div className="board-title">
              <span className="eyebrow">CASH DASH</span>
              <h1>THE GAME BOARD</h1>
            </div>
            <div className="board-heading-meta">
              <div className="turn-summary">
                <div className="turn-copy">
                  <small>{isRolling ? "MOVING" : "IT'S YOUR TURN"}</small>
                  <b>{currentTeam.name}</b>
                  <em>
                    POSITION {String(displayedPosition).padStart(2, "0")} /{" "}
                    {game.board.length}
                  </em>
                </div>
                <span className="phase-note">{turnStatus}</span>
                {/* <button className="share-controller-button" onClick={() => void copyControllerLink()} disabled={!roomCredentials}>
                  {controllerLinkCopied ? "LINK COPIED" : "COPY PHONE LINK"}
                </button> */}
              </div>
              <div className="pot-card">
                <span>COMMUNITY CHEST</span>
                <b>{formatMoney(game.communityChest)}</b>
                <i>Shared team fund</i>
              </div>
            </div>
          </div>
          <div className="board-wrap">
            <div className="board-grid">
              {game.board.map((tile, index) => {
                const [row, col] = gridPositions[index];
                const positionOf = (team: Team) =>
                  walkingToken?.teamId === team.id
                    ? walkingToken.position
                    : team.position;
                const occupants = game.teams.filter(
                  (team) => positionOf(team) === index,
                );
                const isCurrentPosition =
                  walkingToken?.teamId === currentTeam.id
                    ? walkingToken.position === index
                    : index === currentTeam.position;
                return (
                  <div
                    key={tile.id}
                    className={`board-tile tile-${tile.type} ${isCurrentPosition ? "current-space" : ""}`}
                    style={{ gridRow: row, gridColumn: col }}
                  >
                    <span className="tile-icon">{tile.icon}</span>
                    <span className="tile-title">{tile.title}</span>
                    {occupants.length > 0 && (
                      <span className="tokens">
                        {occupants.map((t, i) => (
                          <i
                            key={t.id}
                            title={t.name}
                            style={{
                              backgroundColor: t.color,
                            }}
                          >
                            {game.teams.indexOf(t) + 1}
                          </i>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="board-center">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <span className="center-star">✦</span>
                <span className="center-label">
                  CASH
                  <br />
                  DASH
                </span>
                <span className="center-coordinate">MOST MONEY WINS</span>
                <div
                  className="center-current"
                  style={{ borderColor: currentTeam.color }}
                >
                  <i style={{ background: currentTeam.color }} />
                  <span>
                    <small>
                      {isRolling ? "DICE ROLLING" : "NOW EXPLORING"}
                    </small>
                    <b>{currentTeam.name}</b>
                  </span>
                  <strong aria-live="polite">
                    {isRolling ? (
                      <DiceRoller value={rollingResult ?? 1} rolling />
                    ) : game.diceValue ? (
                      <DiceRoller value={game.diceValue} rolling={false} />
                    ) : (
                      currentTile.icon
                    )}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </section>
        <aside className="sidebar">
          <div className="sidebar-head">
            <div>
              <span className="eyebrow">CREW STATUS</span>
              <h2>
                THE TEAMS <span>05</span>
              </h2>
            </div>
            <button
              className="small-control"
              onClick={() => setShowTeacher(!showTeacher)}
            >
              •••
            </button>
          </div>
          <div className="crew-list">
            {game.teams.map((team, i) => (
              <CrewCard
                key={team.id}
                team={team}
                index={i}
                current={i === game.currentTeam}
              />
            ))}
          </div>
          <div className="sidebar-bottom round-summary">
            <b>
              ROUND {game.round}
            </b>
            <span>
              {game.pendingEvents.length} UPCOMING EVENT
              {game.pendingEvents.length === 1 ? "" : "S"}
            </span>
          </div>
        </aside>
      </div>

      {showTeacher && (
        <div className="drawer-scrim" onClick={() => setShowTeacher(false)}>
          <aside
            className="teacher-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <span className="eyebrow">FACILITATOR TOOLS</span>
                <h2>Teacher controls</h2>
              </div>
              <button onClick={() => setShowTeacher(false)}>✕</button>
            </div>
            <div className="drawer-section">
              <span className="drawer-label">SESSION</span>
              <div className="drawer-buttons">
                {game.phase === "paused" ? (
                  <GameButton
                    onClick={() =>
                      safeUpdate((g) => ({
                        ...g,
                        phase: "playing",
                        eventMessage: null,
                      }))
                    }
                  >
                    RESUME GAME
                  </GameButton>
                ) : (
                  <GameButton
                    onClick={() =>
                      safeUpdate((g) => ({
                        ...g,
                        phase: "paused",
                        eventMessage:
                          "Game paused. Take a moment, then resume when ready.",
                      }))
                    }
                    variant="secondary"
                  >
                    PAUSE GAME
                  </GameButton>
                )}
                <GameButton onClick={endGame} variant="danger">
                  END GAME
                </GameButton>
                <GameButton onClick={finishTurn} variant="secondary">
                  ADVANCE TURN →
                </GameButton>
                <GameButton
                  onClick={undo}
                  disabled={!game.lastSnapshot}
                  variant="secondary"
                >
                  ↶ UNDO LAST ACTION
                </GameButton>
              </div>
            </div>
            <div className="drawer-section">
              <span className="drawer-label">TRIGGER AN EVENT</span>
              <div className="drawer-buttons">
                <GameButton onClick={triggerDecision} variant="secondary">
                  START CLASS DECISION
                </GameButton>
                <GameButton onClick={beginCooperation} variant="secondary">
                  COMMUNITY EMERGENCY
                </GameButton>
                <GameButton
                  onClick={() =>
                    safeUpdate((g) => ({
                      ...g,
                      activeCard: "TREASURE",
                      phase: "playing",
                      treasurePot: 0,
                      treasureDraws: 0,
                    }))
                  }
                  variant="secondary"
                >
                  START TREASURE RISK
                </GameButton>
              </div>
            </div>
            <div className="drawer-section">
              <span className="drawer-label">QUICK ADJUSTMENTS</span>
              {game.teams.map((team) => (
                <div className="adjust-row" key={team.id}>
                  <span>
                    <i style={{ backgroundColor: team.color }} />
                    {team.name}
                  </span>
                  <button onClick={() => adjustMoney(team.id, -100)}>
                    −100
                  </button>
                  <button
                    className="balance-button"
                    onClick={() => setTeamMoney(team)}
                  >
                    {formatMoney(team.money)}
                  </button>
                  <button onClick={() => adjustMoney(team.id, 100)}>
                    +100
                  </button>
                  <select
                    aria-label={`Move ${team.name} to a board tile`}
                    value={team.position}
                    onChange={(e) =>
                      safeUpdate((g) => ({
                        ...g,
                        teams: g.teams.map((t) =>
                          t.id === team.id
                            ? { ...t, position: Number(e.target.value) }
                            : t,
                        ),
                      }))
                    }
                  >
                    {game.board.map((tile, i) => (
                      <option value={i} key={tile.id}>
                        {String(i + 1).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="drawer-section">
              <span className="drawer-label">PENDING EVENTS</span>
              {game.pendingEvents.length ? (
                game.pendingEvents.map((event) => (
                  <div className="pending-row" key={event.id}>
                    <b>{event.title}</b>
                    <span>{teamById(game, event.teamId)?.name} outcome pending</span>
                  </div>
                ))
              ) : (
                <p className="muted">No future events scheduled.</p>
              )}
            </div>
            <div className="drawer-bottom">
              <GameButton onClick={newGame} variant="danger">
                START NEW GAME
              </GameButton>
              <Link href={controllerHref} className="controller-link">
                Open phone controller
              </Link>
            </div>
          </aside>
        </div>
      )}

      {showHistory && (
        <div className="history-panel">
          <div className="drawer-head">
            <div>
              <span className="eyebrow">FACILITATOR VIEW</span>
              <h2>Activity log</h2>
            </div>
            <button onClick={() => setShowHistory(false)}>✕</button>
          </div>
          {game.history.length ? (
            game.history.map((entry) => (
              <div className="history-entry" key={entry.id}>
                <i className={`history-dot ${entry.kind}`} />
                <div>
                  <small>ROUND {entry.round}</small>
                  <span>{entry.message}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Actions will appear here as you play.</p>
          )}
        </div>
      )}

      {showModal && (
        <div className="modal-scrim">
          <section
            className={`event-modal ${game.phase === "decision" || game.phase === "cooperation" ? "wide-modal" : ""}`}
          >
            {game.phase === "decision" && (
              <>
                <div className="modal-ornament">💭</div>
                <span className="eyebrow">
                  GLOBAL DECISION ? WHITEBOARD ROUND
                </span>
                <h2>{activeEvent.title}</h2>
                <p className="event-description">{activeEvent.description}</p>
                <div className="decision-status">
                  <span>Collect each team?s choice on the whiteboard.</span>
                  <b>ENTER CHOICES ON THE PHONE</b>
                </div>
                <div className="decision-phone-wait">
                  The game screen will reveal all choices after the facilitator
                  submits them.
                </div>
              </>
            )}
            {game.phase === "cooperation" && (
              <>
                <div className="modal-ornament">🛠</div>
                <span className="eyebrow">GLOBAL CO-OP EVENT</span>
                <h2>Community emergency</h2>
                <p className="event-description">
                  The transport ship is stranded. The class needs <b>$1,500</b>{" "}
                  to repair it. Everyone may contribute up to $500. If it’s
                  repaired, every crew receives $400.
                </p>
                <div className="coop-total">
                  <span>SHIP REPAIR FUND</span>
                  <b>
                    {formatMoney(
                      Object.values(contributions).reduce(
                        (sum, amount) => sum + amount,
                        0,
                      ),
                    )}{" "}
                    <small>/ $1,500</small>
                  </b>
                </div>
                <div className="contribution-grid">
                  {game.teams.map((team) => (
                    <label key={team.id}>
                      <span>
                        <i style={{ background: team.color }} />
                        {team.name}
                      </span>
                      <select
                        value={contributions[team.id] ?? 0}
                        onChange={(e) =>
                          setContributions({
                            ...contributions,
                            [team.id]: Number(e.target.value),
                          })
                        }
                      >
                        {[0, 100, 200, 300, 400, 500].map((amount) => (
                          <option key={amount} value={amount}>
                            {formatMoney(amount)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <GameButton onClick={resolveCooperation}>
                  REVEAL CONTRIBUTIONS →
                </GameButton>
              </>
            )}
            {game.activeCard === "THIEF" && (
              <>
                <div className="modal-ornament thief-ornament">☠️</div>
                <span className="eyebrow">
                  TREASURE TEMPTATION · {currentTeam.name}
                </span>
                <h2>THIEF!</h2>
                <p className="event-description">{game.eventMessage}</p>
                <GameButton onClick={finishTurn}>
                  CONTINUE →
                </GameButton>
              </>
            )}
            {game.eventMessage &&
              game.activeCard !== "THIEF" &&
              game.phase !== "decision" &&
              game.phase !== "cooperation" && (
                <>
                  <div className="modal-ornament">✦</div>
                  <span className="eyebrow">A SIGNAL FROM THE GALAXY</span>
                  <h2>
                    {game.eventResults.length
                      ? "Delayed event results"
                      : game.activeCard === "DECISION-PENDING"
                        ? "Choice recorded"
                        : "Event resolved"}
                  </h2>
                  {game.activeCard === "DECISION-PENDING" ? (
                    <>
                      <p className="event-description">
                        The teams’ choices are recorded. Results will be shown later.
                      </p>
                      <div className="decision-results-table recorded-choices">
                        {(["help", "pass"] as const).map((choice) => {
                          const teams = game.teams.filter(
                            (team) => game.decisionChoices[team.id] === choice,
                          );
                          return (
                            <section
                              className={`decision-result-column ${choice}`}
                              key={choice}
                            >
                              <header>
                                <b>{choice === "help" ? "HELPED" : "PASSED"}</b>
                                <span>
                                  {teams.length} {teams.length === 1 ? "TEAM" : "TEAMS"}
                                </span>
                              </header>
                              {teams.length ? (
                                teams.map((team) => (
                                  <div className="decision-result-team" key={team.id}>
                                    <i style={{ backgroundColor: team.color }} />
                                    <span>{team.name}</span>
                                  </div>
                                ))
                              ) : (
                                <p>No teams {choice === "help" ? "helped" : "passed"}.</p>
                              )}
                            </section>
                          );
                        })}
                      </div>
                    </>
                  ) : game.eventResults.length > 0 ? (
                    <>
                      <p className="event-description">{game.eventMessage}</p>
                      <div className="decision-results-table delayed-results">
                        {(["good", "passed"] as const).map((group) => {
                          const results = game.eventResults.filter((event) =>
                            group === "passed"
                              ? event.choice === "pass"
                              : event.choice === "help",
                          );
                          if (!results.length) return null;
                          const label = group === "good" ? "HELPED" : "PASSED";
                          return (
                            <section
                              className={`decision-result-column ${group}`}
                              key={group}
                            >
                              <header>
                                <b>{label}</b>
                                <span>
                                  {results.length}{" "}
                                  {results.length === 1 ? "TEAM" : "TEAMS"}
                                </span>
                              </header>
                              {results.map((event) => {
                                  const team = teamById(game, event.teamId);
                                  return (
                                    <div
                                      className="decision-result-team event-result-team"
                                      key={event.id}
                                    >
                                      <i
                                        style={{
                                          backgroundColor:
                                            team?.color ?? "#9aa3b2",
                                        }}
                                      />
                                      <span>
                                        <b>{team?.name ?? "Team"}</b>
                                        <small>{event.title}</small>
                                      </span>
                                      <strong>
                                        {event.choice === "pass"
                                          ? "KEPT MONEY"
                                          : event.amount > 0
                                            ? `+${formatMoney(event.amount)}`
                                            : "NO BENEFIT"}
                                      </strong>
                                    </div>
                                  );
                                })}
                            </section>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="event-description">{game.eventMessage}</p>
                  )}
                  <GameButton
                    onClick={() => {
                      if (game.phase === "playing") {
                        finishTurn();
                        return;
                      }
                      setGame({
                        ...game,
                        eventMessage: null,
                        phase: "playing",
                        finishAfterEvent: false,
                        decisionChoices: {},
                        eventResults: [],
                        activeCard: game.activeCard,
                      });
                    }}
                  >
                    {game.phase === "playing" ? "NEXT TEAM →" : "CONTINUE →"}
                  </GameButton>
                </>
              )}
            {game.phase !== "decision" &&
              game.phase !== "cooperation" &&
              !game.eventMessage &&
              game.activeCard === "ACTION" && (
                <>
                  <div className="modal-ornament">🎴</div>
                  <span className="eyebrow">
                    ACTION SPACE · {currentTeam.name}
                  </span>
                  <h2>What will you do?</h2>
                  <p className="event-description">
                    Choose GIVE, TAKE, or ROB. Then draw a regular UNO number
                    card (1–9) for the amount: each number is worth $100.
                  </p>
                  <div className="action-choice-grid">
                    <button onClick={() => chooseAction("give")}>
                      <strong>GIVE</strong>
                      <span>Add to the shared Community Chest</span>
                    </button>
                    <button onClick={() => chooseAction("take")}>
                      <strong>TAKE</strong>
                      <span>Withdraw from the shared chest</span>
                    </button>
                    <button onClick={() => chooseAction("rob")}>
                      <strong>ROB</strong>
                      <span>Take credits from another crew</span>
                    </button>
                  </div>
                </>
              )}
            {game.phase !== "decision" &&
              game.phase !== "cooperation" &&
              !game.eventMessage &&
              game.activeCard === "WAITING-ACTION-CARD" && (
                <>
                  <div className="modal-ornament">1-9</div>
                  <span className="eyebrow">
                    UNO NUMBER CARD - {currentTeam.name}
                  </span>
                  <h2>Enter the card value</h2>
                  <p className="event-description">
                    Each UNO number is one token unit: 1 = $100, 9 = $900.
                  </p>
                  <div className="action-card-entry">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                      <button
                        key={value}
                        onClick={() => enterActionCard(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </>
              )}
            {game.phase !== "decision" &&
              game.phase !== "cooperation" &&
              !game.eventMessage &&
              game.selectedAction &&
              game.moneyDraw !== null && (
                <>
                  <div className="modal-ornament">🪙</div>
                  <span className="eyebrow">MONEY CARD REVEAL</span>
                  <h2>
                    {game.selectedAction === "give"
                      ? "Give to the community"
                      : game.selectedAction === "take"
                        ? "Take from the chest"
                        : "Choose a crew"}
                  </h2>
                  <div className="money-card-reveal">
                    <small>THE CARD SHOWS</small>
                    <b>{formatMoney(game.moneyDraw)}</b>
                    <span>CREDITS</span>
                  </div>
                  {game.selectedAction === "rob" ? (
                    <div className="target-grid">
                      {game.teams
                        .filter((team) => team.id !== currentTeam.id)
                        .map((team) => (
                          <button
                            key={team.id}
                            onClick={() => settleAction(team.id)}
                          >
                            <i style={{ background: team.color }} />
                            <b>{team.name}</b>
                            <small>HAS {formatMoney(team.money)}</small>
                          </button>
                        ))}
                    </div>
                  ) : (
                    <GameButton onClick={() => settleAction()}>
                      {game.selectedAction === "give"
                        ? "ADD TO COMMUNITY CHEST"
                        : "WITHDRAW AVAILABLE CREDITS"}{" "}
                      →
                    </GameButton>
                  )}
                </>
              )}
            {game.phase !== "decision" &&
              game.phase !== "cooperation" &&
              !game.eventMessage &&
              game.activeCard === "TREASURE" && (
                <>
                  <div className="modal-ornament treasure-orb">💎</div>
                  <span className="eyebrow">
                    TREASURE TEMPTATION · {currentTeam.name}
                  </span>
                  <h2>How far will you go?</h2>
                  <p className="event-description">
                    Choose whether to bank or draw another UNO number card. A
                    picture card clears only this visit's unbanked pot. The
                    number adds $100 to $900.
                  </p>
                  <div className="treasure-pot">
                    <small>CURRENT POT</small>
                    <b>{formatMoney(game.treasurePot)}</b>
                    <span>
                      {game.treasureDraws}{" "}
                      {game.treasureDraws === 1 ? "CARD" : "CARDS"} DRAWN
                    </span>
                  </div>
                  <div className="treasure-actions">
                    <GameButton
                      onClick={bankTreasure}
                      disabled={!game.treasurePot}
                    >
                      BANK {formatMoney(game.treasurePot)}
                    </GameButton>
                    <div className="treasure-card-entry">
                      <span>UNO NUMBER CARD - 1 TO 9</span>
                      <div>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                          <button key={value} onClick={() => drawAgain(value)}>
                            {value}
                          </button>
                        ))}
                      </div>
                      <button
                        className="phone-thief-button"
                        onClick={() => drawAgain(0)}
                      >
                        PICTURE CARD - THIEF
                      </button>
                    </div>
                  </div>
                </>
              )}
            {game.phase !== "decision" &&
              game.phase !== "cooperation" &&
              !game.eventMessage &&
              game.activeCard === "RESOLVED" && (
                <>
                  <div className="modal-ornament">🎲</div>
                  <span className="eyebrow">
                    {currentTile.title.toUpperCase()} · {currentTeam.name}
                  </span>
                  <h2>Turn complete</h2>
                  <GameButton onClick={finishTurn}>NEXT TEAM →</GameButton>
                </>
              )}
          </section>
        </div>
      )}

      {game.phase === "paused" && !showModal && (
        <div className="paused-ribbon">
          <span>Ⅱ</span> GAME PAUSED{" "}
          <button
            onClick={() => safeUpdate((g) => ({ ...g, phase: "playing" }))}
          >
            RESUME →
          </button>
        </div>
      )}
      {game.phase === "finished" && (
        <div className="modal-scrim endgame-scrim">
          <section className="event-modal final-modal">
            <div className="modal-ornament">✦</div>
            <span className="eyebrow">THE JOURNEY ENDS HERE</span>
            <h2>Final standings</h2>
            <p className="event-description">
              The credits tell one part of the story.
            </p>
            <div className="final-table">
              {[...game.teams]
                .sort((a, b) => b.money - a.money)
                .map((team, i) => (
                  <div className="final-row" key={team.id}>
                    <span className="rank">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <i style={{ background: team.color }} />
                    <b>{team.name}</b>
                    <strong>{formatMoney(team.money)}</strong>
                  </div>
                ))}
            </div>
            {revealedReflection ? (
              <>
                <h3 className="reflection-title">
                  BUT MONEY WASN’T THE ONLY THING WE WERE WATCHING.
                </h3>
                <div className="reflection-table">
                  <div className="reflection-head">
                    <span>CREW</span>
                    <span>GIVEN</span>
                    <span>STOLEN</span>
                    <span>CHEST IN</span>
                    <span>CHEST OUT</span>
                    <span>HELPED</span>
                    <span>CO-OP</span>
                    <span>RISKS</span>
                    <span>STOPPED</span>
                  </div>
                  {game.teams.map((team) => (
                    <div key={team.id} className="reflection-row">
                      <b>{team.name}</b>
                      <span>{formatMoney(team.stats.amountGiven)}</span>
                      <span>{formatMoney(team.stats.amountStolen)}</span>
                      <span>
                        {formatMoney(team.stats.amountContributedToCommunity)}
                      </span>
                      <span>
                        {formatMoney(team.stats.amountTakenFromCommunity)}
                      </span>
                      <span>{team.stats.peopleHelped}</span>
                      <span>
                        {formatMoney(team.stats.cooperationContributed)}
                      </span>
                      <span>{team.stats.risksTaken}</span>
                      <span>{team.stats.timesStopped}</span>
                    </div>
                  ))}
                </div>
                <div className="prompt-list">
                  <span className="eyebrow">REFLECTION PROMPTS</span>
                  {REFLECTION_PROMPTS.slice(0, 4).map((prompt) => (
                    <p key={prompt}>“{prompt}”</p>
                  ))}
                </div>
              </>
            ) : (
              <button
                className="reveal-button"
                onClick={() => setRevealedReflection(true)}
              >
                BUT MONEY WASN’T THE ONLY THING WE WERE WATCHING <span>↗</span>
              </button>
            )}
            <div className="final-actions">
              <GameButton onClick={newGame} variant="secondary">
                START A NEW JOURNEY
              </GameButton>
              <GameButton onClick={() => window.print()} variant="quiet">
                PRINT RESULTS
              </GameButton>
            </div>
          </section>
        </div>
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {notice && (
        <div className="toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </main>
  );
}

function CrewCard({
  team,
  index,
  current,
}: {
  team: Team;
  index: number;
  current: boolean;
}) {
  const cardClass = `crew-card ${current ? "crew-current" : ""} ${team.status === "bankrupt" ? "crew-bankrupt" : ""}`;
  return (
    <div
      className={cardClass}
      style={{ "--crew-color": team.color } as React.CSSProperties}
    >
      <div className="crew-main">
        <span
          className="crew-avatar"
          style={{
            color: index === 3 ? "#172033" : "#fff",
            backgroundColor: index === 3 ? "#ffffff" : team.color,
            borderColor: index === 3 ? "#172033" : "#ffffff",
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="crew-name">
          <b>{team.name}</b>
          <small>
            {team.status === "bankrupt"
              ? "OUT OF MONEY"
              : current
                ? "CURRENT TEAM"
                : "UP NEXT"}
          </small>
        </span>
        {current && <span className="current-chevron">&gt;</span>}
      </div>
      <div className="crew-money-line">
        <b>{formatMoney(team.money)}</b>
      </div>
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-scrim rules-scrim"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="event-modal rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="rules-close"
          onClick={onClose}
          aria-label="Close rules"
        >
          ×
        </button>
        <span className="eyebrow">QUICK RULEBOOK · 30 MINUTES</span>
        <h2 id="rules-title">How to play</h2>
        <p className="event-description">
          Five teams take turns trying to finish with the most money. You can
          grow your own pile, share with the community, or take a risk.
        </p>
        <div className="rule-list">
          <article>
            <b>1 · Start with tokens</b>
            <p>
              Each token is $100. Keep all money totals in $100 steps. UNO
              number cards only use 1–9, so 1 means $100 and 9 means $900.
            </p>
          </article>
          <article>
            <b>2 · Keep taking turns</b>
            <p>
              Teams go Blue, Yellow, Red, White, Orange, then repeat. The
              facilitator rolls the physical die and enters the result on the
              phone controller. Play continues until the facilitator clicks
              END GAME.
            </p>
          </article>
          <article>
            <b>3 · Follow the tile</b>
            <p>
              Action: choose GIVE to the shared chest, TAKE from it, or ROB
              another team, then draw a regular UNO number card (1–9) for the
              amount. Each number is worth $100. Treasure: draw UNO cards to
              build a pot; bank it or risk another card. Other event spaces
              resolve as shown. For a class decision, HELP costs the shown
              amount; choices are recorded and outcomes are revealed later. A
              team that helps might receive $0, so helping can have no benefit.
            </p>
          </article>
          <article>
            <b>4 · Picture card means bust</b>
            <p>
              J, Q, or K ends the treasure turn and clears only that visit’s
              unbanked pot. Banked tokens stay safe. A 52-card deck has a 23%
              picture-card chance on the first draw; capping each visit at 3
              draws keeps the risk meaningful and the game moving.
            </p>
          </article>
          <article>
            <b>5 · Win together or alone</b>
            <p>
              The team with the most money after the final turn wins. Community
              Chest money is shared and does not count toward a team’s total.
            </p>
          </article>
        </div>
        <div className="rules-timing">
          <b>30-minute guide</b>
          <span>3 min setup · 22 min play · 5 min wrap-up</span>
          <span>
            The timer is a guide. The facilitator ends the game when ready.
          </span>
        </div>
        <button className="game-button primary rules-done" onClick={onClose}>
          GOT IT
        </button>
      </section>
    </div>
  );
}
