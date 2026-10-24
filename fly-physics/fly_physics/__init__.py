"""FlyBody's MuJoCo dynamics on the digital fly's walking plan.

A research backend, separate from the browser. The browser's digital fly
(src/bethesda/fly/) moves a reduced-order body and draws its legs by inverse
kinematics on FlyBody's leg chains; scripts/fly-physics-trace.ts samples that
plan on FlyBody's 2 ms control clock. This package drives FlyBody's own MuJoCo
model (FlyBody's walking task configuration, its MJCF at the commit the
browser's anatomy was imported from) with those joint targets, open loop, and
measures how far the physical body follows the plan, on flat ground and in
situations the kinematic model cannot represent.

It uses FlyBody's Apache-2.0 code and model only. FlyBody's trained policies
and reference trajectories (the GPL-3.0 figshare release) are never fetched or
used: the controller here is the browser fly's open-loop kinematic plan, not
FlyBody's. Every number it writes describes these two simulators, never a fly.
"""

RESULT_SCHEMA = "fly-physics-result/v1"
TRACE_SCHEMA = "fly-physics-trace/v1"
