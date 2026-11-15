//! DRM helpers for Microsoft Edge Read Aloud.
//!
//! Since October 2026 the service only accepts the v2 `Sec-MS-GEC` token:
//! a CS64 digest combined with a modified SHA-256 digest, formatted as
//! `<16 hex>-<64 hex>`. The SHA-256 variant uses a custom initial state and
//! a modified round constant, so it cannot be replaced with a stock SHA-256
//! implementation. The algorithm mirrors edge-tts 7.3.1 `drm.py`.

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::edge_tts::constants::{
    DRM_ROUNDING_SECONDS, TICKS_PER_SECOND, TRUSTED_CLIENT_TOKEN, WINDOWS_EPOCH_OFFSET,
};

static CLOCK_SKEW_MS: AtomicI64 = AtomicI64::new(0);

const SHA256_INITIAL: [u32; 8] = [
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB,
    0x5BE0CD19,
];

const SHA256_STATE: [u32; 8] = [
    0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4,
    0x03EFFBD2,
];

const SHA256_SCHEDULE: [u32; 14] = [
    0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0,
    0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564,
];

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4,
    0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE,
    0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F,
    0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7,
    0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC,
    0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B,
    0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116,
    0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7,
    0xC67178F2,
];

const SHA256_ADJUSTMENT: u32 = 0xC9DC06A7;
const SHA256_SIGMA0_ADJUSTMENT: u32 = 0x059C0B80;
const SHA256_SIGMA1_ADJUSTMENT: u32 = 0x000B92C0;

const CS64_COEFFICIENTS: [(u32, u32); 14] = [
    (0xE82E91B1, 0xB32700D0),
    (0x44DE24C6, 0x88DFF51D),
    (0x3BEB65BC, 0x29514038),
    (0xC89C5933, 0xB328CBDF),
    (0x8D1EC211, 0xD405B4D5),
    (0x314EF5D5, 0x26E55F3C),
    (0xE92491B1, 0x607801C6),
    (0xF0A5B9D5, 0x82B2C1FB),
    (0x06064CF3, 0xFA51A3DA),
    (0xDA79FA60, 0x207CC464),
    (0xBED20560, 0x3C3C74F3),
    (0x89F9C9F8, 0xD2D14B61),
    (0x35FA38C6, 0xBB04A2C1),
    (0xCB49E3C6, 0xC5626167),
];

const CS64_FACTOR: u64 = 0x82893933;
const CS64_ADJUSTMENT0: u128 = 0xF2F90B1A;
const CS64_ADJUSTMENT1: u128 = 0x0B1A0000;

pub fn generate_sec_ms_gec() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let skew_secs = CLOCK_SKEW_MS.load(Ordering::Relaxed) / 1000;

    generate_sec_ms_gec_at(now + skew_secs)
}

fn generate_sec_ms_gec_at(unix_timestamp: i64) -> String {
    let mut seconds = unix_timestamp + WINDOWS_EPOCH_OFFSET as i64;
    seconds -= seconds.rem_euclid(DRM_ROUNDING_SECONDS as i64);

    let ticks = (seconds as u128) * TICKS_PER_SECOND as u128;
    let data = format!("{ticks}{TRUSTED_CLIENT_TOKEN}");

    token_hash(data.as_bytes())
}

fn token_hash(data: &[u8]) -> String {
    let digest = sha256_digest(data);
    let (first, second) = cs64_digest(data, &digest);

    let cs64_bytes = [first.to_le_bytes(), second.to_le_bytes()].concat();
    let cs64: String = cs64_bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect();
    let sha256: String = digest.iter().map(|byte| format!("{byte:02X}")).collect();

    format!("{cs64}-{sha256}")
}

fn rol16(value: u32) -> u32 {
    value.rotate_left(16)
}

fn sigma0(value: u32) -> u32 {
    let value = value as u64;
    ((value >> 7) ^ (value << 25) ^ (value >> 18) ^ (value << 14) ^ (value >> 3)) as u32
}

fn sigma1(value: u32) -> u32 {
    let value = value as u64;
    ((value >> 17) ^ (value << 15) ^ (value >> 19) ^ (value << 13) ^ (value >> 10)) as u32
}

fn expand_sha256_schedule(words: &mut Vec<u32>, first_word: usize) {
    for index in first_word..64 {
        let x = words[index - 2] as u64;
        let y = words[index - 15] as u64;
        let sigma1 = (x >> 17) ^ (x << 15) ^ (x >> 19) ^ (x << 13) ^ (x >> 10);
        let sigma0 = (y >> 7) ^ (y << 25) ^ (y >> 18) ^ (y << 14) ^ (y >> 3);
        let value = sigma1 + words[index - 7] as u64 + sigma0 + words[index - 16] as u64;
        words.push(value as u32);
    }
}

