"""Pure unit tests: no network, no original database, no VM access."""

import tempfile
import unittest
from pathlib import Path

from eva_adaptive_brain import EvaAdaptiveBrain, VERSION


def observation(at=1, action="walk", success=True, life="eva-original", day=True):
    return {
        "life_id": life,
        "needs": {"energy": 0.8, "water": 0.8},
        "weather": {"is_day": day},
        "learning": {"last": {"at": at, "action": action, "success": success}},
    }


class EvaAdaptiveBrainTests(unittest.TestCase):
    def test_deduplicates_polling_without_erasing_original_learning(self):
        brain = EvaAdaptiveBrain()
        state = observation()
        self.assertTrue(brain.ingest_observation(state))
        self.assertFalse(brain.ingest_observation(state))
        self.assertEqual(brain.state["samples"], 1)
        self.assertEqual(brain.state["life_id"], "eva-original")
        self.assertEqual(state["learning"]["last"]["action"], "walk")

    def test_rejects_a_replacement_fly_even_at_a_newer_time(self):
        brain = EvaAdaptiveBrain()
        brain.ingest_observation(observation())
        with self.assertRaisesRegex(ValueError, "different fly"):
            brain.ingest_observation(observation(at=2, life="someone-else"))
        self.assertEqual(brain.state["life_id"], "eva-original")
        self.assertEqual(brain.state["samples"], 1)

    def test_recommends_only_when_both_actions_have_evidence_and_opted_in(self):
        brain = EvaAdaptiveBrain()
        for at in range(1, 13):
            brain.ingest_observation(observation(at, "walk", False))
        for at in range(13, 25):
            brain.ingest_observation(observation(at, "fly", True))
        current = observation(25)
        allowed = ("walk", "fly", "rest", "groom")
        self.assertEqual(brain.recommend(current, "walk", allowed), "walk")
        self.assertEqual(brain.recommend(current, "walk", allowed, active=True), "fly")
        self.assertEqual(brain.recommend(current, "rest", allowed, active=True), "rest")
        self.assertEqual(
            brain.recommend({**current, "needs": {"energy": 0.1, "water": 0.8}},
                            "walk", allowed, active=True),
            "walk",
        )
        self.assertEqual(
            brain.recommend(current, "walk", ("walk",), active=True), "walk"
        )
        self.assertEqual(brain.state["recommendations"], 1)

    def test_bounded_replayable_memory(self):
        brain = EvaAdaptiveBrain()
        for at in range(1, 1101):
            brain.ingest_observation(observation(at, success=at % 3 != 0))
        self.assertEqual(len(brain.state["recent"]), 48)
        counts = brain.state["contexts"]["day"]["walk"]
        self.assertLess(counts["yes"] + counts["no"], 1024)
        restored = EvaAdaptiveBrain.from_json(brain.to_json())
        self.assertEqual(restored.to_json(), brain.to_json())
        self.assertFalse(restored.ingest_observation(observation(1100)))
        self.assertTrue(restored.ingest_observation(observation(1101)))
        self.assertEqual(restored.state["samples"], 1101)

    def test_separate_sidecar_never_overwrites_an_unrelated_file(self):
        brain = EvaAdaptiveBrain()
        brain.ingest_observation(observation())
        with tempfile.TemporaryDirectory() as root:
            storage = Path(root)
            with self.assertRaisesRegex(ValueError, "dedicated"):
                brain.save_sidecar(storage / "learning.db")
            old_db = storage / "learning.db"
            old_db.write_text("original untouched", encoding="utf-8")
            output = storage / "experimental.eva-brain-v1.json"
            brain.save_sidecar(output)
            self.assertEqual(
                EvaAdaptiveBrain.from_json(output.read_text()).state["schema"], VERSION
            )
            self.assertEqual(old_db.read_text(), "original untouched")
            other = EvaAdaptiveBrain()
            other.ingest_observation(observation(life="other"))
            with self.assertRaisesRegex(ValueError, "individual"):
                other.save_sidecar(output)
            self.assertEqual(
                EvaAdaptiveBrain.from_json(output.read_text()).state["life_id"],
                "eva-original",
            )


if __name__ == "__main__":
    unittest.main()
