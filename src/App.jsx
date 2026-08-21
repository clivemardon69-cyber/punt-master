import React, { useState, useEffect, useCallback } from 'react'
import { Trophy, Users, Plus, LogIn, RefreshCw, Stamp, Trash2, UserMinus, ChevronLeft, ChevronDown, Flame, Target, Compass, Award, Check } from 'lucide-react'
import { supabase } from './supabaseClient'
import AdBoard from './AdBoard'
import BigScreen from './BigScreen'

// 2026/27 Premier League — 17 sides who stayed up plus Coventry, Hull City
// and Ipswich Town, promoted up in place of Burnley, West Ham and Wolves.
const TEAMS = [
  "Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Chelsea",
  "Coventry","Crystal Palace","Everton","Fulham","Hull City","Ipswich",
  "Leeds","Liverpool","Man City","Man United","Newcastle","Nott'm Forest",
  "Sunderland","Tottenham"
]

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let c = ""
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)]
  return c
}

function impliedPct(odds) {
  if (!odds || odds <= 1) return 0
  return Math.round((1 / odds) * 100)
}

const LOCK_MINUTES_BEFORE_KICKOFF = 5
const INACTIVE_AFTER_ROUNDS = 8

// A bit of variety on the "Confirm my picks" success message, since
// players will see it every single week — one gets picked at random each
// time rather than showing the same line all season.
const CONFIRM_MESSAGES = [
  gw => `You're in — good luck with Gameweek ${gw}.`,
  gw => `Locked in. Go on, start dreaming about Manager of the Month.`,
  gw => `All set for Gameweek ${gw} — may the odds be with you.`,
  () => `Done and dusted. Let's see what the weekend brings.`,
  () => `Picks confirmed. Somewhere, an underdog is hoping you backed them.`,
  gw => `You're sorted for Gameweek ${gw} — fingers crossed for a few upsets.`,
  () => `Nailed on. Now the hard part — the actual watching.`,
  () => `In the book — go and take that match ball home.`,
]

// Real browser storage — survives new tabs, closing the browser, restarting
// the phone. Per browser/device, same as any "remember me" — a different
// device, or clearing site data, means signing in again. "Switch player"
// clears it on purpose for shared devices.
const STORAGE_KEY = 'puntmaster:player'

function sessionStorageGet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { name: '', team: '', pin: '', code: '', password: '' }
    const p = JSON.parse(raw)
    return { name: p.name || '', team: p.team || '', pin: p.pin || '', code: p.code || '', password: p.password || '' }
  } catch { return { name: '', team: '', pin: '', code: '', password: '' } }
}
function rememberPlayer(n, t, p, c, pw) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: n, team: t || '', pin: p || '', code: c || '', password: pw || '' })) } catch {}
}
function forgetPlayer() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

function isLocked(fixture) {
  if (!fixture) return false
  if (fixture.result) return true
  if (!fixture.kickoff) return false
  return Date.now() >= new Date(fixture.kickoff).getTime() - LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000
}