fn sha256_rounds(state: [u32; 8], words: &[u32], first_round: usize) -> [u32; 8] {
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;

    for index in first_round..64 {
        let big_sigma1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choose = g ^ (e & (f ^ g));
        let constant = if first_round == 14 && index == 14 {
            SHA256_ADJUSTMENT
        } else {
            SHA256_ROUND_CONSTANTS[index]
        };
        let t1 = h
            .wrapping_add(big_sigma1)
            .wrapping_add(choose)
            .wrapping_add(constant)
            .wrapping_add(words[index]);

        let big_sigma0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let majority = (a & b) | (c & (a | b));
        let t2 = big_sigma0.wrapping_add(majority);

        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(t1);
        d = c;
        c = b;
        b = a;
        a = t1.wrapping_add(t2);
    }

    [a, b, c, d, e, f, g, h]
}

fn sha256_init(data: &[u8]) -> [u32; 8] {
    let mut words = vec![0_u32; 14];
    words.push(u32::from_be_bytes([0, data[0], data[1], data[2]]));
    words.push(u32::from_be_bytes([
        data[3], data[4], data[5], data[6],
    ]));

    for index in 16..30 {
        let mut value = SHA256_SCHEDULE[index - 16] as u64;

        if index - 2 >= 14 {
            let sigma = sigma1(words[index - 2]);
            value += if index == 16 {
                (sigma ^ SHA256_SIGMA1_ADJUSTMENT) as u64
            } else {
                sigma as u64
            };
        }
        if index - 7 >= 14 {
            value += words[index - 7] as u64;
        }
        if index - 15 >= 14 {
            let sigma = sigma0(words[index - 15]);
            value += if index == 29 {
                (sigma ^ SHA256_SIGMA0_ADJUSTMENT) as u64
            } else {
                sigma as u64
            };
        }

        words.push(value as u32);
    }

    let last = sigma1(words[28]) as i128
        + words[23] as i128
        + sigma0(words[15]) as i128
        + words[14] as i128
        + SHA256_ADJUSTMENT as i128
        - SHA256_ROUND_CONSTANTS[14] as i128;
    words.push(last as u32);

    expand_sha256_schedule(&mut words, 31);
    let working = sha256_rounds(SHA256_STATE, &words, 14);

    let mut state = [0_u32; 8];
    for (index, value) in working.iter().enumerate() {
        state[index] = SHA256_INITIAL[index].wrapping_add(*value);
    }
    state
}

