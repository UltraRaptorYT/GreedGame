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
  wealthLimit: number;
  wealthPenalty: number;
  thiefPenalty: number;
  totalRounds: number;
  moneyDeck: number[];
};
export type GamePhase = "setup" | "playing" | "paused" | "decision" | "cooperation" | "finished";
export type PendingEvent = {
  id: string;
  teamId: string;
  title: string;
  dueRound: number;
  message: string;
  amount: number;
  eventType: "traveller" | "family";
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
export type GameSnapshot = Pick<GameState, "teams" | "phase" | "currentTeam" | "round" | "communityChest" | "history" | "pendingEvents" | "activeCard" | "selectedAction" | "moneyDraw" | "treasurePot" | "treasureDraws" | "decisionIndex" | "decisionChoices" | "eventMessage" | "finishAfterEvent" | "diceValue">;

export const TEAM_COLORS = ["#ff654f", "#52b8ff", "#ffc84a", "#b27aff", "#4dd6a0", "#ff79b6"];
export const TEAM_NAMES = ["Comet Crew", "Nova Navigators", "Moonwalkers", "Astro Aces", "Orbit Owls", "Meteor Makers"];
export const DEFAULT_CONFIG: GameConfig = {
  startingMoney: 1500,
  wealthLimit: 10000,
  wealthPenalty: 2000,
  thiefPenalty: 500,
  totalRounds: 6,
  moneyDeck: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
};

const emptyStats = (): TeamStats => ({ amountGiven: 0, amountStolen: 0, amountTakenFromCommunity: 0, amountContributedToCommunity: 0, peopleHelped: 0, decisionsHelped: 0, decisionsDeclined: 0, treasureDraws: 0, risksTaken: 0, timesStopped: 0, cooperationContributed: 0 });
export function createGame(names = TEAM_NAMES, config: GameConfig = DEFAULT_CONFIG): GameState {
  return {
    config: structuredClone(config), teams: names.map((name, i) => ({ id: `team-${i + 1}`, name: name.trim() || TEAM_NAMES[i], color: TEAM_COLORS[i], position: 0, money: config.startingMoney, status: "active", stats: emptyStats() })),
    board: BOARD, phase: "setup", currentTeam: 0, round: 1, communityChest: 0, history: [], pendingEvents: [], activeCard: null, selectedAction: null, moneyDraw: null, treasurePot: 0, treasureDraws: 0, decisionIndex: 0, decisionChoices: {}, eventMessage: null, finishAfterEvent: false, lastSnapshot: null, diceValue: null,
  };
}
export function snapshot(state: GameState): GameSnapshot {
  const { teams, phase, currentTeam, round, communityChest, history, pendingEvents, activeCard, selectedAction, moneyDraw, treasurePot, treasureDraws, decisionIndex, decisionChoices, eventMessage, finishAfterEvent, diceValue } = state;
  return structuredClone({ teams, phase, currentTeam, round, communityChest, history, pendingEvents, activeCard, selectedAction, moneyDraw, treasurePot, treasureDraws, decisionIndex, decisionChoices, eventMessage, finishAfterEvent, diceValue });
}
export function restoreSnapshot(state: GameState, snap: GameSnapshot): GameState { return { ...state, ...structuredClone(snap), lastSnapshot: null }; }
export function addHistory(state: GameState, message: string, kind: HistoryEntry["kind"] = "system"): GameState {
  return { ...state, history: [{ id: crypto.randomUUID(), round: state.round, message, kind }, ...state.history].slice(0, 100) };
}

export function changeMoney(state: GameState, teamId: string, delta: number, reason: string): GameState {
  let triggered = false;
  const teams = state.teams.map(team => {
    if (team.id !== teamId) return team;
    let nextMoney = Math.max(0, team.money + delta);
    if (delta > 0 && nextMoney > state.config.wealthLimit) {
      nextMoney = Math.max(0, Math.min(nextMoney - state.config.wealthPenalty, state.config.wealthLimit - 1));
      triggered = true;
    }
    return { ...team, money: nextMoney, status: nextMoney === 0 ? "bankrupt" as const : "active" as const };
  });
  const next = { ...state, teams };
  if (triggered) next.eventMessage = `WEALTH LIMIT EXCEEDED. The ${formatMoney(state.config.wealthPenalty)} penalty has been applied.`;
  return addHistory(next, `${state.teams.find(t => t.id === teamId)?.name ?? "A team"}: ${reason}${triggered ? ` · Wealth limit penalty −${formatMoney(state.config.wealthPenalty)}` : ""}`, "money");
}
export function formatMoney(amount: number): string { return `$${Math.max(0, amount).toLocaleString("en-US")}`; }
export function randomIndex(length: number): number { return Math.floor(Math.random() * length); }
export function randomMoney(config: GameConfig): number { return config.moneyDeck[randomIndex(config.moneyDeck.length)]; }
export function drawTreasure(): number | "thief" { return Math.random() < 0.14 ? "thief" : [100, 200, 300, 500, 700, 1000][randomIndex(6)]; }
export function getCurrentTeam(state: GameState): Team { return state.teams[state.currentTeam]; }

export function advanceTurn(state: GameState): GameState {
  const nextIndex = (state.currentTeam + 1) % state.teams.length;
  const nextRound = state.round + (nextIndex === 0 ? 1 : 0);
  const finishing = nextRound > state.config.totalRounds;
  const round = Math.min(nextRound, state.config.totalRounds);
  let next: GameState = { ...state, currentTeam: nextIndex, round, phase: "playing", diceValue: null, activeCard: null, selectedAction: null, moneyDraw: null, treasurePot: 0, treasureDraws: 0 };
  const due = next.pendingEvents.filter(event => event.dueRound <= round);
  if (due.length) {
    next = { ...next, pendingEvents: next.pendingEvents.filter(e => !due.some(ev => ev.id === e.id)), phase: "paused", finishAfterEvent: finishing };
    for (const ev of due) next = changeMoney(next, ev.teamId, ev.amount, ev.message);
    next.eventMessage = due.map(ev => ev.message).join(" ");
    return addHistory(next, `Resolved ${due.length} delayed event${due.length === 1 ? "" : "s"}.`, "system");
  }
  if (finishing) return { ...next, phase: "finished" };
  return addHistory(next, `Round ${next.round} begins`, "system");
}

export function scheduleDelayed(state: GameState, teamId: string, title: string, amount: number, afterRounds: number, eventType: PendingEvent["eventType"]): GameState {
  const name = state.teams.find(team => team.id === teamId)?.name ?? "A team";
  return { ...state, pendingEvents: [...state.pendingEvents, { id: crypto.randomUUID(), teamId, title, dueRound: Math.min(state.round + afterRounds, state.config.totalRounds), message: `${name}: ${title} — ${amount ? `+${formatMoney(amount)} unexpected support` : "no reward this time"}.`, amount, eventType }] };
}
