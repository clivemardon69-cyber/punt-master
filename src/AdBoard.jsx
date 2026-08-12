import React, { useState, useEffect } from 'react'

// Pitch-side advertising boards — a slim, rotating strip along the bottom of
// the screen, styled like the LED hoardings around a football pitch.
// This is placeholder inventory: swap SLOTS for real sponsors once you've
// sold the space (or wire it up to an ad network later). No popups, no
// interstitials — it just sits quietly at the edge of the screen and cycles.
const SLOTS = [
  { text: 'YOUR AD HERE', sub: 'Pitch-side space available — enquire within' },
  { text: 'THE KINGS ARMS', sub: 'Proud sponsor of Gameweek Fixtures' },
  { text: 'PUNT MASTER', sub: 'Back the underdog. Score bigger.' },
  { text: 'SPONSOR THIS LEAGUE', sub: 'Get your name on the board — ask the admin' },
]

const ROTATE_MS = 5000

export default function AdBoard() {
  const [i, setI] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % SLOTS.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [])

  const slot = SLOTS[i]

  return (
    <div className="ad-board" role="complementary" aria-label="Sponsor board">
      <span className="ad-board-tag mono">AD</span>
      <div className="ad-board-track">
        <div className="ad-board-slide" key={i}>
          <span className="ad-board-text">{slot.text}</span>
          <span className="ad-board-sub">{slot.sub}</span>
        </div>
      </div>
      <div className="ad-board-dots">
        {SLOTS.map((_, idx) => (
          <span key={idx} className={idx === i ? 'ad-dot active' : 'ad-dot'} />
        ))}
      </div>
    </div>
  )
}
