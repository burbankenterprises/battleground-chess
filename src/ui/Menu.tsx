/** Title / start screen. Minimal by design — polish is Phase 5. */
export function Menu({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0d12] px-6 text-center">
      <div className="flex flex-col items-center gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Battleground Chess
          </h1>
          <p className="mt-3 text-base text-gray-400">
            Two-player pass-and-play chess in 3D.
          </p>
        </div>

        <button
          type="button"
          onClick={onStart}
          className="min-h-[56px] w-full max-w-xs rounded-2xl bg-emerald-600 px-8 text-lg font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500 active:bg-emerald-700"
        >
          New Game
        </button>

        <p className="text-xs text-gray-600">
          Ancient Warfare 3D Chess &middot; Burbank Enterprises
        </p>
      </div>
    </div>
  )
}
