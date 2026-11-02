import { useEffect, useState } from 'react'
import { Scene } from './three/Scene'
import { HUD } from './ui/HUD'
import { Menu } from './ui/Menu'
import { PromotionPicker } from './ui/PromotionPicker'
import { useGameStore } from './game/store'
import { useGameSounds } from './audio/useGameSounds'
import { useNetPlay } from './net/useNetPlay'

type Screen = 'menu' | 'game'

function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const newGame = useGameStore((s) => s.newGame)
  const netMode = useGameStore((s) => s.netMode)
  const myColor = useGameStore((s) => s.myColor)
  // Sound wiring lives at the root: the menu's first tap already unlocks audio.
  useGameSounds()
  const { net, hostRoom, joinRoom, leaveRoom } = useNetPlay()

  const startGame = () => {
    newGame()
    setScreen('game')
  }

  // Pairing (or resume) flips us into the game screen once the store is in net mode.
  useEffect(() => {
    if (net.phase === 'paired' && netMode === 'net') setScreen('game')
  }, [net.phase, netMode])

  if (screen === 'menu') {
    return (
      <Menu
        onStart={startGame}
        onHost={() => hostRoom()}
        onJoin={(code) => joinRoom(code)}
        net={{ phase: net.phase, code: net.code, error: net.error }}
      />
    )
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#0b0d12]">
      <Scene />
      <HUD />
      <PromotionPicker />
      {netMode === 'net' ? <NetBadge online={net.peerOnline} color={myColor} /> : null}
      {netMode === 'net' ? (
        <button
          type="button"
          onClick={() => {
            leaveRoom()
            useGameStore.getState().endNetGame()
            newGame()
            setScreen('menu')
          }}
          className="absolute left-3 top-3 z-20 min-h-[44px] rounded-xl bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur hover:bg-white/20"
        >
          Leave
        </button>
      ) : null}
    </div>
  )
}

/** Small always-visible status: your color + peer connection. */
function NetBadge({ online, color }: { online: boolean; color: 'w' | 'b' | null }) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 rounded-xl bg-black/40 px-3 py-2 text-sm text-white backdrop-blur">
      <span className="font-semibold">
        {color === 'b' ? 'Black' : color === 'w' ? 'White' : ''}
      </span>
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`}
        title={online ? 'Opponent connected' : 'Opponent offline'}
      />
    </div>
  )
}

export default App
