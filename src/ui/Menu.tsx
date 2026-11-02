import { useState } from 'react'

/** Title / start screen: pass-and-play or network play with a room code. */
export function Menu({
  onStart,
  onHost,
  onJoin,
  net,
}: {
  onStart: () => void
  onHost: () => void
  onJoin: (code: string) => void
  net: { phase: string; code: string | null; error: string | null }
}) {
  const [mode, setMode] = useState<'main' | 'join'>('main')
  const [code, setCode] = useState('')

  const bigBtn =
    'min-h-[56px] w-full max-w-xs rounded-2xl px-8 text-lg font-semibold text-white shadow-lg transition-colors active:scale-[0.98]'

  // Waiting for the peer to join: show the code big.
  if (net.phase === 'waiting' && net.code) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0d12] px-6 text-center">
        <p className="text-sm uppercase tracking-widest text-gray-400">Room code</p>
        <p
          className="mt-2 text-6xl font-bold tracking-[0.35em] text-emerald-400"
          aria-label={`Room code ${net.code}`}
        >
          {net.code}
        </p>
        <p className="mt-6 max-w-xs text-base text-gray-400">
          Share this code. The game starts the moment your friend joins.
        </p>
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500" aria-live="polite">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          Waiting for opponent…
        </div>
      </div>
    )
  }

  if (mode === 'join') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0d12] px-6 text-center">
        <h2 className="text-2xl font-bold text-white">Join a game</h2>
        <p className="mt-2 text-sm text-gray-400">Enter the 4-character room code.</p>
        <input
          value={code}
          onChange={(e) =>
            setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4))
          }
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABCD"
          aria-label="Room code"
          className="mt-6 w-48 rounded-2xl bg-white/10 px-4 py-4 text-center text-4xl font-bold tracking-[0.3em] text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {net.error ? <p className="mt-3 text-sm text-red-400">{errorText(net.error)}</p> : null}
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
          <button
            type="button"
            disabled={code.length !== 4}
            onClick={() => onJoin(code)}
            className={`${bigBtn} bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40`}
          >
            Join
          </button>
          <button
            type="button"
            onClick={() => setMode('main')}
            className="min-h-[44px] text-base text-gray-400 hover:text-gray-200"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0d12] px-6 text-center">
      <div className="flex flex-col items-center gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Battleground Chess
          </h1>
          <p className="mt-3 text-base text-gray-400">
            Two-player 3D chess — one board or two phones.
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">
          <button
            type="button"
            onClick={onStart}
            className={`${bigBtn} bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700`}
          >
            Same Device
          </button>
          <button
            type="button"
            onClick={onHost}
            className={`${bigBtn} bg-sky-700 hover:bg-sky-600 active:bg-sky-800`}
          >
            Play a Friend
          </button>
          {net.phase === 'joining' ? (
            <p className="text-sm text-gray-400" aria-live="polite">
              Joining…
            </p>
          ) : null}
          {net.error && net.phase === 'error' ? (
            <p className="text-sm text-red-400">{errorText(net.error)}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setMode('join')}
            className="min-h-[44px] text-base text-gray-400 hover:text-gray-200"
          >
            Join with a code
          </button>
        </div>

        <p className="text-xs text-gray-600">
          Ancient Warfare 3D Chess &middot; Burbank Enterprises
        </p>
      </div>
    </div>
  )
}

function errorText(reason: string): string {
  switch (reason) {
    case 'no-such-room':
      return 'No game found with that code.'
    case 'room-full':
      return 'That game already has two players.'
    case 'not-in-room':
      return 'That game has ended.'
    default:
      return 'Connection problem — try again.'
  }
}
