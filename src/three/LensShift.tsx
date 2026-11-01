import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import { BOARD_CLEARANCE_PX, HUD_BOTTOM_RESERVE_PX } from '../ui/layout'
import { lensShiftPx } from './framing'

/**
 * Lifts the rendered image just enough that the board's near edge (from the
 * default camera) clears the HUD's bottom control bar — an off-axis lens
 * shift (setViewOffset). Camera position, OrbitControls and the auto-flip are
 * untouched, and taps stay exact (the raycaster unprojects through the same
 * shifted projection).
 */
export function LensShift() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    const shift = lensShiftPx(height, HUD_BOTTOM_RESERVE_PX, BOARD_CLEARANCE_PX)
    if (shift > 0) camera.setViewOffset(width, height, 0, shift, width, height)
    else camera.clearViewOffset()
    return () => camera.clearViewOffset()
  }, [camera, width, height])

  return null
}
