import { BOARD } from "@/data/board";
import { DECISION_EVENTS, REFLECTION_PROMPTS } from "@/data/decisions";
export { BOARD, DECISION_EVENTS, REFLECTION_PROMPTS };
export type TileType = "start" | "action" | "treasure" | "decision" | "special";
export type TeamStatus = "active" | "bankrupt";

export type TeamStats = {
  amountGiven: number;
  amountStolen: number;
  amountTakenFromCommunity: number;
  amountContributedToCommunity: number;
  peopleHelped: number;
  decisionsHelped: number;
  decisionsDeclined: number;
  treasureDraws: number;
  risksTaken: number;
  timesStopped: number;
  cooperationContributed: number;
};

export type Team = {
  id: string;
  name: string;
  color: string;
  position: number;
  money: number;
  status: TeamStatus;
  stats: TeamStats;
};

export type BoardTile = { id: string; title: string; type: TileType; icon: string; subtitle: string };
export type GameConfig = {
  startingMoney: number;
  moneyDeck: number[];
};
export type GamePhase = "setup" | "playing" | "paused" | "decision" | "cooperation" | "finished";
export type PendingEvent = {
  id: string;
  teamId: string;
  title: string;
  rollsUntilResolve: number;
  skipNextTurn: boolean;
  message: string;
  amount: number;
  eventType: "traveller" | "family";
  choice: "help" | "pass";
};
export type HistoryEntry = { id: string; round: number; message: string; kind: "money" | "choice" | "system" };
export type GameState = {
  config: GameConfig;
  teams: Team[];
  board: BoardTile[];
  phase: GamePhase;
  currentTeam: number;
  round: number;
  communityChest: number;
  history: HistoryEntry[];
  pendingEvents: PendingEvent[];
  eventResults: PendingEvent[];
  activeCard: string | null;
  selectedAction: "give" | "take" | "rob" | null;
  moneyDraw: number | null;
  treasurePot: number;
  treasureDraws: number;
  decisionIndex: number;
  decisionChoices: Record<string, string>;
  eventMessage: string | null;
  finishAfterEvent: boolean;
  lastSnapshot: GameSnapshot | null;
  diceValue: number | null;
};
export type GameSnapshot = Pick<GameState, "teams" | "phase" | "currentTeam" | "round" | "communityChest" | "history" | "pendingEvents" | "eventResults" | "activeCard" | "selectedAction" | "moneyDraw" | "treasurePot" | "treasureDraws" | "decisionIndex" | "decisionChoices" | "eventMessage" | "finishAfterEvent" | "diceValue">;

export const TEAM_COLORS = ["#2475e8", "#f3be20", "#e34c48", "#f7f4ec", "#ef7d2e"];
export const TEAM_NAMES = ["Blue", "Yellow", "Red", "White", "Orange"];
export const DEFAULT_CONFIG: GameConfig = {
  startingMoney: 1000,
  moneyDeck: [100, 200, 300, 400, 500, 600, 700, 800, 900],
};

const emptyStats = (): TeamStats => ({ amountGiven: 0, amountStolen: 0, amountTakenFromCommunity: 0, amountContributedToCommunity: 0, peopleHelped: 0, decisionsHelped: 0, decisionsDeclined: 0, treasureDraws: 0, risksTaken: 0, timesStopped: 0, cooperationContributed: 0 });
export function createGame(names = TEAM_NAMES, config: GameConfig = DEFAULT_CONFIG): GameState {
  return {
    config: structuredClone(config), teams: names.map((name, i) => ({ id: `team-${i + 1}`, name: name.trim() || TEAM_NAMES[i], color: TEAM_COLORS[i], position: 0, money: config.startingMoney, status: "active", stats: emptyStats() })),
    board: BOARD, phase: "setup", currentTeam: 0, round: 1, communityChest: 0, history: [], pendingEvents: [], eventResults: [], activeCard: null, selectedAction: null, moneyDraw: null, treasurePot: 0, treasureDraws: 0, decisionIndex: 0, decisionChoices: {}, eventMessage: null, finishAfterEvent: false, lastSnapshot: null, diceValue: null,
  };
}
export function snapshot(state: GameState): GameSnapshot {
  const { teams, phase, currentTeam, round, communityChest, history, pendingEvents, eventResults, activeCard, selectedAction, moneyDraw, treasurePot, treasureDraws, decisionIndex, decisionChoices, eventMessage, finishAfterEvent, diceValue } = state;
  return structuredClone({ teams, phase, currentTeam, round, communityChest, history, pendingEvents, eventResults, activeCard, selectedAction, moneyDraw, treasurePot, treasureDraws, decisionIndex, decisionChoices, eventMessage, finishAfterEvent, diceValue });
}
export function restoreSnapshot(state: GameState, snap: GameSnapshot): GameState { return { ...state, ...structuredClone(snap), lastSnapshot: null }; }
export function normalizeGameState(state: GameState): GameState {
  const normalizeEvent = (event: PendingEvent): PendingEvent => ({
      ...event,
      rollsUntilResolve: event.rollsUntilResolve ?? 1,
      skipNextTurn: event.skipNextTurn ?? false,
      choice: event.choice ?? "help",
    });
  return {
    ...state,
    eventResults: (state.eventResults ?? []).map(normalizeEvent),
    pendingEvents: (state.pendingEvents ?? []).map(normalizeEvent),
  };
}
export function addHistory(state: GameState, message: string, kind: HistoryEntry["kind"] = "system"): GameState {
  return { ...state, history: [{ id: crypto.randomUUID(), round: state.round, message, kind }, ...state.history].slice(0, 100) };
}

