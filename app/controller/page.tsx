import Link from "next/link";

export default function ControllerPage() {
  return <main className="controller-page"><Link href="/" className="controller-back">← BACK TO THE GALAXY</Link><div className="controller-card"><span className="logo-mark">✦</span><span className="eyebrow">ZEST UNIVERSE · FUTURE COMPANION</span><h1>PHONE<br/>CONTROLLER</h1><p>The game is ready for a future room-code connection and shake-to-roll controller.</p><div className="controller-status"><i/> CONTROLLER CONNECTION NOT ENABLED</div><Link href="/" className="game-button secondary">RETURN TO THE GAME ↗</Link></div></main>;
}
