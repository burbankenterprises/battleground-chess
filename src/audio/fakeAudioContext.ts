/**
 * Minimal Web Audio stand-in for unit tests (node has no AudioContext). It
 * records the node graph and every scheduled automation / start / stop, and
 * enforces the real API's hard rules that would throw in a browser:
 * exponential ramps need a strictly positive target, start() at most once,
 * stop() only after start().
 */

type Automation = { kind: 'set' | 'linear' | 'exp' | 'cancel'; value: number; time: number }

export class FakeParam {
  value: number
  events: Automation[] = []
  constructor(value: number) {
    this.value = value
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time })
    this.value = value
    return this
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'linear', value, time })
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    if (!(value > 0)) throw new RangeError(`exponential ramp target must be > 0 (got ${value})`)
    this.events.push({ kind: 'exp', value, time })
    return this
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', value: Number.NaN, time })
    return this
  }
}

export class FakeNode {
  readonly kind: string
  readonly ctx: FakeAudioContext
  outputs: FakeNode[] = []
  disconnected = false
  constructor(kind: string, ctx: FakeAudioContext) {
    this.kind = kind
    this.ctx = ctx
    ctx.nodes.push(this)
  }
  connect(target: FakeNode) {
    this.outputs.push(target)
    return target
  }
  disconnect() {
    this.outputs = []
    this.disconnected = true
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1)
  constructor(ctx: FakeAudioContext) {
    super('gain', ctx)
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  constructor(ctx: FakeAudioContext) {
    super('filter', ctx)
  }
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24)
  knee = new FakeParam(30)
  ratio = new FakeParam(12)
  attack = new FakeParam(0.003)
  release = new FakeParam(0.25)
  constructor(ctx: FakeAudioContext) {
    super('compressor', ctx)
  }
}

export class FakeSource extends FakeNode {
  startedAt: number | null = null
  stoppedAt: number | null = null
  onended: (() => void) | null = null
  start(when = 0) {
    if (this.startedAt !== null) throw new Error('start() called twice')
    this.startedAt = when
  }
  stop(when = 0) {
    if (this.startedAt === null) throw new Error('stop() before start()')
    this.stoppedAt = when
  }
  /** Simulate the source finishing (fires onended like the browser). */
  end() {
    this.onended?.()
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine'
  frequency = new FakeParam(440)
  constructor(ctx: FakeAudioContext) {
    super('oscillator', ctx)
  }
}

export class FakeBuffer {
  readonly length: number
  readonly sampleRate: number
  private readonly data: Float32Array
  constructor(length: number, sampleRate: number) {
    this.length = length
    this.sampleRate = sampleRate
    this.data = new Float32Array(length)
  }
  getChannelData() {
    return this.data
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null
  loop = false
  constructor(ctx: FakeAudioContext) {
    super('buffer-source', ctx)
  }
}

export class FakeAudioContext {
  currentTime = 0
  sampleRate = 8000
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  nodes: FakeNode[] = []
  buffers: FakeBuffer[] = []
  resumeCalls = 0
  readonly destination: FakeNode
  constructor() {
    this.destination = new FakeNode('destination', this)
  }
  createGain() {
    return new FakeGain(this)
  }
  createBiquadFilter() {
    return new FakeFilter(this)
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this)
  }
  createOscillator() {
    return new FakeOscillator(this)
  }
  createBufferSource() {
    return new FakeBufferSource(this)
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const b = new FakeBuffer(length, sampleRate)
    this.buffers.push(b)
    return b
  }
  resume() {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }
  /** Every oscillator / buffer source created so far. */
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource)
  }
}

/** The fake, typed as the real thing for code under test. */
export function asAudioContext(ctx: FakeAudioContext): AudioContext {
  return ctx as unknown as AudioContext
}
