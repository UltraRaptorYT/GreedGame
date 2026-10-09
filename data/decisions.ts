export type DecisionEventContent = {
  id: "traveller" | "family";
  title: string;
  description: string;
  help: number;
  outcomes: number[];
  delayRolls: [number, number];
};

export const DECISION_EVENTS: DecisionEventContent[] = [
  { id: "traveller", title: "A Lost Traveller", description: "A traveller has lost their wallet and needs $200 to get home. Would your team help?", help: 200, outcomes: [0, 200, 500, 1000], delayRolls: [2, 5] },
  { id: "family", title: "Emergency Groceries", description: "A family needs $300 for food. Would your team help?", help: 300, outcomes: [0, 300, 700], delayRolls: [2, 5] },
];

export const REFLECTION_PROMPTS = [
  "Which decisions were hardest?", "Would you help if no reward was promised?", "When did you feel tempted to take more?", "Why did you decide to stop drawing?", "How did it feel when another group took from you?", "Why did you contribute to the shared event?", "Did knowing there was a winner affect your decisions?", "Is having more always better?", "When does wanting more become greed?",
];
