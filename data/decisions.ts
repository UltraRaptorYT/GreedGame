export type DecisionEventContent = {
  id: "traveller" | "family";
  title: string;
  description: string;
  help: number;
  outcomes: number[];
  afterRounds: number;
};

export const DECISION_EVENTS: DecisionEventContent[] = [
  { id: "traveller", title: "Stranded Traveller", description: "An elderly traveller has lost his wallet and needs 200 credits to get home.", help: 200, outcomes: [0, 200, 500, 1000], afterRounds: 1 },
  { id: "family", title: "Family in Need", description: "A family needs 300 credits for emergency groceries. Would your team help?", help: 300, outcomes: [0, 0, 300, 700], afterRounds: 2 },
];

export const REFLECTION_PROMPTS = [
  "Which decisions were hardest?", "Would you have helped if you knew there was no reward?", "When did you feel tempted to take more?", "Why did you decide to stop drawing?", "How did it feel when another group took from you?", "Why did you contribute to the shared event?", "Did knowing there was a winner affect your decisions?", "Is having more always better?", "When does wanting more become greed?",
];
