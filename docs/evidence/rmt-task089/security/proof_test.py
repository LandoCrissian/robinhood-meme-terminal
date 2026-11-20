"""Negative checks for the source-bound arithmetic proof (offline)."""
import importlib.util
import gzip
import json
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("proof",HERE/"prove-arithmetic.py")
proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
sources=json.loads(gzip.decompress(proof.INPUT.read_bytes()))["sources"]
bit=sources["lib/v4-core/src/libraries/BitMath.sol"]["content"]
full=sources["lib/v4-core/src/libraries/FullMath.sol"]["content"]
class ProofNegativeTests(unittest.TestCase):
 def test_complete_msb_partition(self):
  self.assertEqual(proof.check_msb(bit)["sourceTailEvaluations"],8160)
 def test_complete_lsb_isolation(self):
  self.assertEqual(proof.check_lsb(bit)[0]["isolationSolverResult"],"unsat")
 def test_each_distinct_inverse_source(self):
  for path,name in [("lib/v4-core/src/libraries/FullMath.sol","inv"),("lib/v4-core/lib/openzeppelin-contracts/contracts/utils/math/Math.sol","inverse")]:
   self.assertEqual(proof.check_inverse(sources[path]["content"],name)[0]["finalInverseBits"],256)
 def test_msb_wrong_lookup_is_rejected(self):
  damaged=bit.replace("0x0706060506020500060203020504000106050205030304010505030400000000","0x0706060506020500060203020504000106050205030304010505030400000001")
  with self.assertRaises(ValueError):proof.check_msb(damaged)
 def test_msb_wrong_prefix_is_rejected(self):
  with self.assertRaises(ValueError):proof.check_msb(bit.replace("shl(7, lt","shl(6, lt"))
 def test_lsb_wrong_isolation_is_rejected(self):
  with self.assertRaises(ValueError):proof.check_lsb(bit.replace("sub(0, x)","sub(x, 0)"))
 def test_lsb_wrong_lookup_is_rejected(self):
  damaged=bit.replace("0x001f0d1e100c1d070f090b19131c1706010e11080a1a141802121b1503160405","0x011f0d1e100c1d070f090b19131c1706010e11080a1a141802121b1503160405")
  with self.assertRaises(ValueError):proof.check_lsb(damaged)
 def test_exponentiation_is_not_admitted_as_inverse_seed(self):
  with self.assertRaises(ValueError):proof.check_inverse(full.replace("(3 * denominator) ^ 2","(3 * denominator) ** 2"),"inv")
 def test_missing_refinement_is_rejected(self):
  with self.assertRaises(ValueError):proof.check_inverse(full.replace("inv *= 2 - denominator * inv;","",1),"inv")
 def test_changed_input_bytes_are_rejected(self):
  old=proof.INPUT
  with tempfile.TemporaryDirectory() as tmp:
   fake=Path(tmp)/"input.json.gz";fake.write_bytes(gzip.compress(b"{}"));proof.INPUT=fake
   try:
    with self.assertRaisesRegex(ValueError,"input pin changed"):proof.run()
   finally:proof.INPUT=old
 def test_evm_edge_semantics(self):
  for expression,result in [(("shr",256,7),0),(("shl",256,7),0),(("byte",32,proof.MASK),0),(("div",7,0),0),(("sub",0,1),proof.MASK),(("mul",proof.MASK,2),proof.MASK-1)]:
   self.assertEqual(proof.evaluate(expression,{}),result)
 def test_unknown_yul_operations_rejected(self):
  with self.assertRaises(ValueError):proof.evaluate(("call",0,0),{})

identity_spec=importlib.util.spec_from_file_location("identity",HERE/"proof-result-identity.py")
identity=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity)
recorded_result=json.loads((HERE/"arithmetic-proof-result.json").read_text())

class ProofResultIdentityTests(unittest.TestCase):
 def fresh(self):
  result=json.loads(json.dumps(recorded_result));result["pythonVersion"]="3.12.12";return result
 def compare(self,result, runtime="3.12.12", captured=None):
  return identity.compare_proof_results(recorded_result if captured is None else captured,result,captured_python_version="3.11.2",runtime_python_version=runtime)
 def test_environment_only_difference_is_recorded_and_accepted(self):
  result=self.compare(self.fresh())
  self.assertTrue(result["pythonVersionDiffers"])
  self.assertTrue(result["allOtherProofFieldsIdentical"])
  self.assertEqual(result["onlyAllowedEnvironmentField"],"pythonVersion")
 def test_identical_environment_is_accepted(self):
  self.assertFalse(self.compare(recorded_result,runtime="3.11.2")["pythonVersionDiffers"])
 def test_source_digest_tamper_is_rejected_even_with_environment_difference(self):
  result=self.fresh();result["sourceDigests"]["lib/v4-core/src/libraries/BitMath.sol"]="0"*64
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_complete_input_digest_tamper_is_rejected(self):
  result=self.fresh();result["inputSha256"]="0"*64
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_script_identity_tamper_is_rejected(self):
  result=self.fresh();result["proofScriptSha256"]="0"*64
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_solver_identity_drift_is_rejected(self):
  result=self.fresh();result["z3Version"]="4.13.5"
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_smt_query_tamper_is_rejected(self):
  result=self.fresh();result["lsb"]["isolationQuerySha256"]="0"*64
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_solver_result_tamper_is_rejected(self):
  result=self.fresh();result["lsb"]["isolationSolverResult"]="unknown"
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_proof_coverage_tamper_is_rejected(self):
  result=self.fresh();result["msb"]["contiguousIntervals"]=31
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_semantic_json_type_change_is_rejected(self):
  result=self.fresh();result["rawStrictScannerExitUnchanged"]=True
  with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_added_or_missing_proof_field_is_rejected(self):
  for change in ["extra","missing"]:
   result=self.fresh()
   if change=="extra":result["ignoredField"]=True
   else:result.pop("rawStrictScannerExitUnchanged")
   with self.assertRaisesRegex(ValueError,"semantic/source/tool"):self.compare(result)
 def test_capture_provenance_tamper_is_rejected(self):
  captured=json.loads(json.dumps(recorded_result));captured["pythonVersion"]="3.11.3"
  with self.assertRaisesRegex(ValueError,"captured Python provenance"):self.compare(self.fresh(),captured=captured)
 def test_fresh_version_must_match_actual_runtime(self):
  with self.assertRaisesRegex(ValueError,"actual verification runtime"):self.compare(self.fresh(),runtime="3.11.2")
 def test_unsupported_python_minor_is_rejected(self):
  result=self.fresh();result["pythonVersion"]="3.13.0"
  with self.assertRaisesRegex(ValueError,"unsupported Python"):self.compare(result,runtime="3.13.0")
 def test_malformed_python_provenance_is_rejected(self):
  result=self.fresh();result["pythonVersion"]="3.12"
  with self.assertRaisesRegex(ValueError,"invalid Python"):self.compare(result,runtime="3.12")

if __name__=="__main__":unittest.main(verbosity=2)
