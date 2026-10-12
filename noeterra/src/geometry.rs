//! Map shapes for the interfaces. Each province is its Voronoi cell, bounded
//! by a disc around its seat and clipped to real coastlines where the
//! scenario has a basemap (Natural Earth, public domain; see
//! data/geography.source.json). Presentation only — nothing here feeds the
//! simulation or its hashes, so it may use trigonometry freely.

use serde::{Deserialize, Serialize};

use crate::model::World;

type Pt = [f64; 2];

#[derive(Serialize)]
pub struct Shape {
    pub id: usize,
    /// One or more closed rings; a province may span islands.
    pub rings: Vec<Vec<Pt>>,
    pub center: Pt,
}

#[derive(Serialize)]
pub struct Lane {
    pub a: usize,
    pub b: usize,
    pub sea: bool,
}

#[derive(Serialize)]
pub struct River {
    pub name: Option<String>,
    pub line: Vec<Pt>,
}

#[derive(Serialize)]
pub struct Geometry {
    pub view_box: [f64; 4],
    pub shapes: Vec<Shape>,
    pub lanes: Vec<Lane>,
    /// Basemap land, lakes and rivers in the same projected frame.
    pub land: Vec<Vec<Pt>>,
    pub lakes: Vec<Vec<Pt>>,
    pub rivers: Vec<River>,
    /// Degrees of latitude per unit of the frame, for graticules and scale.
    pub scale: f64,
    pub has_basemap: bool,
    /// [lon0, lat0, cos(lat0), units per degree]: x = (lon - lon0) * cos * k, y = (lat0 - lat) * k.
    pub projection: [f64; 4],
}

#[derive(Deserialize)]
struct GeoRiver {
    name: Option<String>,
    line: Vec<Pt>,
}

#[derive(Deserialize)]
struct GeoFile {
    land: Vec<Vec<Pt>>,
    lakes: Vec<Vec<Pt>>,
    rivers: Vec<GeoRiver>,
}

const MEDITERRANEAN: &str = include_str!("../data/geography-mediterranean.json");
const TARIM: &str = include_str!("../data/geography-tarim.json");

fn basemap(scenario: &str) -> Option<GeoFile> {
    let text = match scenario {
        "mediterranean-264bc" => MEDITERRANEAN,
        "tarim-77bc" => TARIM,
        _ => return None,
    };
    serde_json::from_str(text).ok()
}

