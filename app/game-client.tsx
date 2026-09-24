"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  addHistory, advanceTurn, changeMoney, createGame, DECISION_EVENTS, drawTreasure, formatMoney, getCurrentTeam,
  randomIndex, randomMoney, REFLECTION_PROMPTS, restoreSnapshot, scheduleDelayed, snapshot, TEAM_COLORS, TEAM_NAMES,
  type GameSnapshot, type GameState, type Team,
} from "@/lib/game";

const SAVE_KEY = "zest-universe-session-v1";
const subscribeSaveStatus = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("zest-save-updated", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("zest-save-updated", callback); };
};
const getSaveStatus = () => Boolean(window.localStorage.getItem(SAVE_KEY));

function teamById(game: GameState, id: string) { return game.teams.find(team => team.id === id); }
function GameButton({ children, onClick, disabled, variant = "primary" }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" | "quiet" }) {
  return <button className={`game-button ${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function GameClient() {
  const [game, setGame] = useState<GameState>(() => createGame());
  const savedExists = useSyncExternalStore(subscribeSaveStatus, getSaveStatus, () => false);
  const [setupNames, setSetupNames] = useState([...TEAM_NAMES]);
  const [setupConfig, setSetupConfig] = useState({ startingMoney: 1500, wealthLimit: 10000, wealthPenalty: 2000, thiefPenalty: 500, totalRounds: 6 });
  const [showTeacher, setShowTeacher] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [contributions, setContributions] = useState<Record<string, number>>({});
  const [revealedReflection, setRevealedReflection] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [rollingResult, setRollingResult] = useState<number | null>(null);
  const [walkingToken, setWalkingToken] = useState<{ teamId: string; position: number } | null>(null);

  useEffect(() => {
    if (game.phase !== "setup") {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
      window.dispatchEvent(new Event("zest-save-updated"));
    }
  }, [game]);

  const currentTeam = getCurrentTeam(game);
  const activeEvent = DECISION_EVENTS[game.decisionIndex % DECISION_EVENTS.length];
  const lockedCount = Object.keys(game.decisionChoices).length;
  const safeUpdate = useCallback((fn: (current: GameState) => GameState) => {
    setGame(current => {
      const before = snapshot(current);
      const changed = fn(current);
      return { ...changed, lastSnapshot: before };
    });
  }, []);

  const startGame = () => {
    const next = createGame(setupNames, { ...setupConfig, moneyDeck: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] });
    next.phase = "playing";
    next.history = [{ id: crypto.randomUUID(), round: 1, message: "The Zest Universe journey begins!", kind: "system" }];
    setGame(next);
    setRevealedReflection(false);
  };
  const resumeGame = () => {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    try { setGame(JSON.parse(raw) as GameState); } catch { window.localStorage.removeItem(SAVE_KEY); window.dispatchEvent(new Event("zest-save-updated")); }
  };
  const newGame = () => {
    if (!window.confirm("Start a new game? This will replace the saved session.")) return;
    window.localStorage.removeItem(SAVE_KEY); window.dispatchEvent(new Event("zest-save-updated")); setGame(createGame()); setShowTeacher(false);
  };
  const landOnTile = (teamIndex: number, position: number, start: number, state: GameState, eventIndex: number, specialRoll: number) => {
    let next: GameState = { ...state, phase: "playing" };
    const tile = next.board[position];
    const team = next.teams[teamIndex];
    next = addHistory(next, `${team.name} landed on ${tile.title}.`, "system");
    if (position < start) next = changeMoney(next, team.id, 200, "passed Launch Pad (+$200)");
    if (tile.type === "action") return { ...next, activeCard: "ACTION", selectedAction: null, moneyDraw: null };
    if (tile.type === "treasure") return { ...next, activeCard: "TREASURE", treasurePot: 0, treasureDraws: 0 };
    if (tile.type === "decision") {
      return { ...next, phase: "decision" as const, decisionIndex: eventIndex, decisionChoices: {}, activeCard: DECISION_EVENTS[eventIndex].id };
    }
    if (tile.type === "special") {
      const outcomes = [
        { amount: 300, reason: "found a supply crate (+$300)" },
        { amount: -200, reason: "paid a repair fee (−$200)" },
        { amount: 100, reason: "received a welcome bonus (+$100)" },
        { amount: 0, reason: "nothing changed" },
      ];
      const outcome = outcomes[specialRoll % outcomes.length];
      return { ...changeMoney(next, team.id, outcome.amount, outcome.reason), activeCard: "RESOLVED" };
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
    setRollingResult(null);
    await new Promise(resolve => window.setTimeout(resolve, 350));
    setRollingResult(value);
    for (let step = 1; step <= value; step += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 115));
      setWalkingToken({ teamId: rollingTeam.id, position: (start + step) % game.board.length });
    }
    safeUpdate(state => {
      const index = state.currentTeam;
      const before = state.teams[index].position;
      const after = (before + value) % state.board.length;
      let moved: GameState = { ...state, diceValue: value, teams: state.teams.map((team, i) => i === index ? { ...team, position: after } : team) };
      moved = addHistory(moved, `${state.teams[index].name} rolled ${value} and moved to ${state.board[after].title}.`, "system");
      return landOnTile(index, after, before, moved, eventIndex, specialRoll);
    });
    setWalkingToken(null);
    setIsRolling(false);
  };
  const finishTurn = () => safeUpdate(current => advanceTurn({ ...current, activeCard: null, phase: "playing" }));
  const chooseAction = (action: "give" | "take" | "rob") => {
    const moneyDraw = randomMoney(game.config);
    safeUpdate(current => ({ ...current, lastSnapshot: snapshot(current), selectedAction: action, moneyDraw, activeCard: action.toUpperCase() }));
  };

  const settleAction = (targetId?: string) => safeUpdate(current => {
    if (!current.selectedAction || current.moneyDraw === null) return current;
    const team = getCurrentTeam(current);
    const amount = current.moneyDraw;
    let next = { ...current };
    if (current.selectedAction === "give") {
      const given = Math.min(team.money, amount);
      next = changeMoney(next, team.id, -given, `gave ${formatMoney(given)} to the Community Chest`);
      next = { ...next, communityChest: next.communityChest + given, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, amountGiven: t.stats.amountGiven + given, amountContributedToCommunity: t.stats.amountContributedToCommunity + given } } : t) };
    } else if (current.selectedAction === "take") {
      const taken = Math.min(next.communityChest, amount);
      next = { ...next, communityChest: next.communityChest - taken, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, amountTakenFromCommunity: t.stats.amountTakenFromCommunity + taken } } : t) };
      next = changeMoney(next, team.id, taken, `took ${formatMoney(taken)} from the Community Chest`);
    } else if (current.selectedAction === "rob" && targetId) {
      const target = teamById(next, targetId);
      if (target) {
        const taken = Math.min(target.money, amount);
        next = changeMoney(next, targetId, -taken, `was robbed by ${team.name}`);
        next = changeMoney(next, team.id, taken, `took ${formatMoney(taken)} from ${target.name}`);
        next = { ...next, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, amountStolen: t.stats.amountStolen + taken } } : t) };
      }
    }
    return { ...next, activeCard: "RESOLVED", selectedAction: null, moneyDraw: null };
  });

  const drawAgain = () => {
    const outcome = drawTreasure();
    safeUpdate(current => {
    const team = getCurrentTeam(current);
    const draws = current.treasureDraws + 1;
    let next = { ...current, treasureDraws: draws, teams: current.teams.map((t, i) => i === current.currentTeam ? { ...t, stats: { ...t.stats, treasureDraws: t.stats.treasureDraws + 1, risksTaken: t.stats.risksTaken + (current.treasureDraws > 0 ? 1 : 0) } } : t) };
    if (outcome === "thief") {
      const totalLoss = current.treasurePot + current.config.thiefPenalty;
      next = changeMoney(next, team.id, -totalLoss, `drew THIEF and lost the $${current.treasurePot.toLocaleString()} pot plus ${formatMoney(current.config.thiefPenalty)}`);
      return addHistory({ ...next, activeCard: "THIEF", treasurePot: 0, phase: "playing", eventMessage: `The thief took the ${formatMoney(current.treasurePot)} pot. The ${formatMoney(current.config.thiefPenalty)} penalty was applied.` }, `${team.name}'s Treasure Temptation ended with a THIEF.`, "choice");
    }
    next = { ...next, treasurePot: current.treasurePot + outcome, activeCard: "TREASURE", phase: "playing" };
    return addHistory(next, `${team.name} drew ${formatMoney(outcome)} in Treasure Temptation.`, "system");
    });
  };
  const bankTreasure = () => safeUpdate(current => {
    const team = getCurrentTeam(current);
    let next = changeMoney(current, team.id, current.treasurePot, `banked ${formatMoney(current.treasurePot)} from Treasure Temptation`);
    next = { ...next, activeCard: "RESOLVED", treasurePot: 0, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, timesStopped: t.stats.timesStopped + 1 } } : t) };
    return addHistory(next, `${team.name} chose to bank their treasure.`, "choice");
  });

  const submitDecision = (teamId: string, choice: "help" | "pass") => {
    const updated = { ...game.decisionChoices, [teamId]: choice };
    if (Object.keys(updated).length < game.teams.length) { setGame({ ...game, decisionChoices: updated }); return; }
    const eventOutcomes = activeEvent.outcomes;
    const outcomesByTeam = Object.fromEntries(game.teams.map(team => [team.id, eventOutcomes[randomIndex(eventOutcomes.length)]]));
    safeUpdate(current => {
      let next: GameState = { ...current, decisionChoices: updated, phase: "playing", activeCard: null };
      const event = activeEvent;
      next = addHistory(next, `Class decision: ${event.title}`, "choice");
      for (const team of next.teams) {
        if (updated[team.id] === "help") {
          next = changeMoney(next, team.id, -event.help, `helped in ${event.title} (−${formatMoney(event.help)})`);
          next = { ...next, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, amountGiven: t.stats.amountGiven + event.help, peopleHelped: t.stats.peopleHelped + 1, decisionsHelped: t.stats.decisionsHelped + 1 } } : t) };
          const outcome = outcomesByTeam[team.id];
          next = scheduleDelayed(next, team.id, event.title, outcome, event.afterRounds, event.id as "traveller" | "family");
        } else {
          next = addHistory(next, `${team.name} chose not to help in ${event.title}.`, "choice");
          next = { ...next, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, decisionsDeclined: t.stats.decisionsDeclined + 1 } } : t) };
        }
      }
      return { ...next, activeCard: "RESOLVED", decisionChoices: {}, eventMessage: `${event.title}: choices revealed. Any outcome for a team that helped will arrive later.` };
    });
  };

  const beginCooperation = () => safeUpdate(current => ({ ...current, phase: "cooperation", activeCard: "BROKEN SHIP", decisionChoices: {}, eventMessage: null }));
  const resolveCooperation = () => safeUpdate(current => {
    let next = { ...current };
    let total = 0;
    for (const team of next.teams) {
      const contribution = Math.min(team.money, contributions[team.id] ?? 0);
      total += contribution;
      next = changeMoney(next, team.id, -contribution, `contributed ${formatMoney(contribution)} to the ship repair`);
      next = { ...next, teams: next.teams.map(t => t.id === team.id ? { ...t, stats: { ...t.stats, amountGiven: t.stats.amountGiven + contribution, cooperationContributed: t.stats.cooperationContributed + contribution } } : t) };
    }
    const succeeded = total >= 1500;
    if (succeeded) for (const team of next.teams) next = changeMoney(next, team.id, 400, "shared ship-repair reward (+$400)");
    next = addHistory(next, `Class contributed ${formatMoney(total)}. Ship repair ${succeeded ? "succeeded" : "failed"}.`, "choice");
    return { ...next, phase: "playing", activeCard: "RESOLVED", eventMessage: `The class raised ${formatMoney(total)}. ${succeeded ? "Ship repaired! Every team receives $400." : "The repair failed. Contributions are spent."}` };
  });

  const triggerDecision = () => {
    const decisionIndex = randomIndex(DECISION_EVENTS.length);
    safeUpdate(current => ({ ...current, decisionIndex, phase: "decision", activeCard: "teacher-decision", decisionChoices: {} }));
  };
  const undo = () => { if (game.lastSnapshot) setGame(restoreSnapshot(game, game.lastSnapshot as GameSnapshot)); };
  const adjustMoney = (teamId: string, amount: number) => safeUpdate(current => changeMoney(current, teamId, amount, `teacher adjustment ${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`));
  const setTeamMoney = (team: Team) => {
    const entered = window.prompt(`Set ${team.name}'s credits:`, String(team.money));
    if (entered === null) return;
    const value = Number(entered);
    if (!Number.isFinite(value) || value < 0) { window.alert("Enter a number of credits greater than or equal to zero."); return; }
    adjustMoney(team.id, Math.round(value) - team.money);
  };

  const gridPositions = useMemo(() => {
    const points: [number, number][] = [];
    for (let c = 0; c < 7; c++) points.push([1, c + 1]);
    for (let r = 2; r <= 7; r++) points.push([r, 7]);
    for (let c = 5; c >= 0; c--) points.push([7, c + 1]);
    for (let r = 6; r >= 2; r--) points.push([r, 1]);
    return points;
  }, []);

  if (game.phase === "setup") return <main className="setup-shell">
    <header className="brandline"><span className="logo-mark">✦</span><span>ZEST UNIVERSE <b>FIELD GAME</b></span><span className="brand-spacer"/><span className="teacher-badge">FACILITATOR SETUP</span></header>
    <section className="setup-card">
      <div className="setup-copy"><div className="eyebrow">A CLASSROOM ADVENTURE</div><h1>THE GREED<br/><span>GAME</span></h1><p>Travel the universe. Take chances. Decide what matters along the way.</p><div className="setup-facts"><span>✦ 6 CREWS</span><span>◷ 45–60 MIN</span><span>◎ ONE SHARED GALAXY</span></div></div>
      <div className="setup-form"><div className="section-heading"><div><span className="eyebrow">BEFORE LAUNCH</span><h2>Set up your crews</h2></div><span className="step-pill">01 / SETUP</span></div>
        <div className="team-setup-list">{setupNames.map((name, i) => <label className="team-edit" key={i}><span className="team-dot" style={{ backgroundColor: TEAM_COLORS[i] }}>{String(i + 1).padStart(2, "0")}</span><input value={name} maxLength={22} onChange={e => setSetupNames(setupNames.map((v, n) => n === i ? e.target.value : v))} aria-label={`Crew ${i + 1} name`}/><span className="edit-icon">↗</span></label>)}</div>
        <div className="setup-config"><label>Starting credits<input type="number" value={setupConfig.startingMoney} min={0} step={100} onChange={e => setSetupConfig({ ...setupConfig, startingMoney: Number(e.target.value) })}/></label><label>Wealth limit<input type="number" value={setupConfig.wealthLimit} min={100} step={500} onChange={e => setSetupConfig({ ...setupConfig, wealthLimit: Number(e.target.value) })}/></label><label>Rounds<input type="number" value={setupConfig.totalRounds} min={1} max={20} onChange={e => setSetupConfig({ ...setupConfig, totalRounds: Number(e.target.value) })}/></label><label>Wealth penalty<input type="number" value={setupConfig.wealthPenalty} min={0} step={100} onChange={e => setSetupConfig({ ...setupConfig, wealthPenalty: Number(e.target.value) })}/></label><label>Thief penalty<input type="number" value={setupConfig.thiefPenalty} min={0} step={100} onChange={e => setSetupConfig({ ...setupConfig, thiefPenalty: Number(e.target.value) })}/></label></div>
        <GameButton onClick={startGame}>LAUNCH THE GAME <span>↗</span></GameButton>
        {savedExists && <GameButton onClick={resumeGame} variant="secondary">RESUME PREVIOUS GAME</GameButton>}
        <p className="objective-note">Your goal: finish with as much money as possible. Avoid bankruptcy and stay below the wealth limit.</p>
      </div>
    </section><footer className="setup-footer"><span>BW MONASTERY · ZEST PROGRAMME</span><span>TEACHER CONTROLLED · CLASSROOM READY</span></footer>
  </main>;

  const currentTile = game.board[currentTeam.position];
  const showModal = Boolean(game.activeCard || game.phase === "decision" || game.phase === "cooperation" || game.eventMessage);
  return <main className="game-shell">
    <header className="game-topbar"><div className="brandline"><span className="logo-mark">✦</span><span>ZEST UNIVERSE <b>FIELD GAME</b></span></div><div className="game-meta"><span className="round-pill"><i/> ROUND {game.round} <small>/ {game.config.totalRounds}</small></span><span className="room-pill">● CLASSROOM MODE</span></div><div className="top-actions"><button className="icon-button" onClick={() => setShowHistory(!showHistory)} title="Game history">☷</button><button className="teacher-pill" onClick={() => setShowTeacher(!showTeacher)}>⚙ TEACHER <span>⌄</span></button></div></header>
    <div className="game-layout">
      <section className="board-column">
        <div className="board-heading"><div><span className="eyebrow">ZEST UNIVERSE · SECTOR 01</span><h1>THE ORBITAL TRAIL</h1></div><div className="pot-card"><span>COMMUNITY CHEST</span><b>{formatMoney(game.communityChest)}</b><i>Shared galaxy fund</i></div></div>
        <div className="board-wrap"><div className="board-grid">
          {game.board.map((tile, index) => { const [row, col] = gridPositions[index]; const positionOf = (team: Team) => walkingToken?.teamId === team.id ? walkingToken.position : team.position; const occupants = game.teams.filter(team => positionOf(team) === index); const isCurrentPosition = walkingToken?.teamId === currentTeam.id ? walkingToken.position === index : index === currentTeam.position; return <div key={tile.id} className={`board-tile tile-${tile.type} ${isCurrentPosition ? "current-space" : ""}`} style={{ gridRow: row, gridColumn: col }}>
            <span className="tile-icon">{tile.icon}</span><span className="tile-title">{tile.title}</span><span className="tile-subtitle">{tile.subtitle}</span>
            {occupants.length > 0 && <span className="tokens">{occupants.map((t, i) => <i key={t.id} title={t.name} style={{ backgroundColor: t.color, transform: `translateX(${i * 8}px)` }}>{game.teams.indexOf(t) + 1}</i>)}</span>}
          </div>; })}
          <div className="board-center"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="center-star">✦</span><span className="center-label">THE ZEST<br/>UNIVERSE</span><span className="center-coordinate">A JOURNEY OF CHOICE</span><div className="center-current" style={{ borderColor: currentTeam.color }}><i style={{ background: currentTeam.color }}/><span><small>{isRolling ? "DICE ROLLING" : "NOW EXPLORING"}</small><b>{currentTeam.name}</b></span><strong className={rollingResult ? "dice-result" : ""}>{rollingResult ? `🎲 ${rollingResult}` : currentTile.icon}</strong></div></div>
        </div></div>
        <div className="action-bar"><div className="turn-copy"><span className="turn-pip" style={{ background: currentTeam.color }}/><span><small>{isRolling ? "MOVING THROUGH THE ORBIT" : "IT’S YOUR TURN"}</small><b>{currentTeam.name}</b></span><em>SPACE {String((walkingToken?.teamId === currentTeam.id ? walkingToken.position : currentTeam.position) + 1).padStart(2, "0")} / {game.board.length}</em></div>{game.phase === "playing" && !game.activeCard ? <div className="dice-controls"><span>{isRolling ? "MOVING..." : "ROLL THE DICE"}</span>{[1,2,3,4,5,6].map(n => <button key={n} disabled={isRolling} onClick={() => void roll(n)} className={game.diceValue === n ? "dice-selected" : ""}>{n}</button>)}</div> : <div className="phase-note">{game.phase === "paused" ? "GAME PAUSED" : game.phase === "decision" ? "CLASS DECISION IN PROGRESS" : game.phase === "cooperation" ? "SHIP REPAIR EVENT" : "RESOLVE THE SPACE"}</div>}</div>
      </section>
      <aside className="sidebar"><div className="sidebar-head"><div><span className="eyebrow">CREW STATUS</span><h2>THE FLEET <span>06</span></h2></div><button className="small-control" onClick={() => setShowTeacher(!showTeacher)}>•••</button></div>
        <div className="crew-list">{game.teams.map((team, i) => <CrewCard key={team.id} team={team} index={i} current={i === game.currentTeam} wealthLimit={game.config.wealthLimit}/>)}</div>
        <div className="sidebar-bottom"><div className="progress-copy"><span>JOURNEY PROGRESS</span><b>{Math.min(100, Math.round(((game.round - 1) / game.config.totalRounds) * 100))}%</b></div><div className="progress-track"><i style={{ width: `${Math.min(100, ((game.round - 1) / game.config.totalRounds) * 100)}%` }}/></div><div className="progress-foot"><span>ROUND {game.round} OF {game.config.totalRounds}</span><span>{game.pendingEvents.length} FUTURE SIGNAL{game.pendingEvents.length === 1 ? "" : "S"}</span></div></div>
      </aside>
    </div>
    <footer className="game-footer"><span><i className="status-live"/> GAME IN PROGRESS <b>·</b> TEACHER LED</span><button onClick={() => setShowHistory(!showHistory)}>◷ VIEW ACTIVITY LOG</button><span>DESIGNED WITH ZEST STUDENTS <b>✦</b></span></footer>

    {showTeacher && <div className="drawer-scrim" onClick={() => setShowTeacher(false)}><aside className="teacher-drawer" onClick={e => e.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">FACILITATOR TOOLS</span><h2>Teacher controls</h2></div><button onClick={() => setShowTeacher(false)}>✕</button></div>
      <div className="drawer-section"><span className="drawer-label">SESSION</span><div className="drawer-buttons">{game.phase === "paused" ? <GameButton onClick={() => safeUpdate(g => ({ ...g, phase: "playing", eventMessage: null }))}>RESUME GAME</GameButton> : <GameButton onClick={() => safeUpdate(g => ({ ...g, phase: "paused", eventMessage: "Game paused. Take a moment, then resume when ready." }))} variant="secondary">PAUSE GAME</GameButton>}<GameButton onClick={finishTurn} variant="secondary">ADVANCE TURN →</GameButton><GameButton onClick={undo} disabled={!game.lastSnapshot} variant="secondary">↶ UNDO LAST ACTION</GameButton></div></div>
      <div className="drawer-section"><span className="drawer-label">TRIGGER AN EVENT</span><div className="drawer-buttons"><GameButton onClick={triggerDecision} variant="secondary">💭 START CLASS DECISION</GameButton><GameButton onClick={beginCooperation} variant="secondary">🛠 BROKEN SHIP CHALLENGE</GameButton><GameButton onClick={() => safeUpdate(g => ({ ...g, activeCard: "TREASURE", phase: "playing", treasurePot: 0, treasureDraws: 0 }))} variant="secondary">💎 TREASURE TEMPTATION</GameButton></div></div>
      <div className="drawer-section"><span className="drawer-label">QUICK ADJUSTMENTS</span>{game.teams.map(team => <div className="adjust-row" key={team.id}><span><i style={{ backgroundColor: team.color }}/>{team.name}</span><button onClick={() => adjustMoney(team.id, -100)}>−100</button><button className="balance-button" onClick={() => setTeamMoney(team)}>{formatMoney(team.money)}</button><button onClick={() => adjustMoney(team.id, 100)}>+100</button><select aria-label={`Move ${team.name} to a board tile`} value={team.position} onChange={e => safeUpdate(g => ({ ...g, teams: g.teams.map(t => t.id === team.id ? { ...t, position: Number(e.target.value) } : t) }))}>{game.board.map((tile, i) => <option value={i} key={tile.id}>{String(i + 1).padStart(2, "0")}</option>)}</select></div>)}</div>
      <div className="drawer-section"><span className="drawer-label">PENDING EVENTS</span>{game.pendingEvents.length ? game.pendingEvents.map(event => <div className="pending-row" key={event.id}><b>{event.title}</b><span>{teamById(game, event.teamId)?.name} · due round {event.dueRound}</span></div>) : <p className="muted">No future events scheduled.</p>}</div>
      <div className="drawer-bottom"><GameButton onClick={newGame} variant="danger">↻ START NEW GAME</GameButton><Link href="/controller" className="controller-link">Controller route · ready for a future phone connection ↗</Link></div>
    </aside></div>}

    {showHistory && <div className="history-panel"><div className="drawer-head"><div><span className="eyebrow">FACILITATOR VIEW</span><h2>Activity log</h2></div><button onClick={() => setShowHistory(false)}>✕</button></div>{game.history.length ? game.history.map(entry => <div className="history-entry" key={entry.id}><i className={`history-dot ${entry.kind}`}/><div><small>ROUND {entry.round}</small><span>{entry.message}</span></div></div>) : <p className="muted">Actions will appear here as you play.</p>}</div>}

    {showModal && <div className="modal-scrim"><section className={`event-modal ${game.phase === "decision" || game.phase === "cooperation" ? "wide-modal" : ""}`}>
      {game.phase === "decision" && <>
        <div className="modal-ornament">💭</div><span className="eyebrow">GLOBAL DECISION · SECRET CHOICES</span>
        <h2>{activeEvent.title}</h2><p className="event-description">{activeEvent.description}</p>
        <div className="decision-status"><span>🔒 Choices stay hidden until all crews decide</span><b>{lockedCount} / {game.teams.length} LOCKED</b></div>
        <div className="decision-grid">{game.teams.map(team => <div className={`decision-team ${game.decisionChoices[team.id] ? "locked" : ""}`} key={team.id}>
          <div className="decision-team-name"><i style={{ background: team.color }}/><b>{team.name}</b>{game.decisionChoices[team.id] && <small>LOCKED ✓</small>}</div>
          <div className="choice-buttons"><button disabled={Boolean(game.decisionChoices[team.id])} onClick={() => submitDecision(team.id, "help")}>HELP<br/><small>−{formatMoney(activeEvent.help)}</small></button><button disabled={Boolean(game.decisionChoices[team.id])} onClick={() => submitDecision(team.id, "pass")}>PASS<br/><small>KEEP CREDITS</small></button></div>
        </div>)}</div>
      </>}
      {game.phase === "cooperation" && <>
        <div className="modal-ornament">🛠</div><span className="eyebrow">GLOBAL CO-OP EVENT</span><h2>Broken spaceship</h2>
        <p className="event-description">The transport ship is stranded. The class needs <b>$1,500</b> to repair it. Everyone may contribute up to $500. If it’s repaired, every crew receives $400.</p>
        <div className="coop-total"><span>SHIP REPAIR FUND</span><b>{formatMoney(Object.values(contributions).reduce((sum, amount) => sum + amount, 0))} <small>/ $1,500</small></b></div>
        <div className="contribution-grid">{game.teams.map(team => <label key={team.id}><span><i style={{ background: team.color }}/>{team.name}</span><select value={contributions[team.id] ?? 0} onChange={e => setContributions({ ...contributions, [team.id]: Number(e.target.value) })}>{[0,100,200,300,400,500].map(amount => <option key={amount} value={amount}>{formatMoney(amount)}</option>)}</select></label>)}</div>
        <GameButton onClick={resolveCooperation}>REVEAL CONTRIBUTIONS →</GameButton>
      </>}
      {game.activeCard === "THIEF" && <>
        <div className="modal-ornament thief-ornament">☠️</div><span className="eyebrow">TREASURE TEMPTATION · {currentTeam.name}</span><h2>THIEF!</h2>
        <p className="event-description">{game.eventMessage}</p><GameButton onClick={() => setGame({ ...game, eventMessage: null, activeCard: "RESOLVED" })}>CONTINUE →</GameButton>
      </>}
      {game.eventMessage && game.activeCard !== "THIEF" && game.phase !== "decision" && game.phase !== "cooperation" && <>
        <div className="modal-ornament">✦</div><span className="eyebrow">A SIGNAL FROM THE GALAXY</span><h2>Event resolved</h2><p className="event-description">{game.eventMessage}</p>
        <GameButton onClick={() => setGame({ ...game, eventMessage: null, phase: game.finishAfterEvent ? "finished" : "playing", finishAfterEvent: false, activeCard: game.finishAfterEvent ? null : (game.phase === "playing" ? "RESOLVED" : game.activeCard) })}>CONTINUE THE JOURNEY →</GameButton>
      </>}
      {game.phase !== "decision" && game.phase !== "cooperation" && !game.eventMessage && game.activeCard === "ACTION" && <>
        <div className="modal-ornament">🎴</div><span className="eyebrow">ACTION SPACE · {currentTeam.name}</span><h2>What will you do?</h2>
        <p className="event-description">Draw an action card, then see how many credits are involved.</p>
        <div className="action-choice-grid">
          <button onClick={() => chooseAction("give")}><b>♡</b><strong>GIVE</strong><span>Add to the shared Community Chest</span></button>
          <button onClick={() => chooseAction("take")}><b>↗</b><strong>TAKE</strong><span>Withdraw from the shared chest</span></button>
          <button onClick={() => chooseAction("rob")}><b>⚡</b><strong>ROB</strong><span>Take credits from another crew</span></button>
        </div><GameButton variant="quiet" onClick={finishTurn}>SKIP THIS SPACE</GameButton>
      </>}
      {game.phase !== "decision" && game.phase !== "cooperation" && !game.eventMessage && game.selectedAction && game.moneyDraw !== null && <>
        <div className="modal-ornament">🪙</div><span className="eyebrow">MONEY CARD REVEAL</span>
        <h2>{game.selectedAction === "give" ? "Give to the community" : game.selectedAction === "take" ? "Take from the chest" : "Choose a crew"}</h2>
        <div className="money-card-reveal"><small>THE CARD SHOWS</small><b>{formatMoney(game.moneyDraw)}</b><span>CREDITS</span></div>
        {game.selectedAction === "rob" ? <div className="target-grid">{game.teams.filter(team => team.id !== currentTeam.id).map(team => <button key={team.id} onClick={() => settleAction(team.id)}><i style={{ background: team.color }}/><b>{team.name}</b><small>HAS {formatMoney(team.money)}</small></button>)}</div> : <GameButton onClick={() => settleAction()}>{game.selectedAction === "give" ? "ADD TO COMMUNITY CHEST" : "WITHDRAW AVAILABLE CREDITS"} →</GameButton>}
      </>}
      {game.phase !== "decision" && game.phase !== "cooperation" && !game.eventMessage && game.activeCard === "TREASURE" && <>
        <div className="modal-ornament treasure-orb">💎</div><span className="eyebrow">TREASURE TEMPTATION · {currentTeam.name}</span><h2>How far will you go?</h2>
        <p className="event-description">Draw again to grow your pot. A THIEF takes the pot and a penalty. Know when enough is enough.</p>
        <div className="treasure-pot"><small>CURRENT POT</small><b>{formatMoney(game.treasurePot)}</b><span>{game.treasureDraws} {game.treasureDraws === 1 ? "CARD" : "CARDS"} DRAWN</span></div>
        <div className="treasure-actions"><GameButton onClick={bankTreasure} disabled={!game.treasurePot}>BANK {formatMoney(game.treasurePot)}</GameButton><GameButton variant="danger" onClick={drawAgain}>DRAW AGAIN ↗</GameButton></div>
      </>}
      {game.phase !== "decision" && game.phase !== "cooperation" && !game.eventMessage && game.activeCard === "RESOLVED" && <>
        <div className="modal-ornament">🎲</div><span className="eyebrow">{currentTile.title.toUpperCase()} · {currentTeam.name}</span><h2>Keep exploring</h2>
        <p className="event-description">{currentTile.subtitle}. See what the universe has in store.</p><GameButton onClick={finishTurn}>CONTINUE →</GameButton>
      </>}
    </section></div>}

    {game.phase === "paused" && !showModal && <div className="paused-ribbon"><span>Ⅱ</span> GAME PAUSED <button onClick={() => safeUpdate(g => ({ ...g, phase: "playing" }))}>RESUME →</button></div>}
    {game.phase === "finished" && <div className="modal-scrim endgame-scrim"><section className="event-modal final-modal"><div className="modal-ornament">✦</div><span className="eyebrow">THE JOURNEY ENDS HERE</span><h2>Final standings</h2><p className="event-description">The credits tell one part of the story.</p><div className="final-table">{[...game.teams].sort((a,b) => b.money-a.money).map((team, i) => <div className="final-row" key={team.id}><span className="rank">{String(i+1).padStart(2,"0")}</span><i style={{ background: team.color }}/><b>{team.name}</b><strong>{formatMoney(team.money)}</strong></div>)}</div>{revealedReflection ? <><h3 className="reflection-title">BUT MONEY WASN’T THE ONLY THING WE WERE WATCHING.</h3><div className="reflection-table"><div className="reflection-head"><span>CREW</span><span>GIVEN</span><span>STOLEN</span><span>CHEST IN</span><span>CHEST OUT</span><span>HELPED</span><span>CO-OP</span><span>RISKS</span><span>STOPPED</span></div>{game.teams.map(team => <div key={team.id} className="reflection-row"><b>{team.name}</b><span>{formatMoney(team.stats.amountGiven)}</span><span>{formatMoney(team.stats.amountStolen)}</span><span>{formatMoney(team.stats.amountContributedToCommunity)}</span><span>{formatMoney(team.stats.amountTakenFromCommunity)}</span><span>{team.stats.peopleHelped}</span><span>{formatMoney(team.stats.cooperationContributed)}</span><span>{team.stats.risksTaken}</span><span>{team.stats.timesStopped}</span></div>)}</div><div className="prompt-list"><span className="eyebrow">REFLECTION PROMPTS</span>{REFLECTION_PROMPTS.slice(0,4).map(prompt => <p key={prompt}>“{prompt}”</p>)}</div></> : <button className="reveal-button" onClick={() => setRevealedReflection(true)}>BUT MONEY WASN’T THE ONLY THING WE WERE WATCHING <span>↗</span></button>}<div className="final-actions"><GameButton onClick={newGame} variant="secondary">START A NEW JOURNEY</GameButton><GameButton onClick={() => window.print()} variant="quiet">PRINT RESULTS</GameButton></div></section></div>}
    {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
  </main>;
}

function CrewCard({ team, index, current, wealthLimit }: { team: Team; index: number; current: boolean; wealthLimit: number }) {
  const pct = Math.min(100, (team.money / wealthLimit) * 100);
  const warning = pct >= 80;
  return <div className={`crew-card ${current ? "crew-current" : ""} ${team.status === "bankrupt" ? "crew-bankrupt" : ""}`} style={{ "--crew-color": team.color } as React.CSSProperties}><div className="crew-main"><span className="crew-avatar">{String(index + 1).padStart(2, "0")}</span><span className="crew-name"><b>{team.name}</b><small>{team.status === "bankrupt" ? "BANKRUPT · STILL IN PLAY" : current ? "CURRENT CREW" : "EXPLORING"}</small></span>{current && <span className="current-chevron">↗</span>}</div><div className="crew-money-line"><b className={warning ? "near-limit" : ""}>{formatMoney(team.money)}</b><span>{Math.round(pct)}% OF LIMIT</span></div><div className="crew-money-track"><i style={{ width: `${pct}%` }}/></div></div>;
}
