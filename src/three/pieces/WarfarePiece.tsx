import { useEffect, useMemo } from 'react'
import type { Color, PieceSymbol } from 'chess.js'
import { buildWarfarePiece, disposeWarfarePiece } from './models'

type PieceProps = { type: PieceSymbol; color: Color }

/**
 * One procedural ancient-warfare piece (see models.ts). Same props as the
 * Phase 1–3 placeholder, so PieceActor's promotion swap is unchanged.
 *
 * The model is rebuilt only when type/color change and always comes with its
 * own materials: PieceActor's applyTint mutates emissive per actor, so no two
 * actors (or the pre-swap and current slots of one actor) may share a
 * material. Every mesh is raycast-disabled inside models.ts, so taps pass
 * straight through to the board tile.
 */
export function WarfarePiece({ type, color }: PieceProps) {
  const model = useMemo(() => buildWarfarePiece(type, color), [type, color])

  // R3F never disposes <primitive> objects, so release this model's own
  // materials when it is replaced or unmounted (geometries are shared and kept).
  useEffect(() => () => disposeWarfarePiece(model), [model])

  return <primitive object={model} />
}
