//! Deterministic randomness. The generator is implemented here rather than taken
//! from a crate so that a dependency upgrade can never change a replay.

#[derive(Clone, Debug)]
pub struct Rng {
    s: [u64; 4],
}

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut sm = seed;
        let mut s = [0u64; 4];
        for x in s.iter_mut() {
            *x = splitmix(&mut sm);
        }
        Rng { s }
    }

    /// A stream keyed by the world seed and a path such as `[turn, civ, PURPOSE]`.
    /// Streams are independent of each other and of the order they are drawn in,
    /// which is what lets brains decide in parallel without perturbing the world.
    pub fn stream(seed: u64, path: &[u64]) -> Self {
        let mut sm = seed;
        let mut acc = splitmix(&mut sm);
        for &p in path {
            let mut k = acc ^ p.wrapping_mul(0xD6E8_FEB8_6659_FD93);
            acc = splitmix(&mut k);
        }
        Rng::new(acc)
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.f64()
    }

    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next_u64() % n as u64) as usize
        }
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.f64() < p
    }
}

pub mod purpose {
    pub const BATTLE: u64 = 1;
    pub const EVENTS: u64 = 2;
    pub const INTEL: u64 = 3;
    pub const BRAIN: u64 = 4;
    pub const SIEGE: u64 = 5;
    pub const REVOLT: u64 = 6;
    pub const GENERATE: u64 = 7;
    pub const NAMES: u64 = 8;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_are_reproducible_and_distinct() {
        let a: Vec<u64> = (0..4).map(|_| Rng::stream(7, &[1, 2]).next_u64()).collect();
        assert!(a.windows(2).all(|w| w[0] == w[1]));
        assert_ne!(Rng::stream(7, &[1, 2]).next_u64(), Rng::stream(7, &[2, 1]).next_u64());
        assert_ne!(Rng::stream(7, &[1]).next_u64(), Rng::stream(8, &[1]).next_u64());
    }

    #[test]
    fn unit_interval() {
        let mut r = Rng::new(42);
        for _ in 0..10_000 {
            let x = r.f64();
            assert!((0.0..1.0).contains(&x));
        }
    }

    #[test]
    fn known_first_value_pins_the_algorithm() {
        // If this changes, every recorded replay changes with it.
        assert_eq!(Rng::new(0).next_u64(), 11091344671253066420);
    }
}
