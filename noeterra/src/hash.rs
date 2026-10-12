use sha2::{Digest, Sha256};

use crate::model::World;

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut s = String::with_capacity(64);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// The digest of everything the simulation owns. Two worlds with the same hash
/// are the same world; a replay that reaches a different hash diverged.
pub fn world_hash(w: &World) -> String {
    sha256_hex(serde_json::to_string(w).expect("world serializes").as_bytes())
}

#[cfg(test)]
mod tests {
    #[test]
    fn known_digest() {
        assert_eq!(
            super::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