export function changeMoney(state: GameState, teamId: string, delta: number, reason: string): GameState {
  const teams = state.teams.map(team => {
    if (team.id !== teamId) return team;
    const nextMoney = Math.max(0, team.money + delta);
    return { ...team, money: nextMoney, status: nextMoney === 0 ? "bankrupt" as const : "active" as const };
  });
  return addHistory({ ...state, teams }, `${state.teams.find(t => t.id === teamId)?.name ?? "A team"}: ${reason}`, "money");
}
export function formatMoney(amount: number): string { return `$${Math.max(0, amount).toLocaleString("en-US")}`; }
export function randomIndex(length: number): number { return Math.floor(Math.random() * length); }
export function drawTreasure(cardValue: number): number | "thief" { return cardValue === 0 ? "thief" : cardValue * 100; }
export function getCurrentTeam(state: GameState): Team { return state.teams[state.currentTeam]; }

export function advanceTurn(state: GameState): GameState {
  const nextIndex = (state.currentTeam + 1) % state.teams.length;
  const nextRound = state.round + (nextIndex === 0 ? 1 : 0);
  const progressedEvents = state.pendingEvents.map((event) => ({
    ...event,
    skipNextTurn: false,
    rollsUntilResolve: event.rollsUntilResolve - (event.skipNextTurn ? 0 : 1),
  }));
  const due = progressedEvents.filter(event => !event.skipNextTurn && event.rollsUntilResolve <= 0);
  let next: GameState = { ...state, currentTeam: nextIndex, round: nextRound, phase: "playing", diceValue: null, activeCard: null, selectedAction: null, moneyDraw: null, treasurePot: 0, treasureDraws: 0, eventMessage: null, pendingEvents: progressedEvents.filter(event => !due.some(resolved => resolved.id === event.id)), eventResults: [] };
  if (due.length) {
    next = { ...next, phase: "paused", finishAfterEvent: false, eventResults: due };
    for (const event of due) {
      if (event.choice === "help") next = changeMoney(next, event.teamId, event.amount, event.message);
      else next = addHistory(next, `${state.teams.find(team => team.id === event.teamId)?.name ?? "A team"} passed on ${event.title} and kept their money.`, "choice");
    }
    next.eventMessage = `Delayed outcomes from ${[...new Set(due.map(event => event.title))].join(" and ")} are in.`;
    return addHistory(next, `Resolved ${due.length} delayed team outcome${due.length === 1 ? "" : "s"}.`, "system");
  }
  if (nextIndex === 0) return addHistory(next, `Round ${next.round} begins`, "system");
  return next;
}

export function scheduleDelayed(state: GameState, teamId: string, title: string, amount: number, afterRolls: number, eventType: PendingEvent["eventType"], choice: PendingEvent["choice"]): GameState {
  const name = state.teams.find(team => team.id === teamId)?.name ?? "A team";
  const message = choice === "pass"
    ? `${name} passed on ${title} and kept their money.`
    : `${name}: ${title} — ${amount ? `+${formatMoney(amount)} unexpected support` : "no reward this time"}.`;
  return { ...state, pendingEvents: [...state.pendingEvents, { id: crypto.randomUUID(), teamId, title, rollsUntilResolve: afterRolls, skipNextTurn: true, message, amount, eventType, choice }] };
}
