//! HashMine share search: keccak256(beneficiary[20] || challenge[32] || nonce[32]) with
//! nonce = segment << 128 | worker << 64 | counter (big-endian). One 136-byte keccak block.
#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

/// beneficiary (20 bytes) followed by challenge (32 bytes); written by the host.
static mut HEADER: [u8; 52] = [0; 52];
/// 32-byte hash output for `hash_into`.
static mut OUT: [u8; 32] = [0; 32];

#[no_mangle]
pub extern "C" fn header_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(HEADER) as *mut u8
}

#[no_mangle]
pub extern "C" fn out_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(OUT) as *mut u8
}

/// Absorbed block for counter = 0: lanes 0..17 of the padded 136-byte message.
#[inline(always)]
fn base_state(segment: u64, worker: u64) -> [u64; 25] {
    let header = unsafe { &*core::ptr::addr_of!(HEADER) };
    let mut m = [0u8; 136];
    m[..52].copy_from_slice(header);
    m[60..68].copy_from_slice(&segment.to_be_bytes());
    m[68..76].copy_from_slice(&worker.to_be_bytes());
    m[84] = 0x01;
    m[135] |= 0x80;
    let mut st = [0u64; 25];
    for i in 0..17 {
        let mut lane = [0u8; 8];
        lane.copy_from_slice(&m[8 * i..8 * i + 8]);
        st[i] = u64::from_le_bytes(lane);
    }
    st
}

/// Leading zero bits of the hash read as a big-endian 256-bit integer (at most 4 lanes are checked).
#[inline(always)]
fn leading_zero_bits(st: &[u64; 25]) -> u32 {
    let mut n = 0;
    for i in 0..4 {
        let v = st[i].swap_bytes();
        if v == 0 {
            n += 64;
        } else {
            return n + v.leading_zeros();
        }
    }
    n
}

#[inline(always)]
fn hash_counter(base: &[u64; 25], counter: u64) -> [u64; 25] {
    let mut st = *base;
    // message bytes 76..79 = counter high word big-endian -> lane 9 high half, little-endian
    st[9] |= (((counter >> 32) as u32).swap_bytes() as u64) << 32;
    // message bytes 80..83 = counter low word big-endian -> lane 10 low half
    st[10] |= (counter as u32).swap_bytes() as u64;
    keccak::f1600(&mut st);
    st
}

/// Returns `counter + 1` of the first nonce in `[start, start + count)` whose hash has at least
/// `difficulty` leading zero bits, or 0 if there is none. A hit at counter u64::MAX reads as none.
#[no_mangle]
pub extern "C" fn search(segment: u64, worker: u64, start: u64, count: u32, difficulty: u32) -> u64 {
    let base = base_state(segment, worker);
    let mut c = start;
    for _ in 0..count {
        if leading_zero_bits(&hash_counter(&base, c)) >= difficulty {
            return c.wrapping_add(1);
        }
        c = c.wrapping_add(1);
    }
    0
}

/// Writes the 32-byte hash of one nonce into the buffer at `out_ptr()`.
#[no_mangle]
pub extern "C" fn hash_into(segment: u64, worker: u64, counter: u64) {
    let st = hash_counter(&base_state(segment, worker), counter);
    let out = unsafe { &mut *core::ptr::addr_of_mut!(OUT) };
    for i in 0..4 {
        out[8 * i..8 * i + 8].copy_from_slice(&st[i].to_le_bytes());
    }
}
