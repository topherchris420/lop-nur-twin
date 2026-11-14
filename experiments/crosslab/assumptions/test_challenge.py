import copy
import math
import unittest

import jsonschema

from challenge import admit, make_request, select, load, ROOT
from verify import exact_interval, evaluate, check_rows


class AssumptionTests(unittest.TestCase):
    def setUp(self):
        self.protocol = load(ROOT/"protocol.json")
        self.request = make_request(self.protocol)
        self.proposal = {"assumption": "The prior observation transfers to these new conditions.",
                         "rival": "The prior observation fails to transfer under some interventions.",
                         "forecasts": {d: {p:[0.1,0.1] for p in self.protocol["profiles"]} for d in self.protocol["catalog"]}}

    def receipt(self, value):
        import json
        return {"request":self.request,"answer":{"finishReason":"stop","text":json.dumps(value)}}

    def test_selection_uses_forecasts_not_experiment_name(self):
        for target in self.protocol["catalog"]:
            v = copy.deepcopy(self.proposal)
            v["forecasts"][target]["rising"] = [0.1,0.9]
            self.assertEqual(select(v)["design"],target)

    def test_reject_nonfinite_forecast(self):
        self.proposal["forecasts"]["delivery"]["constant"][0] = float("nan")
        with self.assertRaises(ValueError):
            admit(self.receipt(self.proposal),self.request)

    def test_reject_out_of_bounds_and_extra_action(self):
        self.proposal["forecasts"]["delivery"]["constant"][0] = 1.1
        with self.assertRaises(jsonschema.ValidationError):
            admit(self.receipt(self.proposal),self.request)
        self.proposal["forecasts"]["delivery"]["constant"][0] = 0.1
        self.proposal["command"] = "execute"
        with self.assertRaises(jsonschema.ValidationError):
            admit(self.receipt(self.proposal),self.request)

    def test_reject_identical_rivals(self):
        self.proposal["rival"] = self.proposal["assumption"]
        with self.assertRaises(ValueError):
            admit(self.receipt(self.proposal),self.request)

    def test_reject_truncation_and_context_substitution(self):
        receipt = self.receipt(self.proposal)
        receipt["answer"]["finishReason"] = "length"
        with self.assertRaises(ValueError):
            admit(receipt,self.request)
        receipt = self.receipt(self.proposal)
        with self.assertRaises(ValueError):
            admit(receipt,{**self.request,"user":"different evidence"})

    def test_exact_binomial_boundaries_and_symmetry(self):
        self.assertAlmostEqual(exact_interval(0,10,.05)[1],1-.025**.1)
        self.assertAlmostEqual(exact_interval(10,10,.05)[0],.025**.1)
        lo,hi = exact_interval(5,10,.05)
        self.assertAlmostEqual(lo,1-hi)
        self.assertAlmostEqual(lo,0.1870860284473985)

    def test_incorrect_revision_cannot_pass(self):
        rows = lambda phase: [{"seed":s,"profile":p,"design":"delivery","error":True,"accepted":True}
                              for s in self.protocol[f"{phase}_seeds"] for p in self.protocol["profiles"]]
        revision = {"probabilities": {p:.1 for p in self.protocol["profiles"]}}
        result = evaluate(self.protocol,self.proposal,revision,{"design":"delivery"},rows("discovery"),rows("replication"))
        self.assertFalse(result["forecast_correction_screen_passed"])
        self.assertEqual(result["brier_improvement"],0)

    def test_no_forced_refutation(self):
        for d in self.proposal["forecasts"].values():
            for p in d:
                d[p]=[0,1]
        rows = lambda phase: [{"seed":s,"profile":p,"design":"delivery","error":False,"accepted":True}
                              for s in self.protocol[f"{phase}_seeds"] for p in self.protocol["profiles"]]
        revision = {"probabilities": {p:0 for p in self.protocol["profiles"]}}
        result = evaluate(self.protocol,self.proposal,revision,{"design":"delivery"},rows("discovery"),rows("replication"))
        self.assertFalse(result["forecast_correction_screen_passed"])
        self.assertTrue(all(not x["original_refuted_on_discovery"] for x in result["profiles"].values()))

    def test_seeds_unseen_and_separate(self):
        self.assertFalse(set(self.protocol["discovery_seeds"]) & set(self.protocol["replication_seeds"]))
        old = load(ROOT.parent/"planning/protocol.json")["freshness"]["seeds"]
        for phase in ("discovery","replication"):
            self.assertFalse(set(old)&set(self.protocol[f"{phase}_seeds"]))

    def test_missing_windows_rejected(self):
        with self.assertRaisesRegex(ValueError,"Missing"):
            check_rows([],self.protocol,"discovery",["delivery"])


if __name__ == "__main__":
    unittest.main()
