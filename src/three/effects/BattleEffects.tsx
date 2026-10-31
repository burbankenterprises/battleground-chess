import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, TetrahedronGeometry } from 'three'
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { useGameStore } from '../../game/store'
import { ARMY_PALETTE, DUST_TINT, DUST_TINT_MIX } from '../pieces/palette'
import { effectsForBatch } from './effectPlan'
import type { DustEffect, ShatterEffect } from './effectPlan'
import { dustState, shardOpacity, shardPosition, shardRotation, spawnShards } from './shatter'
import type { ShardSeed } from './shatter'

/**
 * BattleEffects — additive, non-interactive effect meshes driven by the
 * current animation batch (never part of any actor's identity):
 *   - `death`          → shatter shards (5–8 low-poly tetra/box pieces on
 *                         ballistic arcs, fading) + a dust puff where the body
 *                         lands, both tinted like the dying piece.
 *   - `checkmate-fall` → a dust puff where the mated king hits the board.
 * Effects run on the batch's sequence clock (`animStartedAt`), so they stay
 * frame-locked to the director's timeline, and unmount with the batch.
 */

const NO_RAYCAST = () => null

/** Shared unit geometries (scaled per shard), alive for the module's lifetime. */
const TETRA_GEOMETRY = new TetrahedronGeometry(1, 0)
const BOX_GEOMETRY = new BoxGeometry(1, 1, 1)

function Shatter({ effect, startedAt }: { effect: ShatterEffect; startedAt: number }) {
  const groupRef = useRef<Group>(null)
  const meshRefs = useRef<(Mesh | null)[]>([])
  const shards = useMemo<ShardSeed[]>(() => spawnShards(effect.spec), [effect.spec])
  const palette = ARMY_PALETTE[effect.color]

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const local = performance.now() - startedAt - effect.startMs
    const live = local >= 0 && local <= effect.lifeMs
    group.visible = live
    if (!live) return
    const s = local / 1000
    const opacity = shardOpacity(local / effect.lifeMs)
    shards.forEach((shard, i) => {
      const mesh = meshRefs.current[i]
      if (!mesh) return
      const [px, py, pz] = shardPosition(shard, s)
      const [rx, ry, rz] = shardRotation(shard, s)
      mesh.position.set(px, py, pz)
      mesh.rotation.set(rx, ry, rz)
      ;(mesh.material as MeshStandardMaterial).opacity = opacity
    })
  })

  return (
    <group ref={groupRef} visible={false}>
      {shards.map((shard, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m
          }}
          raycast={NO_RAYCAST}
          geometry={shard.shape === 'tetra' ? TETRA_GEOMETRY : BOX_GEOMETRY}
          position={shard.p0}
          rotation={shard.r0}
          scale={shard.scale}
        >
          <meshStandardMaterial
            color={palette.color}
            metalness={palette.metalness}
            roughness={palette.roughness}
            emissive={palette.emissive}
            emissiveIntensity={0.25}
            flatShading
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function DustPuff({ effect, startedAt }: { effect: DustEffect; startedAt: number }) {
  const groupRef = useRef<Group>(null)
  const puffRef = useRef<Mesh>(null)
  const ringRef = useRef<Mesh>(null)
  const tint = useMemo(
    () =>
      new Color(ARMY_PALETTE[effect.color].color)
        .lerp(new Color(DUST_TINT), DUST_TINT_MIX)
        .getStyle(),
    [effect.color],
  )

  useFrame(() => {
    const group = groupRef.current
    const puff = puffRef.current
    const ring = ringRef.current
    if (!group || !puff || !ring) return
    const local = performance.now() - startedAt - effect.startMs
    const live = local >= 0 && local <= effect.lifeMs
    group.visible = live
    if (!live) return
    const d = dustState(local / effect.lifeMs)
    const s = d.scale * effect.size
    puff.scale.set(s, s * 0.55, s) // squat, ground-hugging cloud
    const r = d.ringScale * effect.size
    ring.scale.set(r, r, r)
    ;(puff.material as MeshBasicMaterial).opacity = d.opacity
    ;(ring.material as MeshBasicMaterial).opacity = d.opacity * 0.8
  })

  return (
    <group ref={groupRef} position={[effect.x, 0, effect.z]} visible={false}>
      <mesh ref={puffRef} raycast={NO_RAYCAST} position={[0, 0.06, 0]}>
        <sphereGeometry args={[0.5, 12, 8]} />
        <meshBasicMaterial color={tint} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh
        ref={ringRef}
        raycast={NO_RAYCAST}
        position={[0, 0.015, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.32, 0.5, 24]} />
        <meshBasicMaterial color={tint} transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

export function BattleEffects() {
  const animCommands = useGameStore((s) => s.animCommands)
  const actors = useGameStore((s) => s.actors)
  const animSeq = useGameStore((s) => s.animSeq)
  const animStartedAt = useGameStore((s) => s.animStartedAt)

  const effects = useMemo(
    () => effectsForBatch(animCommands, actors, animSeq),
    [animCommands, actors, animSeq],
  )

  return (
    <group>
      {effects.map((e) =>
        e.kind === 'shatter' ? (
          <Shatter key={e.key} effect={e} startedAt={animStartedAt} />
        ) : (
          <DustPuff key={e.key} effect={e} startedAt={animStartedAt} />
        ),
      )}
    </group>
  )
}
