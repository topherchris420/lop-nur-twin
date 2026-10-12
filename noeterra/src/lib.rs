//! Noeterra: a deterministic, replayable civilization simulation in which every
//! civilization is an autonomous agent with its own memory.
//!
//! The rule the crate exists to keep: brains propose, the resolver decides.
//! Nothing a brain returns touches the world except through `action::validate`
//! and `resolve::resolve_turn`, and every turn ends in a state hash that a
//! replay must reproduce.

pub mod action;
pub mod brain;
pub mod experiment;
pub mod hash;
pub mod memory;
pub mod model;
pub mod observe;
pub mod resolve;
pub mod rng;
pub mod scenario;
pub mod sim;

pub mod api;
pub mod geometry;
pub mod views;

#[cfg(feature = "native")]
pub mod design;
#[cfg(feature = "native")]
pub mod server;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
