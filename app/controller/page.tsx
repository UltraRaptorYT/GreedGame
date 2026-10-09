"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ControllerCommand, ControllerScreenStatus, RoomCredentials } from "@/lib/controller-relay";
import {
  createRoomRealtimeClient,
  type RoomRealtimeConfig,
} from "@/lib/controller-realtime";

type RelayResponse = {
  connected: boolean;
  screenStatus: ControllerScreenStatus | null;
  realtime?: RoomRealtimeConfig;
};

export default function ControllerPage() {
  const [connected, setConnected] = useState(false);
  const [screenStatus, setScreenStatus] = useState<ControllerScreenStatus | null>(null);
  const [choices, setChoices] = useState<Record<string, "help" | "pass">>({});
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [room, setRoom] = useState<RoomCredentials | null>(null);
  const decision = screenStatus?.phase === "decision" ? screenStatus.decision : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const roomId = params.get("room");
    const roomKey = params.get("key");
    if (roomId && roomKey) setRoom({ roomId, roomKey });
    else setMessage("Open the phone controller from the game screen so it joins the right room.");
  }, []);

  useEffect(() => {
    if (!room) return;
    let active = true;
    let timer: number | undefined;
    let supabase: ReturnType<typeof createRoomRealtimeClient> | undefined;
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    const check = async (includeRealtimeConfig = false) => {
      try {
        const response = await fetch("/api/controller", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "poll",
            ...room,
            includeRealtimeConfig,
          }),
          cache: "no-store",
        });
        const status = await response.json() as RelayResponse;
        if (active) {
          setConnected(status.connected);
          setScreenStatus(status.screenStatus);
        }
        return status;
      } catch {
        if (active) setConnected(false);
        return null;
      }
    };
    const start = async () => {
      const initial = await check(true);
      if (!active) return;
      if (initial?.realtime) {
        supabase = createRoomRealtimeClient(initial.realtime);
        channel = supabase
          .channel(`cash-dash:${room.roomKey}`)
          .on("broadcast", { event: "room_update" }, () => void check())
          .subscribe((status) => {
            if (status === "SUBSCRIBED") void check();
          });
      }
      timer = window.setInterval(() => void check(), 30_000);
    };
    void start();
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [room]);

  useEffect(() => {
    setChoices({});
  }, [decision?.key]);

  const send = async (command: ControllerCommand) => {
    if (!room) {
      setMessage("Open the phone controller from the game screen link first.");
      return false;
    }
    setSending(true);
    try {
      const response = await fetch("/api/controller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...room, command }),
      });
      if (!response.ok) throw new Error("Could not send input");
      const sentMessage = command.type === "roll"
        ? `Die result ${command.value} sent`
        : "Team choices submitted. Check the game screen.";
      setMessage(sentMessage);
      window.setTimeout(() => setMessage(""), 3000);
      return true;
    } catch {
      setMessage("Could not connect. Check that both devices use the same game address.");
      return false;
    } finally {
      setSending(false);
    }
  };

  const submitChoices = () => {
    if (!decision || !decision.teams.every((team) => choices[team.id])) return;
    void send({ type: "decision", choices });
  };

  return <main className="controller-page"><div className="controller-card remote-controller">
    <div className="controller-head"><Link href="/" className="controller-back">? GAME SCREEN</Link><span className={`controller-status ${connected ? "online" : "offline"}`}><i/>{connected ? "GAME SCREEN CONNECTED" : "WAITING FOR GAME SCREEN"}</span></div>
    <span className="eyebrow">FACILITATOR PHONE INPUT</span><h1>CASH<br/>DASH</h1>
    {!room && <p className="controller-note">Open the controller using the link from the game screen. The link connects this phone to that game.</p>}
    <p>Tap the physical die result here. Enter UNO card draws on the classroom game screen.</p>
    <section className="phone-input-section"><div><span className="phone-step">01</span><div><h2>Enter the die</h2><p>Tap what you rolled</p></div></div><div className="phone-number-grid die-grid">{[1,2,3,4,5,6].map(n => <button key={n} onClick={() => void send({ type: "roll", value: n })}>{n}</button>)}</div></section>
    {decision && <section className="phone-input-section phone-decision-section">
      <div><span className="phone-step">02</span><div><h2>Enter team choices</h2><p>{decision.title} ? HELP costs ${decision.help}; the later reward may be $0.</p></div></div>
      <p className="phone-decision-prompt">Collect each team?s choice on the whiteboard, select it here, then submit once. Choices stay off the game screen until submission.</p>
      <div className="phone-decision-list">{decision.teams.map(team => <div className="phone-decision-team" key={team.id}>
        <b><i style={{ backgroundColor: team.color }}/>{team.name}</b>
        <div><button className={choices[team.id] === "help" ? "selected" : ""} onClick={() => setChoices(current => ({ ...current, [team.id]: "help" }))}>HELP ? ${decision.help}</button><button className={choices[team.id] === "pass" ? "selected" : ""} onClick={() => setChoices(current => ({ ...current, [team.id]: "pass" }))}>PASS</button></div>
      </div>)}</div>
      <button className="phone-submit-decisions" disabled={sending || !connected || !decision.teams.every(team => choices[team.id])} onClick={submitChoices}>SUBMIT ALL CHOICES</button>
    </section>}
    {message && <div className="controller-message" role="status">{message}</div>}
    <p className="controller-note">Keep this page open on your phone and the board open on the classroom screen, using the same game address. For a local game, connect both devices to the same Wi-Fi. If hosted online, both devices need internet access.</p>
  </div></main>;
}