/// Keeps the half-plane nearer `a` than `b`.
fn clip_bisector(poly: &[Pt], a: Pt, b: Pt) -> Vec<Pt> {
    let m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let d = [b[0] - a[0], b[1] - a[1]];
    let side = |p: Pt| (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
    let mut out = Vec::with_capacity(poly.len() + 2);
    for i in 0..poly.len() {
        let (p, q) = (poly[i], poly[(i + 1) % poly.len()]);
        let (sp, sq) = (side(p), side(q));
        if sp <= 0.0 {
            out.push(p);
        }
        if (sp <= 0.0) != (sq <= 0.0) {
            let t = sp / (sp - sq);
            out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }
    out
}

fn round1(r: Vec<Pt>) -> Vec<Pt> {
    r.into_iter()
        .map(|p| [(p[0] * 10.0).round() / 10.0, (p[1] * 10.0).round() / 10.0])
        .collect()
}

pub fn geometry(w: &World) -> Geometry {
    let n = w.provinces.len().max(1) as f64;
    let lat0 = w.provinces.iter().map(|p| p.lat).sum::<f64>() / n;
    let lon0 = w.provinces.iter().map(|p| p.lon).sum::<f64>() / n;
    let k = 24.0;
    let cos0 = lat0.to_radians().cos();
    let project = |lon: f64, lat: f64| -> Pt { [(lon - lon0) * cos0 * k, (lat0 - lat) * k] };
    let pts: Vec<Pt> = w.provinces.iter().map(|p| project(p.lon, p.lat)).collect();
    let base = basemap(&w.scenario);
    let land: Vec<Vec<Pt>> = base
        .as_ref()
        .map(|b| {
            b.land
                .iter()
                .map(|r| r.iter().map(|p| project(p[0], p[1])).collect())
                .collect()
        })
        .unwrap_or_default();
    let dist = |a: Pt, b: Pt| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
    let mut shapes = Vec::new();
    for (i, &c) in pts.iter().enumerate() {
        let nearest = pts
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, &q)| dist(c, q))
            .fold(f64::INFINITY, f64::min);
        let r = (nearest * 1.25).clamp(1.0 * k, 3.4 * k);
        // The outer edge, where a province meets unclaimed land, wobbles like a
        // drawn border instead of following a compass arc. Seeded by the
        // province, so it is the same every time.
        let (p1, p2, p3) = (i as f64 * 1.7, i as f64 * 2.3 + 1.0, i as f64 * 0.9 + 2.0);
        let mut cell: Vec<Pt> = (0..72)
            .map(|s| {
                let t = s as f64 / 72.0 * std::f64::consts::TAU;
                let wobble =
                    1.0 + 0.09 * (3.0 * t + p1).sin() + 0.06 * (5.0 * t + p2).sin() + 0.035 * (9.0 * t + p3).sin();
                [c[0] + r * wobble * t.cos(), c[1] + r * wobble * t.sin()]
            })
            .collect();
        for (j, &q) in pts.iter().enumerate() {
            if j != i && dist(c, q) < 2.6 * r + 3.4 * k {
                cell = clip_bisector(&cell, c, q);
            }
        }
        // Coastlines come from the basemap at draw time: the interfaces clip
        // every province to the land, which is exact and leaves no slivers.
        let rings = vec![cell];
        shapes.push(Shape {
            id: i,
            rings: rings.into_iter().map(round1).collect(),
            center: c,
        });
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for s in &shapes {
        for p in s.rings.iter().flatten() {
            x0 = x0.min(p[0]);
            y0 = y0.min(p[1]);
            x1 = x1.max(p[0]);
            y1 = y1.max(p[1]);
        }
    }
    let pad = 1.2 * k;
    let mut lanes = Vec::new();
    for p in &w.provinces {
        for l in &p.links {
            if p.id < l.to {
                lanes.push(Lane {
                    a: p.id,
                    b: l.to,
                    sea: l.sea,
                });
            }
        }
    }
    let (lakes, rivers) = match &base {
        Some(b) => (
            b.lakes
                .iter()
                .map(|r| round1(r.iter().map(|p| project(p[0], p[1])).collect()))
                .collect(),
            b.rivers
                .iter()
                .map(|r| River {
                    name: r.name.clone(),
                    line: round1(r.line.iter().map(|p| project(p[0], p[1])).collect()),
                })
                .collect(),
        ),
        None => (Vec::new(), Vec::new()),
    };
    Geometry {
        view_box: [x0 - pad, y0 - pad, x1 - x0 + 2.0 * pad, y1 - y0 + 2.0 * pad],
        shapes,
        lanes,
        land: land.into_iter().map(round1).collect(),
        lakes,
        rivers,
        scale: 1.0 / k,
        has_basemap: base.is_some(),
        projection: [lon0, lat0, cos0, k],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scenario::{build, builtin};

    #[test]
    fn provinces_take_their_coastlines_from_the_basemap() {
        for id in ["mediterranean-264bc", "tarim-77bc"] {
            let w = build(&builtin(id, 1).unwrap(), 1).unwrap();
            let g = geometry(&w);
            assert!(g.has_basemap);
            assert_eq!(g.shapes.len(), w.provinces.len());
            assert!(g
                .shapes
                .iter()
                .all(|s| !s.rings.is_empty() && s.rings.iter().all(|r| r.len() >= 3)));
        }
        let w = build(&builtin("mediterranean-264bc", 1).unwrap(), 1).unwrap();
        let g = geometry(&w);
        assert!(g.land.len() > 5, "continents and islands");
    }
}
