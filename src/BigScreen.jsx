import React from 'react'

// Placeholder sponsor credit for the screen itself — same idea as AdBoard's
// SLOTS, swap for a real sponsor once you've sold this (premium, one-name)
// spot. Unlike the hoarding, this doesn't rotate — a jumbotron in a real
// stadium usually carries one "presented by" credit at a time, not a ticker.
const SCREEN_SPONSOR = 'Punt Master'

// The stadium "big screen" — shows a welcome message before kick-off and
// flips to full-time results once the admin enters them. Read-only display,
// no interaction, sits above the tabs on the league page.
export default function BigScreen({ name, fixtures, gameweek }) {
  // Only this gameweek's own fixtures — otherwise an older, already
  // finished round's results keep showing up here under the current
  // gameweek's heading once more than one round has results in. Sorted
  // by kick-off time (earliest first), not just whichever order they
  // were added in.
  const gwFixtures = (fixtures || [])
    .filter(f => f.gameweek_id === gameweek?.id)
    .slice()
    .sort((a, b) => {
      if (!a.kickoff) return 1
      if (!b.kickoff) return -1
      return new Date(a.kickoff) - new Date(b.kickoff)
    })
  const withResults = gwFixtures.filter(f => f.result)
  const playerName = name ? name.toUpperCase() : 'PLAYER'

  let heading, lines
  if (withResults.length > 0) {
    heading = `FULL TIME — GAMEWEEK ${gameweek?.number ?? ''}`
    lines = withResults.map(f => {
      if (f.result === 'D') return `${f.home} v ${f.away} — DRAW`
      const winner = f.result === 'H' ? f.home : f.away
      return `${f.home} v ${f.away} — ${winner.toUpperCase()} WIN`
    })
  } else if (gwFixtures.length > 0) {
    heading = `WELCOME BACK, ${playerName}`
    lines = [
      `GAMEWEEK ${gameweek?.number ?? ''} — PICKS OPEN`,
      'BACK THE LONGSHOT. SCORE BIGGER.',
    ]
  } else {
    heading = `WELCOME, ${playerName}`
    lines = ['AWAITING NEXT FIXTURES']
  }

  return (
    <div className="big-screen">
      <div className="screen-rig">
        <span className="rig-strut rig-strut-left" />
        <span className="rig-strut rig-strut-right" />
        <div className="big-screen-bezel">
          <div className="big-screen-glow" />
          <div className="screen-tag mono">🏟 Matchday Screen</div>
          <div className="big-screen-heading mono">{heading}</div>
          <div className="big-screen-lines">
            {lines.map((l, idx) => (
              <div key={idx} className="big-screen-line">{l}</div>
            ))}
          </div>
          <div className="screen-sponsor mono">Gameweek presented by {SCREEN_SPONSOR}</div>
        </div>
      </div>
    </div>
  )
}
