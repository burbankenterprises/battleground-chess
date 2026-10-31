import type { Square } from 'chess.js'

/** Board tile size in world units (spec: tile size 1, board centered at origin). */
export const TILE = 1

const FILES = 'abcdefgh'

/**
 * Map an algebraic square (e.g. "e1") to its tile-center [x, z] in world space.
 * Board is centered at the origin: files a..h → x -3.5..+3.5,
 * ranks 1..8 → z +3.5..-3.5 (rank 1 nearest the default/white camera).
 */
export function squareToXZ(square: Square): [number, number] {
  const file = FILES.indexOf(square[0]) // 0..7
  const rank = Number(square[1]) - 1 // 0..7
  return [file - 3.5, 3.5 - rank]
}

/** Build an algebraic square from 0-based file/rank indices. */
export function fileRankToSquare(file: number, rank: number): Square {
  return `${FILES[file]}${rank + 1}` as Square
}

export type TileLayout = {
  square: Square
  x: number
  z: number
  /** true for light-colored squares (a1 is dark, per chess convention). */
  light: boolean
}

/** Static layout of all 64 tiles (positions + colors), computed once. */
export const BOARD_LAYOUT: TileLayout[] = (() => {
  const tiles: TileLayout[] = []
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square = fileRankToSquare(file, rank)
      const [x, z] = squareToXZ(square)
      tiles.push({ square, x, z, light: (file + rank) % 2 === 1 })
    }
  }
  return tiles
})()