fn sha256_digest(data: &[u8]) -> [u8; 32] {
    let length = 57 + data.len();
    let padding_length = (55_i64 - length as i64).rem_euclid(64) as usize;

    let mut padded = Vec::with_capacity(data.len() + padding_length + 9);
    padded.extend_from_slice(&data[7..]);
    padded.push(0x80);
    padded.resize(padded.len() + padding_length, 0);
    padded.extend_from_slice(&((length as u64) * 8).to_be_bytes());

    let mut state = sha256_init(&data[..7]);
    for block in padded.chunks(64) {
        let mut words: Vec<u32> = block
            .chunks(4)
            .map(|bytes| u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            .collect();
        expand_sha256_schedule(&mut words, 16);

        let working = sha256_rounds(state, &words, 0);
        for (index, value) in working.iter().enumerate() {
            state[index] = state[index].wrapping_add(*value);
        }
    }

    let mut digest = [0_u8; 32];
    for (index, value) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    digest
}

fn words_le4_even(data: &[u8]) -> Vec<u32> {
    let mut padded = Vec::with_capacity(data.len() + 4);
    padded.push(0_u8);
    padded.extend_from_slice(data);
    while padded.len() % 4 != 0 {
        padded.push(0);
    }

    let mut words: Vec<u32> = padded
        .chunks(4)
        .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect();
    if words.len() % 2 != 0 {
        words.push(0);
    }
    words
}

#[allow(clippy::too_many_lines)]
fn cs64_digest(data: &[u8], digest: &[u8; 32]) -> (u32, u32) {
    let key_a = u32::from_le_bytes(digest[0..4].try_into().unwrap()) | 1;
    let key_b = u32::from_le_bytes(digest[4..8].try_into().unwrap()) | 1;
    let factors = [
        (key_a as u64 * CS64_FACTOR) as u32,
        (key_b as u64 * CS64_FACTOR) as u32,
    ];

    let mut terms: Vec<u32> = CS64_COEFFICIENTS
        .iter()
        .enumerate()
        .map(|(index, (coefficient, _))| {
            (*coefficient as u64 * factors[index % 2] as u64) as u32
        })
        .collect();
    let mut offsets: Vec<u32> = CS64_COEFFICIENTS
        .iter()
        .map(|(_, offset)| *offset)
        .collect();

    for (index, word) in words_le4_even(data).iter().enumerate() {
        let key = if index % 2 == 0 {
            key_a as u128
        } else {
            key_b as u128
        };
        let offset_factor = if index % 2 == 0 {
            0xEF0569FB_u128
        } else {
            0xC31713DB_u128
        };

        let mut term = *word as u128 * key;
        let mut offset = rol16(*word) as u128 * offset_factor;
        if index == 0 {
            term += CS64_ADJUSTMENT0 * factors[0] as u128;
            offset += CS64_ADJUSTMENT1;
        }
        terms.push(term as u32);
        offsets.push(offset as u32);
    }

    let mut swap_acc = 0_u32;
    let mut swap_last = 0_u32;
    let mut state = 0_u32;
    let mut acc = 0_u32;

    for index in (0..terms.len()).step_by(2) {
        let x = terms[index];
        let y = terms[index + 1];

        let t = rol16(offsets[index].wrapping_add(x));
        let q = (t as u64 * 0x76F50F34) as u32;
        swap_acc = swap_acc.wrapping_add(
            (rol16(q) as u64 * 0xC3EFEA97 + q as u64) as u32,
        );

        let t = rol16(offsets[index + 1].wrapping_add(y));
        let q = (t as u64 * 0x1881CE3C) as u32;
        swap_last = (rol16(q) as u64 * 0x35BD1EC9 + q as u64) as u32;
        swap_acc = swap_acc.wrapping_add(swap_last);

        state = (state as u64 * key_a as u64 + x as u64) as u32;
        state = (rol16(state) as u64 * 0xCF98B111) as u32;
        state = (rol16(state) as u64 * 0x87085B9F) as u32;
        state = (rol16(state) as u64 * 0x12CEB96D) as u32;
        state = (rol16(state) as u64 * 0x257E1D83) as u32;
        acc = acc.wrapping_add(state);

        let mut t = (state as u64 * key_b as u64 + y as u64) as u32;
        t = (rol16(t) as u64 * 0xA27416F5) as u32;
        t = (rol16(t) as u64 * 0xD38396FF) as u32;
        state = (rol16((rol16(t) as u64 * 0x7C932B89) as u32) as u64 * 0xBFA49F69) as u32;
        acc = acc.wrapping_add(state);
    }

    (swap_last ^ state, swap_acc ^ acc)
}

pub fn adjust_clock_skew(server_date_str: &str) -> Result<(), String> {
    let server_time = chrono::DateTime::parse_from_rfc2822(server_date_str)
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(server_date_str, "%a, %d %b %Y %H:%M:%S GMT")
                .map(|dt| dt.and_utc().fixed_offset())
        })
        .map_err(|e| format!("Failed to parse server date '{server_date_str}': {e}"))?;

    let server_ts = server_time.timestamp();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let delta_ms = (server_ts - now) * 1000;
    CLOCK_SKEW_MS.fetch_add(delta_ms, Ordering::Relaxed);

    Ok(())
}

pub fn generate_muid() -> String {
    use rand::Rng;

    let mut rng = rand::rng();
    let bytes: [u8; 16] = rng.random();
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

pub fn js_date_string() -> String {
    let now = chrono::Utc::now();
    now.format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Vectors produced by edge-tts 7.3.1 `generate_sec_ms_gec_v2(timestamp)`.
    // They are the only reliable regression guard for this bit-exact algorithm.
    const OFFICIAL_VECTORS: [(i64, &str); 3] = [
        (
            1791888000,
            "492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876",
        ),
        (
            0,
            "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6",
        ),
        (
            1763164800,
            "2F6E3A153D5DEB1B-9C105A25891BF67C2EDF0913ED96A5371277E3E35E6A65D2C07E23F0E131B750",
        ),
    ];

    #[test]
    fn test_v2_token_matches_official_vectors() {
        for (timestamp, expected) in OFFICIAL_VECTORS {
            assert_eq!(generate_sec_ms_gec_at(timestamp), expected, "ts={timestamp}");
        }
    }

    #[test]
    fn test_generate_sec_ms_gec_has_v2_shape() {
        let token = generate_sec_ms_gec();
        assert_eq!(token.len(), 81);
        assert_eq!(&token[16..17], "-");
        assert!(token
            .chars()
            .enumerate()
            .all(|(_, c)| c == '-' || c.is_ascii_hexdigit()));
    }

    /// Manual probe helper: `cargo test --lib print_current_token -- --ignored --nocapture`.
    /// The printed value can be pasted into a Sec-MS-GEC handshake probe.
    #[test]
    #[ignore = "manual connectivity probe helper"]
    fn print_current_token() {
        println!("{}", generate_sec_ms_gec());
    }

    #[test]
    fn test_generate_muid_is_32_hex_chars() {
        let muid = generate_muid();
        assert_eq!(muid.len(), 32);
        assert!(muid.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_js_date_string_format() {
        let s = js_date_string();
        assert!(s.contains("GMT+0000"));
        assert!(s.contains("Coordinated Universal Time"));
    }
}
