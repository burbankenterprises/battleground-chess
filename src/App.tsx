import { useState } from 'react'
import { Scene } from './three/Scene'
import { HUD } from './ui/HUD'
import { Menu } from './ui/Menu'
import { PromotionPicker } from './ui/PromotionPicker'
import { useGameStore } from './game/store'
import { useGameSounds } from './audio/useGameSounds'

type Screen = 'menu' | 'game'

function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const newGame = useGameStore((s) => s.newGame)
  // Sound wiring lives at the root: the menu's first tap already unlocks audio.
  useGameSounds()

  const startGame = () => {
    newGame()
    setScreen('game')
  }

  if (screen === 'menu') {
    return <Menu onStart={startGame} />
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#0b0d12]">
      <Scene />
      <HUD />
      <PromotionPicker />
    </div>
  )
}

export default App
