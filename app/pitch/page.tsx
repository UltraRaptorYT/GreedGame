import type { Metadata } from "next";
import PitchDeck from "./pitch-deck";

export const metadata: Metadata = {
  title: "How to Play Cash Dash",
  description: "A quick, kid-friendly guide to playing Cash Dash.",
};

export default function PitchPage() {
  return <PitchDeck />;
}
