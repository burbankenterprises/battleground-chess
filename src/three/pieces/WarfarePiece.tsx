import { useEffect, useMemo } from 'react'
import type { Color, PieceSymbol } from 'chess.js'
import { disposeWarfarePiece } from './models'
import { buildMergedWarfarePiece } from './mergedModel'

type PieceProps = { type: PieceSymbol; color: Color }

/**
 * One procedural ancient-warfare piece. Same props as the Phase 1–4 piece, so
 * PieceActor's promotion swap is unchanged.
 *
 * Phase 5: renders the MERGED model (mergedModel.ts) — the authored models.ts
 * piece baked into one mesh, so a piece is one draw call (and one shadow-pass
 * draw) instead of one per part. The model is rebuilt only when type/color
 * change and always comes with its own fresh material: PieceActor's applyTint
 * mutates emissive per actor, so no two actors (or the pre-swap and current
 * slots of one actor) ever share a material. The mesh is raycast-disabled, so
 * taps pass straight through to the board tile.
 */
export function WarfarePiece({ type, color }: PieceProps) {
  const model = useMemo(() => buildMergedWarfarePiece(type, color), [type, color])

  // R3F never disposes <primitive> objects, so release this model's own
  // material when it is replaced or unmounted (the merged geometry is shared and kept).
  useEffect(() => () => disposeWarfarePiece(model), [model])

  return <primitive object={model} />
}
