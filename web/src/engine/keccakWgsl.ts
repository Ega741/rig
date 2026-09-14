// WGSL for the share search. Lanes are vec2<u32> (x = low word, y = high word): WGSL has no u64.
// The shader takes the padded 136-byte block with counter = 0 and ORs the counter (message bytes
// 76..83, big-endian) into lanes 9 and 10 for every invocation.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/** Rho rotation offsets by lane index x + 5y. */
const RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

export const BLOCK_WORDS = 34;

/** 64-bit rotate-left of a vec2<u32> expression; n is a compile-time constant so no shift is ever 32. */
function rotl(v: string, n: number): string {
  n %= 64;
  if (n === 0) return v;
  if (n === 32) return `vec2<u32>(${v}.y, ${v}.x)`;
  if (n < 32) return `vec2<u32>((${v}.x << ${n}u) | (${v}.y >> ${32 - n}u), (${v}.y << ${n}u) | (${v}.x >> ${32 - n}u))`;
  const m = n - 32;
  return `vec2<u32>((${v}.y << ${m}u) | (${v}.x >> ${32 - m}u), (${v}.x << ${m}u) | (${v}.y >> ${32 - m}u))`;
}

function roundBody(): string {
  const lines: string[] = [];
  for (let x = 0; x < 5; x++) lines.push(`    let c${x} = st[${x}] ^ st[${x + 5}] ^ st[${x + 10}] ^ st[${x + 15}] ^ st[${x + 20}];`);
  for (let x = 0; x < 5; x++) lines.push(`    let d${x} = c${(x + 4) % 5} ^ ${rotl(`c${(x + 1) % 5}`, 1)};`);
  for (let i = 0; i < 25; i++) lines.push(`    st[${i}] = st[${i}] ^ d${i % 5};`);
  for (let i = 0; i < 25; i++) {
    const x = i % 5;
    const y = Math.floor(i / 5);
    const j = y + 5 * ((2 * x + 3 * y) % 5);
    lines.push(`    b[${j}] = ${rotl(`st[${i}]`, RHO[i]!)};`);
  }
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const i = x + 5 * y;
      lines.push(`    st[${i}] = b[${i}] ^ ((~b[${((x + 1) % 5) + 5 * y}]) & b[${((x + 2) % 5) + 5 * y}]);`);
    }
  }
  return lines.join('\n');
}

export function keccakShaderSource(workgroupSize: number): string {
  const rcLo = RC.map((v) => `${Number(v & 0xffffffffn)}u`).join(', ');
  const rcHi = RC.map((v) => `${Number(v >> 32n)}u`).join(', ');
  return `
struct Params {
  base_lo: u32,
  base_hi: u32,
  count: u32,
  difficulty: u32,
  max_hits: u32,
  debug: u32,
}
struct Hits {
  count: atomic<u32>,
  entries: array<vec2<u32>>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> block: array<u32, ${BLOCK_WORDS}>;
@group(0) @binding(2) var<storage, read_write> hits: Hits;
@group(0) @binding(3) var<storage, read_write> debug_hash: array<u32, 8>;

var<private> RC_LO: array<u32, 24> = array<u32, 24>(${rcLo});
var<private> RC_HI: array<u32, 24> = array<u32, 24>(${rcHi});
var<private> st: array<vec2<u32>, 25>;

fn keccakf() {
  var b: array<vec2<u32>, 25>;
  for (var r = 0u; r < 24u; r = r + 1u) {
${roundBody()}
    st[0] = st[0] ^ vec2<u32>(RC_LO[r], RC_HI[r]);
  }
}

fn bswap(x: u32) -> u32 {
  return ((x & 0xffu) << 24u) | ((x & 0xff00u) << 8u) | ((x >> 8u) & 0xff00u) | (x >> 24u);
}

// Leading zero bits of the hash read as a big-endian 256-bit integer; the first 128 bits are checked.
fn leading_zero_bits() -> u32 {
  let w0 = bswap(st[0].x);
  if (w0 != 0u) { return countLeadingZeros(w0); }
  let w1 = bswap(st[0].y);
  if (w1 != 0u) { return 32u + countLeadingZeros(w1); }
  let w2 = bswap(st[1].x);
  if (w2 != 0u) { return 64u + countLeadingZeros(w2); }
  let w3 = bswap(st[1].y);
  if (w3 != 0u) { return 96u + countLeadingZeros(w3); }
  return 128u;
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.count) { return; }
  let lo = params.base_lo + idx;
  var hi = params.base_hi;
  if (lo < params.base_lo) { hi = hi + 1u; }
  for (var i = 0u; i < 17u; i = i + 1u) {
    st[i] = vec2<u32>(block[2u * i], block[2u * i + 1u]);
  }
  for (var i = 17u; i < 25u; i = i + 1u) {
    st[i] = vec2<u32>(0u, 0u);
  }
  st[9].y = st[9].y | bswap(hi);
  st[10].x = st[10].x | bswap(lo);
  keccakf();
  if (leading_zero_bits() >= params.difficulty) {
    let slot = atomicAdd(&hits.count, 1u);
    if (slot < params.max_hits) { hits.entries[slot] = vec2<u32>(lo, hi); }
  }
  if (params.debug == 1u && idx == 0u) {
    debug_hash[0] = st[0].x; debug_hash[1] = st[0].y; debug_hash[2] = st[1].x; debug_hash[3] = st[1].y;
    debug_hash[4] = st[2].x; debug_hash[5] = st[2].y; debug_hash[6] = st[3].x; debug_hash[7] = st[3].y;
  }
}
`;
}

/** Padded 136-byte keccak block for header ++ nonce(segment, worker, counter = 0), as 34 little-endian u32 words. */
export function blockWords(header: Uint8Array, segment: bigint, worker: bigint): Uint32Array<ArrayBuffer> {
  if (header.length !== 52) throw new RangeError('header must be 52 bytes');
  const block = new Uint8Array(136);
  block.set(header, 0);
  const view = new DataView(block.buffer);
  view.setBigUint64(60, segment, false);
  view.setBigUint64(68, worker, false);
  block[84] = 0x01;
  block[135] = block[135]! | 0x80;
  const words = new Uint32Array(BLOCK_WORDS);
  for (let i = 0; i < BLOCK_WORDS; i++) words[i] = view.getUint32(4 * i, true);
  return words;
}
