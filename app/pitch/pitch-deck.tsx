"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const slides = [
  { title: "Cash Dash", color: "#f36b4f" },
  { title: "The money", color: "#f2c94c" },
  { title: "A team’s turn", color: "#4778f5" },
  { title: "GIVE, TAKE, or ROB", color: "#f36b4f" },
  { title: "Push your luck", color: "#55c992" },
  { title: "Chance and team choices", color: "#a981f5" },
  { title: "Who wins?", color: "#f2c94c" },
];

const teamColors = ["#3975f6", "#f2c94c", "#e8584f", "#ffffff", "#f28a3f"];
const teamNames = ["Blue", "Yellow", "Red", "White", "Orange"];

export default function PitchDeck() {
  const [current, setCurrent] = useState(0);
  const go = useCallback((direction: number) => {
    setCurrent((index) => Math.max(0, Math.min(slides.length - 1, index + direction)));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        go(1);
      }
      if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        go(-1);
      }
      if (event.key === "Home") setCurrent(0);
      if (event.key === "End") setCurrent(slides.length - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  const active = slides[current];

  return (
    <main className="pitch-shell" style={{ "--pitch-accent": active.color } as React.CSSProperties}>
      <div className="pitch-topline">
        <Link className="pitch-brand" href="/" aria-label="Back to Cash Dash game">
          CASH DASH
        </Link>
        <span>HOW TO PLAY</span>
        <span className="pitch-count">
          {String(current + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
        </span>
      </div>

      <section className="pitch-slide" aria-live="polite" aria-atomic="true">
        {current === 0 && (
          <div className="pitch-content pitch-cover">
            <span className="pitch-emoji" aria-hidden="true">🎲</span>
            <p className="pitch-kicker">A 30-MINUTE CLASSROOM GAME</p>
            <h1>Cash Dash</h1>
            <p className="pitch-lead">Roll, make choices, and try to finish with the most money.</p>
            <div className="pitch-team-row" aria-label="Blue, Yellow, Red, White, and Orange teams">
              {teamNames.map((name, i) => (
                <span className="pitch-team" key={name}>
                  <i style={{ backgroundColor: teamColors[i] }} />{name}
                </span>
              ))}
            </div>
          </div>
        )}

        {current === 1 && (
          <div className="pitch-content pitch-money">
            <p className="pitch-kicker">YOUR STARTING CASH</p>
            <h1>Every token is worth <em>$100</em></h1>
            <div className="pitch-money-example">
              <span className="pitch-token-stack" aria-hidden="true">🪙 🪙 🪙</span>
              <strong>10 tokens</strong>
              <b>$1,000</b>
            </div>
            <p className="pitch-lead">Each team starts with $1,000. The game screen keeps the money total for you.</p>
          </div>
        )}

        {current === 2 && (
          <div className="pitch-content">
            <p className="pitch-kicker">TAKE TURNS AS A TEAM</p>
            <h1>Roll. Move. Follow the space.</h1>
            <div className="pitch-steps">
              <div><b>1</b><strong>Roll</strong><span>The facilitator rolls the real die and enters the number on their phone.</span></div>
              <div><b>2</b><strong>Move</strong><span>Your team piece moves that many spaces.</span></div>
              <div><b>3</b><strong>Play</strong><span>Do what the space says, then pass the turn to the next team.</span></div>
            </div>
            <p className="pitch-note">Turn order: Blue, Yellow, Red, White, Orange. Keep taking turns until the facilitator clicks End Game.</p>
          </div>
        )}

        {current === 3 && (
          <div className="pitch-content">
            <p className="pitch-kicker">DRAW A CARD SPACE</p>
            <h1>Choose what to do</h1>
            <div className="pitch-actions">
              <div className="pitch-action give"><b>GIVE</b><span>Add money to the Community Chest.</span></div>
              <div className="pitch-action take"><b>TAKE</b><span>Take money from the Community Chest.</span></div>
              <div className="pitch-action rob"><b>ROB</b><span>Take money from another team.</span></div>
            </div>
            <p className="pitch-lead">Then draw a UNO number card from 1 to 9. Each number is worth $100.</p>
            <p className="pitch-example">A 6 means $600.</p>
          </div>
        )}

        {current === 4 && (
          <div className="pitch-content pitch-luck">
            <p className="pitch-kicker">PUSH YOUR LUCK SPACE</p>
            <h1>Bank it or risk another draw</h1>
            <div className="pitch-luck-flow">
              <div><span aria-hidden="true">🔢</span><b>Number card</b><small>Add $100 to $900 to your unbanked pot.</small></div>
              <div className="pitch-luck-word">OR</div>
              <div><span aria-hidden="true">👑</span><b>Picture card</b><small>J, Q, or K clears this visit’s unbanked pot.</small></div>
            </div>
            <p className="pitch-lead">Bank your pot to keep it safe. Money already banked stays yours.</p>
          </div>
        )}

        {current === 5 && (
          <div className="pitch-content">
            <p className="pitch-kicker">SPECIAL SPACES</p>
            <h1>Some spaces need a team choice</h1>
            <div className="pitch-specials">
              <div><span aria-hidden="true">🎲</span><strong>Chance Card</strong><p>Read the result on screen. Your team may gain or lose money.</p></div>
              <div><span aria-hidden="true">💬</span><strong>Team Choice</strong><p>Choose HELP or PASS on the controller. The screen records each team’s choice.</p></div>
            </div>
            <p className="pitch-note">HELP costs the amount shown. A later reward might be $0, so helping can mean no benefit. PASS keeps your money.</p>
          </div>
        )}

        {current === 6 && (
          <div className="pitch-content pitch-finish">
            <span className="pitch-emoji" aria-hidden="true">🏆</span>
            <p className="pitch-kicker">WHEN THE FACILITATOR ENDS THE GAME</p>
            <h1>The team with the most money wins</h1>
            <p className="pitch-lead">Your team’s money counts. The shared Community Chest stays separate.</p>
            <p className="pitch-ready">Ready to play?</p>
          </div>
        )}
      </section>

      <div className="pitch-footer">
        <div className="pitch-progress" aria-label={`Slide ${current + 1} of ${slides.length}`}>
          <span style={{ width: `${((current + 1) / slides.length) * 100}%` }} />
        </div>
        <div className="pitch-controls">
          <span className="pitch-hint">Use ← and → to move through the slides</span>
          <div>
            <button onClick={() => go(-1)} disabled={current === 0} aria-label="Previous slide">←</button>
            <button onClick={() => go(1)} disabled={current === slides.length - 1} aria-label="Next slide">→</button>
          </div>
        </div>
      </div>
    </main>
  );
}
