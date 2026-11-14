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


class ArchiveAdversarialTests(unittest.TestCase):
    def test_archive_and_stricter_audit(self):
        from verify import verify
        from review import audit
        record = ROOT/"record"
        if not (record/"sha256.json").exists():
            self.skipTest("No recorded inference yet")
        verify(record)
        result = audit(record)
        self.assertFalse(result["scientific_milestone_established"])
        for cell in result["strata"].values():
            if cell["accepted"]==0:
                self.assertIsNone(cell["conditional_error_risk"])
                self.assertIsNone(cell["descriptive_exact_95_error_interval"])

    def test_edited_evidence_rejected_even_when_rehashed(self):
        import tempfile
        import shutil
        import json
        from hashlib import sha256
        from pathlib import Path
        from verify import verify
        record=ROOT/"record"
        if not (record/"sha256.json").exists():
            self.skipTest("No recorded inference yet")
        with tempfile.TemporaryDirectory() as directory:
            work=Path(directory)/"evidence"
            shutil.copytree(record,work)
            path=work/"replication-windows.json"
            rows=load(path)
            rows[0]["estimate"] += 15
            path.write_text(json.dumps(rows))
            manifest=load(work/"sha256.json")
            manifest[path.name]=sha256(path.read_bytes()).hexdigest()
            (work/"sha256.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"arithmetic"):
                verify(work)

    def test_edited_result_rejected(self):
        import tempfile
        import shutil
        import json
        from pathlib import Path
        from verify import verify
        record=ROOT/"record"
        if not (record/"result.json").exists():
            self.skipTest("No recorded inference yet")
        with tempfile.TemporaryDirectory() as directory:
            work=Path(directory)/"evidence"
            shutil.copytree(record,work)
            path=work/"result.json"
            result=load(path)
            result["forecast_correction_screen_passed"]=True
            path.write_text(json.dumps(result))
            with self.assertRaisesRegex(ValueError,"Published result"):
                verify(work)

    def test_misattributed_model_rejected_even_when_rehashed(self):
        import tempfile
        import shutil
        import json
        from hashlib import sha256
        from pathlib import Path
        from verify import verify
        record=ROOT/"record"
        if not (record/"result.json").exists():
            self.skipTest("No recorded inference yet")
        for reported in (None,"another-model"):
            with self.subTest(reported=reported), tempfile.TemporaryDirectory() as directory:
                work=Path(directory)/"evidence"
                shutil.copytree(record,work)
                path=work/"proposal-model.json"
                receipt=load(path)
                receipt["answer"]["reportedModel"]=reported
                path.write_text(json.dumps(receipt))
                manifest=load(work/"sha256.json")
                manifest[path.name]=sha256(path.read_bytes()).hexdigest()
                (work/"sha256.json").write_text(json.dumps(manifest))
                with self.assertRaisesRegex(ValueError,"model identity"):
                    verify(work)

    def test_atlas_does_not_admit_unverified_json(self):
        import tempfile
        import shutil
        import json
        import sys
        from pathlib import Path
        from types import ModuleType
        from unittest.mock import patch
        from atlas_export import export
        record=ROOT/"record"
        if not (record/"result.json").exists():
            self.skipTest("No recorded inference yet")
        imported=[]
        class Ledger:
            def __init__(self,path): pass
            def append(self,kind,data):
                if kind=="dataset": imported.append(data["name"])
                from types import SimpleNamespace
                return SimpleNamespace(object="plan")
            def put_file(self,path):
                from hashlib import sha256
                return "sha256:"+sha256(path.read_bytes()).hexdigest()
            def verify(self): return []
            def entries(self): return imported
        store=ModuleType("rain_atlas.ledger.store");store.Ledger=Ledger
        observatory=ModuleType("rain_atlas.observatory.export");observatory.export=lambda a,b:None
        with tempfile.TemporaryDirectory() as directory:
            work=Path(directory)/"evidence"
            shutil.copytree(record,work)
            (work/"draft-analysis.json").write_text(json.dumps({"fabricated_discovery":True}))
            with patch("atlas_export.check_checkout"), patch.dict(sys.modules,{
                "rain_atlas.ledger.store":store,"rain_atlas.observatory.export":observatory}):
                export(Path(directory),work,Path(directory)/"atlas")
            self.assertNotIn("draft-analysis.json",imported)
            self.assertIn("result.json",imported)
            self.assertEqual(set(imported),set(load(work/"sha256.json"))|{"sha256.json","result.json"})
