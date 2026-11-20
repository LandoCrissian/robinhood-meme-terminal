"""Compare all proof identity fields exactly; validate Python provenance separately."""
import re
import json

SUPPORTED_PYTHON_MINORS = {(3, 11), (3, 12)}

def python_version(value):
    if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value):
        raise ValueError("invalid Python version provenance")
    version = tuple(map(int, value.split(".")))
    if version[:2] not in SUPPORTED_PYTHON_MINORS:
        raise ValueError("unsupported Python verification runtime")
    return version

def compare_proof_results(recorded, fresh, *, captured_python_version, runtime_python_version):
    if not isinstance(recorded, dict) or not isinstance(fresh, dict):
        raise ValueError("proof results must be objects")
    python_version(captured_python_version)
    python_version(runtime_python_version)
    if recorded.get("pythonVersion") != captured_python_version:
        raise ValueError("captured Python provenance differs from retained tool manifest")
    if fresh.get("pythonVersion") != runtime_python_version:
        raise ValueError("fresh Python provenance differs from actual verification runtime")
    recorded_semantics = dict(recorded)
    fresh_semantics = dict(fresh)
    recorded_semantics.pop("pythonVersion", None)
    fresh_semantics.pop("pythonVersion", None)
    canonical = lambda value: json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False)
    if canonical(recorded_semantics) != canonical(fresh_semantics):
        raise ValueError("proof semantic/source/tool identity differs from fresh run")
    return {
        "capturedPythonVersion": captured_python_version,
        "verificationPythonVersion": runtime_python_version,
        "onlyAllowedEnvironmentField": "pythonVersion",
        "pythonVersionDiffers": captured_python_version != runtime_python_version,
        "allOtherProofFieldsIdentical": True,
    }