export default function App() {
  const initialPlayer = sessionStorageGet()
  const [stage, setStage] = useState('landing')
  const [showCreatePanel, setShowCreatePanel] = useState(false)
  const [name, setName] = useState(initialPlayer.name)
  const [team, setTeam] = useState(initialPlayer.team)
  const [password, setPassword] = useState(initialPlayer.password)
  const [adminPin, setAdminPin] = useState(initialPlayer.pin)
  const [renameInput, setRenameInput] = useState('')
  const [joinInput, setJoinInput] = useState('')
  const [newLeagueName, setNewLeagueName] = useState('')
  const [newLeaguePin, setNewLeaguePin] = useState('')
  const [error, setError] = useState('')
  const [confirmMsg, setConfirmMsg] = useState(null) // { ok: bool, text: string } — "Confirm my picks" button result
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)

  const [league, setLeague] = useState(null)
  const [members, setMembers] = useState([])
  const [gameweek, setGameweek] = useState(null)
  const [gameweeks, setGameweeks] = useState([]) // every gameweek, not just the latest — needed to work out which round any given fixture belongs to
  const [fixtures, setFixtures] = useState([])
  const [predictions, setPredictions] = useState([])
  const [tab, setTab] = useState('picks')
  const [standingsView, setStandingsView] = useState('season')
  const [viewedGwNumber, setViewedGwNumber] = useState(null) // null = "current", set once a specific past gameweek is picked
  const [expandedFixtures, setExpandedFixtures] = useState({}) // fixtureId -> bool, "who picked what" names shown on demand
  const [expandedMembers, setExpandedMembers] = useState({}) // memberName -> bool, per-player pick breakdown on the Standings tab
  const [resuming, setResuming] = useState(!!(initialPlayer.name && initialPlayer.code))

  // Auto-resume straight into the league remembered in this browser tab —
  // no "join" click needed for reopening a league you're already in.
  useEffect(() => {
    if (!initialPlayer.code || !initialPlayer.name) return
    let cancelled = false
    ;(async () => {
      const { data: rows, error: err1 } = await supabase.rpc('get_league_by_code', { p_code: initialPlayer.code })
      if (cancelled) return
      const leagueRow = rows && rows[0]
      if (err1 || !leagueRow) { setResuming(false); return }
      setLeague(leagueRow)
      setStage('league')
      setResuming(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function switchPlayer() {
    forgetPlayer()
    setLeague(null)
    setStage('landing')
    setName('')
    setTeam('')
    setPassword('')
    setAdminPin('')
    setError('')
    setLoadError('')
    setViewedGwNumber(null)
    setExpandedFixtures({})
    setShowCreatePanel(false)
  }

  function startNewLeague() {
    forgetPlayer()
    setLeague(null)
    setStage('landing')
    setName('')
    setTeam('')
    setPassword('')
    setAdminPin('')
    setError('')
    setLoadError('')
    setViewedGwNumber(null)
    setExpandedFixtures({})
    setShowCreatePanel(true)
  }

  // ---------- league bootstrap ----------
  async function handleCreateLeague() {
    if (!name.trim() || !newLeagueName.trim()) {
      setError('Enter your name and a league name.')
      return
    }
    if (!password.trim() || password.trim().length < 6) {
      setError('Set a password of at least 6 characters — no email needed, this just gets you back into your own picks on another device.')
      return
    }
    if (!newLeaguePin.trim() || newLeaguePin.trim().length < 6) {
      setError('Set an admin PIN of at least 6 characters (mix letters and numbers if you can) — you\'ll need it to add fixtures and results.')
      return
    }
    setBusy(true)
    const code = genCode()
    const pin = newLeaguePin.trim()
    // Insert only — reads (even the row this just created) go through
    // get_league_by_code(), since leagues has no select policy of its own.
    const { error: err1 } = await supabase
      .from('leagues')
      .insert({ code, name: newLeagueName.trim(), admin_name: name.trim() })
    if (err1) { setError(err1.message); setBusy(false); return }

    const { data: rows, error: err2 } = await supabase.rpc('get_league_by_code', { p_code: code })
    const leagueRow = rows && rows[0]
    if (err2 || !leagueRow) { setError(err2?.message || 'Could not load the new league.'); setBusy(false); return }

    const { error: pinErr } = await supabase.rpc('set_admin_pin', { p_league_id: leagueRow.id, p_pin: pin })
    if (pinErr) { setError(pinErr.message); setBusy(false); return }

    const { error: joinErr } = await supabase.rpc('member_join', {
      p_league_id: leagueRow.id, p_name: name.trim(), p_team: team || null, p_password: password.trim(),
    })
    if (joinErr) { setError(joinErr.message); setBusy(false); return }

    const { error: gwErr } = await supabase.rpc('admin_new_gameweek', { p_league_id: leagueRow.id, p_pin: pin, p_number: 1 })
    if (gwErr) { setError(gwErr.message); setBusy(false); return }

    setAdminPin(pin)
    rememberPlayer(name.trim(), team, pin, code, password.trim())
    setError('')
    setLeague(leagueRow)
    setStage('league')
    setBusy(false)
  }

  async function handleJoinLeague() {
    if (!name.trim() || !joinInput.trim()) {
      setError('Enter your name and a league code.')
      return
    }
    if (!password.trim() || password.trim().length < 6) {
      setError('Enter your password (min 6 characters). First time with this name? This sets it. Returning? This logs you back in.')
      return
    }
    setBusy(true)
    const code = joinInput.trim().toUpperCase()
    const { data: rows, error: err1 } = await supabase.rpc('get_league_by_code', { p_code: code })
    const leagueRow = rows && rows[0]
    if (err1 || !leagueRow) { setError('No league found with that code.'); setBusy(false); return }

    const { error: joinErr } = await supabase.rpc('member_join', {
      p_league_id: leagueRow.id, p_name: name.trim(), p_team: team || null, p_password: password.trim(),
    })
    if (joinErr) { setError(joinErr.message); setBusy(false); return }

    rememberPlayer(name.trim(), team, adminPin, code, password.trim())
    setError('')
    setLeague(leagueRow)
    setStage('league')
    setBusy(false)
  }

  // ---------- data loading ----------
  // Loads every gameweek's fixtures/predictions for the league (not just the
  // current one) so season-long standings and Manager of the Month have the
  // full picture. `gameweek` is still just the latest one, for picks/admin.
  const loadLeagueData = useCallback(async (leagueRow) => {
    if (!leagueRow) return
    const { data: mem, error: memErr } = await supabase.rpc('get_members', { p_league_id: leagueRow.id })
    if (memErr) { setLoadError('Could not load members. ' + memErr.message); return }
    setMembers(mem || [])

    // get_gameweeks() already orders newest-first server-side.
    const { data: gws, error: gwsErr } = await supabase.rpc('get_gameweeks', { p_league_id: leagueRow.id })
    if (gwsErr) { setLoadError('Could not load gameweeks. ' + gwsErr.message); return }
    const currentGw = gws && gws[0]
    setGameweek(currentGw || null)
    setGameweeks(gws || [])

    const gwIds = (gws || []).map(g => g.id)
    if (gwIds.length) {
      const { data: fx, error: fxErr } = await supabase.rpc('get_fixtures', { p_gameweek_ids: gwIds })
      if (fxErr) { setLoadError('Could not load fixtures. ' + fxErr.message); return }
      setFixtures(fx || [])

      const fixtureIds = (fx || []).map(f => f.id)
      if (fixtureIds.length) {
        const { data: preds, error: predsErr } = await supabase.rpc('get_predictions', { p_fixture_ids: fixtureIds })
        if (predsErr) { setLoadError('Could not load predictions. ' + predsErr.message); return }
        setPredictions(preds || [])
      } else {
        setPredictions([])
      }
    } else {
      setFixtures([])
      setPredictions([])
    }
    setLoadError('')
  }, [])

  useEffect(() => { if (league) loadLeagueData(league) }, [league, loadLeagueData])

  async function refresh() { await loadLeagueData(league) }

  // ---------- picks ----------
  async function submitPick(fixtureId, pick) {
    const fixture = fixtures.find(f => f.id === fixtureId)
    if (isLocked(fixture)) return // belt & braces — button should already be disabled
    const { error: pickErr } = await supabase.rpc('submit_prediction', {
      p_league_id: league.id, p_name: name, p_password: password, p_fixture_id: fixtureId, p_pick: pick,
    })
    if (pickErr) { setError(pickErr.message); return }
    setError('')
    setConfirmMsg(null)
    await refresh()
  }

  // ---------- admin ----------
  const [fxHome, setFxHome] = useState('')
  const [fxAway, setFxAway] = useState('')
  const [fxKickoff, setFxKickoff] = useState('')
  const [fxOddsH, setFxOddsH] = useState('')
  const [fxOddsD, setFxOddsD] = useState('')
  const [fxOddsA, setFxOddsA] = useState('')

  async function addFixture() {
    if (!fxHome || !fxAway) { setError('Please pick both teams.'); return }
    if (!fxOddsH || !fxOddsD || !fxOddsA) { setError('Enter all three odds.'); return }
    const oddsValues = [parseFloat(fxOddsH), parseFloat(fxOddsD), parseFloat(fxOddsA)]
    if (oddsValues.some(o => Number.isNaN(o) || o < 1.01 || o > 50)) {
      setError('Odds should each be between 1.01 and 50 — double-check for a stray typo (e.g. 20 instead of 2.0).')
      return
    }
    if (!fxKickoff) { setError('Enter the kick-off date and time.'); return }
    if (!adminPin) { setError('Enter the admin PIN below first.'); return }
    const { error: fxErr } = await supabase.rpc('admin_add_fixture', {
      p_league_id: league.id,
      p_pin: adminPin,
      p_gameweek_id: gameweek.id,
      p_home: fxHome, p_away: fxAway,
      p_kickoff: new Date(fxKickoff).toISOString(),
      p_odds_home: parseFloat(fxOddsH),
      p_odds_draw: parseFloat(fxOddsD),
      p_odds_away: parseFloat(fxOddsA),
    })
    if (fxErr) { setError(fxErr.message); return }
    setFxHome(''); setFxAway('')
    setFxOddsH(''); setFxOddsD(''); setFxOddsA(''); setFxKickoff('')
    setError('')
    rememberPlayer(name.trim(), team, adminPin, league.code, password)
    await refresh()
  }

  async function setResult(fixtureId, result) {
    if (!adminPin) { setError('Enter the admin PIN below first.'); return }
    const { error: resErr } = await supabase.rpc('admin_set_result', {
      p_league_id: league.id, p_pin: adminPin, p_fixture_id: fixtureId, p_result: result,
    })
    if (resErr) { setError(resErr.message); return }
    setError('')
    await refresh()
  }

  async function deleteFixture(fixtureId, label) {
    if (!adminPin) { setError('Enter the admin PIN below first.'); return }
    if (!window.confirm(`Delete ${label}? This also removes everyone's picks for it.`)) return
    const { error: delErr } = await supabase.rpc('admin_delete_fixture', {
      p_league_id: league.id, p_pin: adminPin, p_fixture_id: fixtureId,
    })
    if (delErr) { setError(delErr.message); return }
    setError('')
    await refresh()
  }

  async function removeMember(memberName) {
    if (!adminPin) { setError('Enter the admin PIN below first.'); return }
    if (!window.confirm(`Remove ${memberName} from this league? Their name is freed up and their picks are deleted — this can't be undone.`)) return
    const { error: remErr } = await supabase.rpc('admin_remove_member', {
      p_league_id: league.id, p_pin: adminPin, p_member_name: memberName,
    })
    if (remErr) { setError(remErr.message); return }
    setError('')
    await refresh()
  }

  async function startNewGameweek() {
    if (!adminPin) { setError('Enter the admin PIN below first.'); return }
    const nextNum = (gameweek?.number || 0) + 1
    const { error: gwErr } = await supabase.rpc('admin_new_gameweek', {
      p_league_id: league.id, p_pin: adminPin, p_number: nextNum,
    })
    if (gwErr) { setError(gwErr.message); return }
    setError('')
    await refresh()
  }

  async function renameLeague() {
    if (!adminPin) { setError('Enter the admin PIN below first.'); return }
    if (!renameInput.trim()) { setError('Enter a new league name.'); return }
    const { error: renErr } = await supabase.rpc('admin_rename_league', {
      p_league_id: league.id, p_pin: adminPin, p_name: renameInput.trim(),
    })
    if (renErr) { setError(renErr.message); return }
    setError('')
    setLeague(prev => ({ ...prev, name: renameInput.trim() }))
    setRenameInput('')
  }

  // ---------- activity (never deletes anyone — just a display flag) ----------
  function gwNumberForFixture(fixtureId) {
    const fx = fixtures.find(f => f.id === fixtureId)
    if (!fx) return null
    const gw = gameweeks.find(g => g.id === fx.gameweek_id)
    return gw ? gw.number : null
  }

  // The gameweek number of a member's most recent submitted prediction, or
  // — if they've never submitted one — the gameweek they joined at, so a
  // brand new player gets their own full 8-round grace period instead of
  // being compared against round zero.
  function lastActiveGwNumber(memberRow) {
    const nums = predictions
      .filter(p => p.member_name === memberRow.name)
      .map(p => gwNumberForFixture(p.fixture_id))
      .filter(n => n !== null)
    return nums.length ? Math.max(...nums) : memberRow.joined_gameweek_number
  }

  function isActiveMember(memberRow) {
    const currentGwNumber = gameweek?.number ?? 0
    return currentGwNumber - lastActiveGwNumber(memberRow) < INACTIVE_AFTER_ROUNDS
  }

  // ---------- scoring ----------
  // Pass a fixtureFilter to scope this to e.g. just the current calendar
  // month (Manager of the Month); omit it for full season-long standings.
  function computeStandings(fixtureFilter) {
    const scores = {}
    members.forEach(m => { scores[m.name] = 0 })
    predictions.forEach(p => {
      const fixture = fixtures.find(f => f.id === p.fixture_id)
      if (!fixture || !fixture.result) return
      if (fixtureFilter && !fixtureFilter(fixture)) return
      if (fixture.result === p.pick) {
        const oddsMap = { H: fixture.odds_home, D: fixture.odds_draw, A: fixture.odds_away }
        scores[p.member_name] = (scores[p.member_name] || 0) + Math.round(oddsMap[p.pick] * 10) / 10
      }
    })
    return Object.entries(scores)
      .map(([m, s]) => {
        const memberRow = members.find(mem => mem.name === m)
        return {
          member: m,
          team: memberRow?.team || '',
          active: memberRow ? isActiveMember(memberRow) : true,
          points: Math.round(s * 10) / 10,
        }
      })
      .sort((a, b) => b.points - a.points)
  }

  // Fixture-by-fixture breakdown for one player — same fixtureFilter as
  // whichever standings view (season/month) is currently showing, so the
  // expanded detail always matches the points on screen.
  function memberBreakdown(memberName, fixtureFilter) {
    return predictions
      .filter(p => p.member_name === memberName)
      .map(p => ({ pick: p, fixture: fixtures.find(f => f.id === p.fixture_id) }))
      .filter(x => x.fixture && x.fixture.result && (!fixtureFilter || fixtureFilter(x.fixture)))
      .map(x => {
        const oddsMap = { H: x.fixture.odds_home, D: x.fixture.odds_draw, A: x.fixture.odds_away }
        const correct = x.fixture.result === x.pick.pick
        return { fixture: x.fixture, pick: x.pick.pick, correct, points: correct ? Math.round(oddsMap[x.pick.pick] * 10) / 10 : 0 }
      })
      .sort((a, b) => new Date(b.fixture.kickoff || b.fixture.created_at) - new Date(a.fixture.kickoff || a.fixture.created_at))
  }

  const now = new Date()
  function isThisMonth(fixture) {
    if (!fixture.kickoff) return false
    const d = new Date(fixture.kickoff)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long' })

  // Manager of the Month, but for months that have already finished — a
  // running "hall of fame" underneath the live current-month toggle above.
  // Only lists a month once it has at least one decided fixture, and only
  // months other than the current one (which the toggle already covers).
  function computeMonthlyWinners() {
    const monthKeys = new Set()
    fixtures.forEach(f => {
      if (!f.result) return
      const d = new Date(f.kickoff || f.created_at)
      monthKeys.add(`${d.getFullYear()}-${d.getMonth()}`)
    })
    const currentKey = `${now.getFullYear()}-${now.getMonth()}`
    return Array.from(monthKeys)
      .filter(key => key !== currentKey)
      .sort((a, b) => {
        const [ay, am] = a.split('-').map(Number)
        const [by, bm] = b.split('-').map(Number)
        return (by * 12 + bm) - (ay * 12 + am)
      })
      .map(key => {
        const [y, m] = key.split('-').map(Number)
        const filter = f => {
          const d = new Date(f.kickoff || f.created_at)
          return d.getFullYear() === y && d.getMonth() === m
        }
        const monthStandings = computeStandings(filter)
        const top = monthStandings.length ? monthStandings[0].points : 0
        const winners = monthStandings.filter(s => s.points === top)
        const label = new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
        return { key, label, winners, points: top }
      })
      .filter(mw => mw.points > 0)
  }
  const monthlyWinners = computeMonthlyWinners()

  // "Keeps the match ball" — whoever topped the most recently completed
  // gameweek (not the live one, which usually has no results yet).
  function computeMatchBallWinner() {
    const candidateGws = gameweeks.filter(g => fixtures.some(f => f.gameweek_id === g.id && f.result))
    if (!candidateGws.length) return null
    const latestGw = candidateGws[0] // gameweeks already come back number desc
    const gwStandings = computeStandings(f => f.gameweek_id === latestGw.id)
    const top = gwStandings.length ? gwStandings[0].points : 0
    const winners = gwStandings.filter(s => s.points === top)
    if (!top || !winners.length) return null
    return { gwNumber: latestGw.number, winners, points: top }
  }
  const matchBall = computeMatchBallWinner()

  // Personal form summary — streak, accuracy, and a "risk profile" archetype
  // based on how favoured/unfavoured the player's picks tend to be. All
  // computed client-side from data already loaded — no extra requests,
  // no external AI calls, costs nothing to run.
  function computePlayerForm(playerName) {
    const myAllPicks = predictions.filter(p => p.member_name === playerName)
    const withFixture = myAllPicks
      .map(p => ({ pick: p, fixture: fixtures.find(f => f.id === p.fixture_id) }))
      .filter(x => x.fixture)
    const decided = withFixture.filter(x => x.fixture.result)

    // Streak, grouped by kick-off moment rather than individual fixture.
    // A Saturday afternoon with five simultaneous 3pm kick-offs has no real
    // "which happened first" — so instead of inventing an order, each
    // distinct kick-off time is one block: get everything in that block
    // right and the whole block extends the streak, miss one and the
    // streak stops there. Well-defined with no arbitrary tiebreak needed.
    //
    // Grouped from every pick (not just decided ones) so a slot only ever
    // gets judged once every pick in it has a result — a half-entered
    // slot is left out entirely rather than judged early, so the streak
    // can't quietly drop later once the rest of that slot comes in.
    const groupsByKickoff = {}
    withFixture.forEach(d => {
      const key = d.fixture.kickoff || `no-kickoff-${d.fixture.id}`
      if (!groupsByKickoff[key]) groupsByKickoff[key] = []
      groupsByKickoff[key].push(d)
    })
    const completeGroups = Object.entries(groupsByKickoff)
      .filter(([, group]) => group.every(d => d.fixture.result))
      .sort(([aKey], [bKey]) => new Date(bKey) - new Date(aKey))
      .map(([, group]) => group)

    let streak = 0
    for (const group of completeGroups) {
      const allCorrect = group.every(d => d.fixture.result === d.pick.pick)
      if (allCorrect) streak += group.length
      else break
    }

    const correctCount = decided.filter(d => d.fixture.result === d.pick.pick).length
    const accuracy = decided.length ? Math.round((correctCount / decided.length) * 100) : null

    const oddsValues = myAllPicks
      .map(p => {
        const fixture = fixtures.find(f => f.id === p.fixture_id)
        if (!fixture) return null
        return { H: fixture.odds_home, D: fixture.odds_draw, A: fixture.odds_away }[p.pick]
      })
      .filter(o => o !== null && o !== undefined)

    let profile = null
    if (oddsValues.length >= 3) {
      const avgOdds = oddsValues.reduce((a, b) => a + b, 0) / oddsValues.length
      profile = avgOdds < 2.2 ? 'The Favourite Backer' : avgOdds > 4 ? 'The Underdog Hunter' : 'The Balanced Picker'
    }

    return { streak, decidedCount: decided.length, accuracy, profile }
  }
  const myForm = computePlayerForm(name)

  // ---------- render: resuming ----------
  if (resuming) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mono" style={{ color: 'var(--muted)', fontSize: 13, letterSpacing: 1 }}>Reopening your league…</div>
      </div>
    )
  }

  // ---------- render: landing ----------
  if (stage === 'landing') {
    return (
      <>
      <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div className="mono" style={{ color: 'var(--gold)', fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}>
              <Stamp size={14} /> Coupon No. 26/27
            </div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 900, fontSize: 40, lineHeight: 1, margin: 0 }}>
              PUNT MASTER
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 12, lineHeight: 1.5 }}>
              Pick winners. Back the underdog, score bigger.
            </p>
            <p className="mono" style={{ color: 'var(--muted2)', fontSize: 10, marginTop: 8, letterSpacing: 0.5 }}>
              100% free to play — no money, no purchase, no prizes. Just bragging rights.
            </p>
            <p className="mono" style={{ color: 'var(--muted2)', fontSize: 10, marginTop: 4, letterSpacing: 0.5 }}>
              Punt Master is not affiliated with the Premier League or any football club.
            </p>
            <details style={{ marginTop: 16, textAlign: 'left' }}>
              <summary className="mono" style={{ cursor: 'pointer', color: 'var(--gold)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
                New here? How it works
              </summary>
              <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.6, marginTop: 10 }}>
                Each gameweek, pick Home, Draw, or Away for every match. Get it right and
                you score points equal to that match's odds — so a shock upset pays off far
                more than an obvious favourite. Get it wrong and you score nothing for that
                match. Add up your points across the season to climb the table.
              </p>
            </details>
          </div>

          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 20 }}>
            <label className="mono" style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>League code</label>
            <input value={joinInput} onChange={e => setJoinInput(e.target.value.toUpperCase())} placeholder="e.g. B7K2M" style={{ marginBottom: 16, letterSpacing: 2 }} />

            <label className="mono" style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Clive" style={{ marginBottom: 16 }} />

            <label className="mono" style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" style={{ marginBottom: 6 }} />
            <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.4, marginBottom: 16 }}>
              First time with this name in this league? This sets your password (min 6 characters, no reset if forgotten). Already got an account? This logs you straight in.
            </p>

            <button className="btn-gold" style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }} onClick={handleJoinLeague} disabled={busy}>
              <LogIn size={16} /> VIEW LEAGUE
            </button>

            {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 12 }}>{error}</p>}

            <details open={showCreatePanel} onToggle={e => setShowCreatePanel(e.target.open)} style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <summary className="mono" style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                New here? Create a league instead
              </summary>
              <div style={{ marginTop: 14 }}>
                <label className="mono" style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Who do you support? (optional)</label>
                <select value={team} onChange={e => setTeam(e.target.value)} style={{ marginBottom: 16 }}>
                  <option value="">— No particular team —</option>
                  {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label className="mono" style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>League name</label>
                <input value={newLeagueName} onChange={e => setNewLeagueName(e.target.value)} placeholder="League name" style={{ marginBottom: 8 }} />
                <input type="password" value={newLeaguePin} onChange={e => setNewLeaguePin(e.target.value)} placeholder="Set an admin PIN (min 6 characters)" style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.4, marginBottom: 12 }}>
                  Uses the name and password entered above for your own player account in the new league.
                </p>
                <button className="btn-outline" style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }} onClick={handleCreateLeague} disabled={busy}>
                  <Plus size={16} /> CREATE LEAGUE
                </button>
              </div>
            </details>
          </div>

          <p style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 10, marginTop: 16, lineHeight: 1.5 }}>
            Private by default. Only people with your league code can join.
          </p>
        </div>
      </div>
      <AdBoard />
      </>
    )
  }

  // ---------- render: league ----------
  // Kick-off order, not the order fixtures were added in — so a fixture
  // added later (like a missed one being backfilled) slots in where it
  // actually belongs rather than always landing at the bottom. Ties (same
  // kick-off time) fall back to the order they were added, since sort is
  // stable and fixtures already arrive ordered that way from the database.
  function sortByKickoff(fxList) {
    return fxList.slice().sort((a, b) => {
      if (!a.kickoff) return 1
      if (!b.kickoff) return -1
      return new Date(a.kickoff) - new Date(b.kickoff)
    })
  }
  const currentFixtures = sortByKickoff(fixtures.filter(f => f.gameweek_id === gameweek?.id))

  // Has this member picked every fixture in the live current gameweek?
  // Positive-only signal on the Members list — a quiet tick when done,
  // nothing at all when not, rather than calling anyone out.
  function hasCompletedPicks(memberName) {
    if (!currentFixtures.length) return false
    return currentFixtures.every(f => predictions.some(p => p.fixture_id === f.id && p.member_name === memberName))
  }

  // Which gameweek the Gameweek tab is showing — defaults to the current
  // one, but a player can look back at any past round, Super 6-style.
  const viewedGw = viewedGwNumber === null ? gameweek : (gameweeks.find(g => g.number === viewedGwNumber) || gameweek)
  const viewedFixtures = sortByKickoff(fixtures.filter(f => f.gameweek_id === viewedGw?.id))
  const predictionsFor = (fixtureId) => predictions.filter(p => p.fixture_id === fixtureId)
  const gameweekPoints = viewedGw ? computeStandings(f => f.gameweek_id === viewedGw.id) : []

  const seasonStandings = computeStandings()
  const monthStandings = computeStandings(isThisMonth)
  const standings = standingsView === 'month' ? monthStandings : seasonStandings
  const myPicks = predictions.filter(p => p.member_name === name)
  const pickFor = (fixtureId) => myPicks.find(p => p.fixture_id === fixtureId)?.pick

  // Every pick already saves the instant it's clicked — this button
  // doesn't do any saving itself, it just gives a clear, deliberate
  // "yes, they're really in" confirmation, and names exactly what's
  // still missing if anything is, rather than a vague reassurance.
  function confirmPicks() {
    const missing = viewedFixtures.filter(f => !f.result && !pickFor(f.id))
    if (missing.length === 0) {
      const line = CONFIRM_MESSAGES[Math.floor(Math.random() * CONFIRM_MESSAGES.length)](viewedGw?.number)
      setConfirmMsg({ ok: true, text: line })
    } else {
      setConfirmMsg({ ok: false, text: `Still missing a pick for: ${missing.map(f => `${f.home} v ${f.away}`).join(', ')}` })
    }
  }
  const isAdmin = name.trim() === league.admin_name
  const visibleTabs = isAdmin ? ['picks', 'table', 'admin'] : ['picks', 'table']

  return (
    <>
    <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
      <div style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)', padding: '16px 20px', position: 'sticky', top: 0 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => { setTab('picks'); setViewedGwNumber(null) }}
            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Back to the current gameweek"
          >
            <ChevronLeft size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>League</div>
              <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--text)', textDecoration: 'underline', textDecorationColor: 'var(--muted2)', textUnderlineOffset: 3 }}>{league.name}</div>
            </div>
          </button>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Code</div>
            <div className="mono" style={{ fontWeight: 700, color: 'var(--gold)', letterSpacing: 2 }}>{league.code}</div>
          </div>
          <button onClick={refresh} style={{ background: 'none', border: 'none', color: 'var(--muted)', marginLeft: 12 }}><RefreshCw size={16} /></button>
        </div>
        <div style={{ maxWidth: 480, margin: '4px auto 0', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
          <button onClick={switchPlayer} className="mono" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0 }} title="Sign out / switch player">
            Not {name}? Sign out
          </button>
          <button onClick={startNewLeague} className="mono" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0 }}>
            · New league
          </button>
        </div>
      </div>

      {loadError && (
        <div style={{ maxWidth: 480, margin: '16px auto 0', padding: '0 20px' }}>
          <div style={{ background: 'rgba(224,120,86,0.12)', border: '1px solid var(--red)', borderRadius: 3, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--red)', fontSize: 12 }}>{loadError}</span>
            <button onClick={refresh} style={{ flexShrink: 0, background: 'var(--red)', color: 'var(--bg)', border: 'none', borderRadius: 3, padding: '6px 12px', fontSize: 12, fontWeight: 700 }}>Retry</button>
          </div>
        </div>
      )}

      <div style={{ paddingTop: 16 }}>
        <BigScreen name={name} fixtures={fixtures} gameweek={gameweek} />
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 4 }}>
          {visibleTabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
              borderRadius: 3, border: 'none', background: tab === t ? 'var(--gold)' : 'transparent',
              color: tab === t ? 'var(--bg)' : 'var(--muted)'
            }}>
              {t === 'picks' ? 'Gameweek' : t === 'table' ? 'Standings' : 'Admin'}
            </button>
          ))}
        </div>

        {tab === 'picks' && (
          <>
          {error && <p style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</p>}

          {[myForm.streak >= 2, myForm.accuracy !== null, !!myForm.profile].filter(Boolean).length >= 2 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
              background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px'
            }}>
              {myForm.streak >= 2 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--gold)' }}>
                  <Flame size={13} /> {myForm.streak}-pick streak
                </span>
              )}
              {myForm.accuracy !== null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--data)' }}>
                  <Target size={13} /> {myForm.accuracy}% accuracy
                </span>
              )}
              {myForm.profile && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                  <Compass size={13} /> {myForm.profile}
                </span>
              )}
            </div>
          )}

          {gameweeks.length > 0 && (
            <select
              value={viewedGw?.number ?? ''}
              onChange={e => {
                const n = Number(e.target.value)
                setViewedGwNumber(n === gameweek?.number ? null : n)
                setConfirmMsg(null)
              }}
              style={{ marginBottom: 16 }}
            >
              {gameweeks.map(g => (
                <option key={g.id} value={g.number}>
                  Gameweek {g.number}{g.id === gameweek?.id ? ' (current)' : ''}
                </option>
              ))}
            </select>
          )}

          {viewedFixtures.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
              No fixtures loaded yet.<br/>Ask your league admin to add this gameweek's matches.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {viewedFixtures.map((f, i) => {
                const pick = pickFor(f.id)
                const locked = isLocked(f)
                return (
                  <div key={f.id} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span className="mono" style={{ color: 'var(--muted2)', fontSize: 12 }}>{String(i + 1).padStart(2, '0')}</span>
                      {f.result ? (
                        <span className="mono" style={{ fontSize: 10, background: 'var(--border)', padding: '2px 8px', borderRadius: 3 }}>
                          FT: {f.result === 'H' ? f.home : f.result === 'A' ? f.away : 'Draw'}
                        </span>
                      ) : locked ? (
                        <span className="mono" style={{ fontSize: 10, background: 'var(--red)', color: 'var(--bg)', padding: '2px 8px', borderRadius: 3 }}>LOCKED</span>
                      ) : f.kickoff ? (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--muted2)' }}>
                          KO {new Date(f.kickoff).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{f.home} <span style={{ color: 'var(--muted2)', fontWeight: 400 }}>v</span> {f.away}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[{ key: 'H', label: f.home, odds: f.odds_home }, { key: 'D', label: 'Draw', odds: f.odds_draw }, { key: 'A', label: f.away, odds: f.odds_away }].map(opt => (
                        <button key={opt.key} disabled={locked} onClick={() => submitPick(f.id, opt.key)} style={{
                          padding: '8px 4px', textAlign: 'center', borderRadius: 3,
                          border: `1px solid ${pick === opt.key ? 'var(--gold)' : 'var(--border)'}`,
                          background: pick === opt.key ? 'var(--gold)' : 'var(--bg)',
                          color: pick === opt.key ? 'var(--bg)' : 'var(--text)', opacity: locked ? 0.6 : 1
                        }}>
                          <div style={{ fontSize: 10, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</div>
                          <div className="mono" style={{ fontWeight: 700, fontSize: 15, color: pick === opt.key ? 'var(--bg)' : 'var(--data)' }}>{opt.odds}</div>
                          <div style={{ fontSize: 9, opacity: 0.7 }}>{impliedPct(opt.odds)}%</div>
                        </button>
                      ))}
                    </div>

                    {locked && (() => {
                      const preds = predictionsFor(f.id)
                      const total = preds.length
                      const counts = { H: 0, D: 0, A: 0 }
                      const namesByPick = { H: [], D: [], A: [] }
                      preds.forEach(p => {
                        if (counts[p.pick] === undefined) return
                        counts[p.pick]++
                        namesByPick[p.pick].push(p.member_name)
                      })
                      const expanded = !!expandedFixtures[f.id]
                      return (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                          {total === 0 ? (
                            <span style={{ fontSize: 11, color: 'var(--muted2)' }}>No picks made.</span>
                          ) : (
                            <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                              {[{ key: 'H', label: f.home }, { key: 'D', label: 'Draw' }, { key: 'A', label: f.away }].map(opt => {
                                const pct = Math.round((counts[opt.key] / total) * 100)
                                const isResult = f.result === opt.key
                                return (
                                  <div key={opt.key} style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</div>
                                    <div className="mono" style={{ fontWeight: 700, fontSize: 13, color: isResult ? 'var(--gold)' : 'var(--muted)' }}>{pct}%</div>
                                    {expanded && (
                                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {namesByPick[opt.key].length === 0 ? (
                                          <span style={{ fontSize: 9, color: 'var(--muted2)' }}>—</span>
                                        ) : namesByPick[opt.key].map(n => (
                                          <span key={n} style={{ fontSize: 9, color: isResult ? 'var(--gold)' : 'var(--muted)' }}>{n}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                            <button
                              onClick={() => setExpandedFixtures(prev => ({ ...prev, [f.id]: !prev[f.id] }))}
                              className="mono"
                              style={{ background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0, marginTop: 8 }}
                            >
                              {expanded ? 'Hide who picked what' : 'Show who picked what'}
                            </button>
                            </>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          )}

          {viewedFixtures.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={confirmPicks}
                className="btn-outline"
                style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}
              >
                Confirm my picks
              </button>
              {confirmMsg && (
                <p style={{ fontSize: 12, marginTop: 10, color: confirmMsg.ok ? 'var(--data)' : 'var(--red)' }}>
                  {confirmMsg.text}
                </p>
              )}
            </div>
          )}

          {viewedGw && gameweekPoints.some(s => s.points > 0) && (
            <div style={{ marginTop: 20, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                Gameweek {viewedGw.number} points
              </div>
              {gameweekPoints.map((s, i) => (
                <div key={s.member} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '10px 16px',
                  borderBottom: i !== gameweekPoints.length - 1 ? '1px solid var(--border)' : 'none'
                }}>
                  <span style={{ fontWeight: i === 0 ? 700 : 400, color: i === 0 ? 'var(--gold)' : 'var(--text)' }}>{s.member}</span>
                  <span className="mono" style={{ fontWeight: 700, color: i === 0 ? 'var(--gold)' : 'var(--data)' }}>{s.points}</span>
                </div>
              ))}
            </div>
          )}
          </>
        )}

        {tab === 'table' && (
          <div>
            {matchBall && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--gold)' }}>
                <Award size={15} style={{ flexShrink: 0 }} />
                <span>
                  {matchBall.winners.map(w => w.member).join(' & ')} {matchBall.winners.length > 1 ? 'take' : 'takes'} the match ball home
                  — top of Gameweek {matchBall.gwNumber} ({matchBall.points} pts)
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 4 }}>
              {[{ key: 'season', label: 'Season' }, { key: 'month', label: `${monthLabel} (Manager of the Month)` }].map(v => (
                <button key={v.key} onClick={() => setStandingsView(v.key)} style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                  borderRadius: 3, border: 'none', background: standingsView === v.key ? 'var(--gold)' : 'transparent',
                  color: standingsView === v.key ? 'var(--bg)' : 'var(--muted)'
                }}>
                  {v.label}
                </button>
              ))}
            </div>

            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              {standings.length === 0 || standings.every(s => s.points === 0) ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14 }}>
                  {standingsView === 'month' ? `No results in ${monthLabel} yet.` : 'No results yet.'}
                </div>
              ) : standings.map((s, i) => {
                const expanded = !!expandedMembers[s.member]
                const breakdown = expanded ? memberBreakdown(s.member, standingsView === 'month' ? isThisMonth : null) : []
                // Alternating band per player (not per row) so a long scroll
                // through several people's expanded picks still makes it
                // obvious where one player's block ends and the next
                // starts — rank 1 keeps its own gold tint regardless.
                const bandBg = i === 0 ? 'rgba(201,162,39,0.1)' : (i % 2 === 1 ? 'rgba(255,255,255,0.025)' : 'transparent')
                return (
                  <div key={s.member} style={{ borderBottom: i !== standings.length - 1 ? '1px solid var(--border)' : 'none', background: bandBg }}>
                    <div
                      onClick={() => setExpandedMembers(prev => ({ ...prev, [s.member]: !prev[s.member] }))}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="mono" style={{ width: 20, fontSize: 12, color: i === 0 ? 'var(--gold)' : 'var(--muted2)' }}>{i + 1}</span>
                        <span>
                          <span style={{ fontWeight: 700, color: i === 0 ? 'var(--gold)' : 'var(--text)' }}>{s.member}</span>
                          {s.team && <span style={{ fontSize: 11, color: 'var(--muted2)', marginLeft: 6 }}>· {s.team}</span>}
                          {!s.active && <span className="mono" style={{ fontSize: 9, color: 'var(--muted2)', marginLeft: 6, textTransform: 'uppercase' }}>· inactive</span>}
                        </span>
                        {i === 0 && <Trophy size={13} color="var(--gold)" />}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono" style={{ fontWeight: 700, fontSize: 15, color: i === 0 ? 'var(--gold)' : 'var(--data)' }}>{s.points}</span>
                        <ChevronDown size={14} style={{ color: 'var(--muted2)', transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ padding: '0 16px 12px', background: 'rgba(0,0,0,0.15)' }}>
                        {breakdown.length === 0 ? (
                          <p style={{ fontSize: 11, color: 'var(--muted2)', padding: '8px 0' }}>No results yet.</p>
                        ) : breakdown.map(b => (
                          <div key={b.fixture.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                            <span style={{ color: 'var(--muted)' }}>{b.fixture.home} v {b.fixture.away}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="mono" style={{ color: b.correct ? 'var(--gold)' : 'var(--muted2)' }}>
                                {b.pick === 'H' ? b.fixture.home : b.pick === 'A' ? b.fixture.away : 'Draw'}
                              </span>
                              <span className="mono" style={{ fontWeight: 700, minWidth: 32, textAlign: 'right', color: b.correct ? 'var(--data)' : 'var(--muted2)' }}>
                                {b.correct ? `+${b.points}` : '0'}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 12 }}>
              <Users size={13} /> {members.filter(isActiveMember).length} active of {members.length} member{members.length !== 1 ? 's' : ''}
            </div>

            {members.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Members</div>
                <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  {members.map((m, i) => (
                    <div key={m.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', fontSize: 13,
                      borderBottom: i !== members.length - 1 ? '1px solid var(--border)' : 'none'
                    }}>
                      <span>{m.name}{m.team && <span style={{ fontSize: 11, color: 'var(--muted2)', marginLeft: 6 }}>· {m.team}</span>}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {hasCompletedPicks(m.name) && <Check size={14} color="var(--data)" title="Picks in for this gameweek" />}
                        {!isActiveMember(m) && <span className="mono" style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase' }}>inactive</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 6 }}>
                  A tick means their picks are in for this gameweek — picks themselves stay hidden until each match kicks off.
                </p>
              </div>
            )}

            {monthlyWinners.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Manager of the month — past winners</div>
                <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  {monthlyWinners.map((mw, i) => (
                    <div key={mw.key} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', fontSize: 13,
                      borderBottom: i !== monthlyWinners.length - 1 ? '1px solid var(--border)' : 'none'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Award size={14} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--muted)' }}>{mw.label}</span>
                      </span>
                      <span>
                        <span style={{ fontWeight: 700 }}>{mw.winners.map(w => w.member).join(' & ')}</span>
                        <span className="mono" style={{ color: 'var(--data)', marginLeft: 8 }}>{mw.points} pts</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'admin' && isAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
              <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Admin PIN</div>
              <input
                type="password"
                value={adminPin}
                onChange={e => { setAdminPin(e.target.value); rememberPlayer(name.trim(), team, e.target.value, league.code, password) }}
                placeholder="Enter admin PIN to unlock actions below"
              />
              <p style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 6 }}>
                Checked by the database on every fixture, result, and gameweek change — not just this screen.
              </p>
            </div>

            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
              <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>League name</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={renameInput}
                  onChange={e => setRenameInput(e.target.value)}
                  placeholder={league.name}
                  style={{ flex: 1 }}
                />
                <button onClick={renameLeague} style={{ fontSize: 12, background: 'var(--border)', border: 'none', color: 'var(--text)', padding: '0 16px', borderRadius: 3, flexShrink: 0 }}>Rename</button>
              </div>
            </div>

            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
              <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Gameweek</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Current: <b>{gameweek?.number ?? '—'}</b></span>
                <button onClick={startNewGameweek} style={{ marginLeft: 'auto', fontSize: 12, background: 'var(--border)', border: 'none', color: 'var(--text)', padding: '6px 12px', borderRadius: 3 }}>New Gameweek →</button>
              </div>
            </div>

            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
              <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>Add fixture</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <select value={fxHome} onChange={e => setFxHome(e.target.value)}>
                  <option value="">Please pick a team</option>
                  {TEAMS.map(t => <option key={t}>{t}</option>)}
                </select>
                <select value={fxAway} onChange={e => setFxAway(e.target.value)}>
                  <option value="">Please pick a team</option>
                  {TEAMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <label className="mono" style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Kick-off (picks lock 5 mins before this)</label>
              <input type="datetime-local" value={fxKickoff} onChange={e => setFxKickoff(e.target.value)} style={{ marginBottom: 12 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <input value={fxOddsH} onChange={e => setFxOddsH(e.target.value)} placeholder="Home odds" />
                <input value={fxOddsD} onChange={e => setFxOddsD(e.target.value)} placeholder="Draw odds" />
                <input value={fxOddsA} onChange={e => setFxOddsA(e.target.value)} placeholder="Away odds" />
              </div>
              <button className="btn-gold" style={{ width: '100%' }} onClick={addFixture}>Add fixture</button>
              {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            </div>

            {currentFixtures.length > 0 && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
                <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>Enter results</div>
                {currentFixtures.map(f => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{f.home} v {f.away}</span>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                      {['H', 'D', 'A'].map(r => (
                        <button key={r} onClick={() => setResult(f.id, r)} style={{
                          width: 28, height: 28, borderRadius: 3, fontWeight: 700, fontSize: 12,
                          border: f.result === r ? 'none' : '1px solid var(--border)',
                          background: f.result === r ? 'var(--gold)' : 'var(--bg)',
                          color: f.result === r ? 'var(--bg)' : 'var(--text)'
                        }}>{r}</button>
                      ))}
                      {f.result && (
                        <button onClick={() => setResult(f.id, null)} title="Clear result — reopens picks for players" style={{
                          width: 28, height: 28, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg)',
                          color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12
                        }}>✕</button>
                      )}
                      <button onClick={() => deleteFixture(f.id, `${f.home} v ${f.away}`)} title="Delete fixture" style={{
                        width: 28, height: 28, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg)',
                        color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4
                      }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
              <div className="mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>Members</div>
              {members.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>No members yet.</p>
              ) : members.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
                  <span>{m.name}{m.team && <span style={{ fontSize: 11, color: 'var(--muted2)', marginLeft: 6 }}>· {m.team}</span>}</span>
                  {m.name !== league.admin_name && (
                    <button onClick={() => removeMember(m.name)} title="Remove member" style={{
                      width: 28, height: 28, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg)',
                      color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}><UserMinus size={13} /></button>
                  )}
                </div>
              ))}
              <p style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 10 }}>
                Removing someone frees up their name and deletes their picks — for fixing mistakes (wrong person, duplicate name), not for pruning quiet players.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
    <AdBoard />
    </>
  )
}
