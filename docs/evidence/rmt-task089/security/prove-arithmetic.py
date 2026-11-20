"""Source-bound proofs of four reported arithmetic expressions; no network or EVM mutation."""
from __future__ import annotations
import gzip, hashlib, json, re, sys, time
from pathlib import Path
import z3

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
INPUT = ROOT / "docs/evidence/rmt-task088b/security/fixed-supply-4663.json.gz"
PIN = "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10"
MASK = (1 << 256) - 1
SOURCES = {
 "lib/v4-core/src/libraries/FullMath.sol": "a9607255a6fd604d9c92f6b7416811c38b9d86e5dfdb0c345a494ebd35f7a4a3",
 "lib/v4-core/lib/openzeppelin-contracts/contracts/utils/math/Math.sol": "a6ee779fc42e6bf01b5e6a963065706e882b016affbedfd8be19a71ea48e6e15",
 "lib/v4-core/src/libraries/BitMath.sol": "e8a45eb3d57f9427fc47bbb2543c1a6a5f394113b378123ac7ca9f113a7502b4",
}
def sha(data): return hashlib.sha256(data).hexdigest()
def require(ok, message):
 if not ok: raise ValueError(message)
def clean(text):
 return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)
def body(text, name):
 start = text.index("function " + name + "(")
 at = text.index("{", start)
 depth = 1
 end = at + 1
 while depth:
  require(end < len(text), "unterminated function")
  depth += (text[end] == "{") - (text[end] == "}")
  end += 1
 return text[at + 1:end - 1]
def parse_yul(text, name):
 function = body(clean(text), name)
 require("require(x > 0);" in function, "nonzero input precondition changed")
 at = function.index("{", function.index("assembly"))
 asm = function[at + 1:function.index("}", at)]
 tokens = re.findall(r"0x[0-9a-fA-F]+|[0-9]+|[a-zA-Z_][a-zA-Z_0-9]*|:=|[(),]", asm)
 require(re.sub(r"\s+", "", asm) == "".join(tokens), "unrecognized Yul syntax")
 i = 0
 def expr():
  nonlocal i
  value = tokens[i]; i += 1
  if value.startswith("0x") or value.isdecimal(): return int(value, 0) if value.startswith("0x") else int(value)
  if i < len(tokens) and tokens[i] == "(":
   i += 1; args = []
   while tokens[i] != ")":
    args.append(expr())
    if tokens[i] != ")": require(tokens[i] == ",", "bad argument separator"); i += 1
   i += 1
   return (value, *args)
  return value
 statements = []
 while i < len(tokens):
  name = tokens[i]; i += 1
  require(tokens[i] == ":=", "expected exact assignment"); i += 1
  statements.append((name, expr()))
 return statements
ARITY = {"lt":2,"shl":2,"shr":2,"or":2,"and":2,"byte":2,"div":2,"mul":2,"sub":2}
def evaluate(expr, env):
 if isinstance(expr, int): return expr
 if isinstance(expr, str): return env[expr]
 op, *args = expr
 require(op in ARITY and len(args) == ARITY[op], "unsupported Yul operation")
 a,b = [evaluate(arg, env) for arg in args]
 if op == "lt": return int(a < b)
 if op == "shl": return 0 if a >= 256 else (b << a) & MASK
 if op == "shr": return 0 if a >= 256 else b >> a
 if op == "or": return a | b
 if op == "and": return a & b
 if op == "byte": return 0 if a >= 32 else (b >> ((31-a)*8)) & 255
 if op == "div": return 0 if b == 0 else a // b
 if op == "mul": return (a*b) & MASK
 if op == "sub": return (a-b) & MASK
 raise AssertionError(op)
def interval(expr, env):
 if isinstance(expr,int): return (expr,expr)
 if isinstance(expr,str): return env[expr]
 op,*args = expr; values=[interval(a,env) for a in args]; (al,ah),(bl,bh)=values
 if op=="lt":
  if ah < bl:return (1,1)
  if al >= bh:return (0,0)
  raise ValueError("comparison not constant over this complete bucket")
 if op in ("shl","shr"):
  require(al==ah and al < 256, "nonconstant/large prefix shift")
  if op=="shr":return (bl>>al,bh>>al)
  require((bh<<al)<=MASK,"prefix overflow")
  return (bl<<al,bh<<al)
 if al==ah and bl==bh:
  v=evaluate(expr,{k:v[0] for k,v in env.items()})
  return (v,v)
 raise ValueError("unsupported interval expression")
def replace_normalized_x(expr):
 if expr == ("shr","r","x"): return "z"
 if isinstance(expr,tuple): return tuple(replace_normalized_x(v) for v in expr)
 return expr
def variables(expr):
 if isinstance(expr,int):return set()
 if isinstance(expr,str):return {expr}
 return set().union(*(variables(a) for a in expr[1:]))
def check_msb(text):
 statements = parse_yul(text,"mostSignificantBit")
 require(len(statements)==6 and all(name=="r" for name,_ in statements), "MSB program shape changed")
 final=replace_normalized_x(statements[-1][1])
 require(variables(final)=={"r","z"}, "tail can depend only on fixed prefix and normalized byte")
 # Thirty-two contiguous intervals partition every nonzero uint256.
 buckets=[]; evaluations=0; next_low=1
 for bucket in range(32):
  low=1 << (8*bucket); high=(1 << (8*bucket+8))-1
  require(low==next_low and high<=MASK,"noncontiguous/overflowing partition")
  env={"x":(low,high),"r":(0,0)}
  for name,expr in statements[:-1]: env[name]=interval(expr,env)
  require(env["r"]==(8*bucket,8*bucket),"incorrect prefix on a complete interval")
  require(interval(("shr","r","x"),env)==(1,255),"normalization does not cover one byte")
  for z in range(1,256):
   result=evaluate(final,{"r":8*bucket,"z":z})
   require(result==8*bucket+z.bit_length()-1,"MSB tail differs from independent bit length")
   evaluations+=1
  buckets.append({"low":str(low),"high":str(high),"prefix":8*bucket})
  next_low=high+1
 require(next_low==1<<256,"partition incomplete")
 return {"completeInputDomain":"all nonzero uint256","contiguousIntervals":32,"residualInputsPerInterval":255,"sourceTailEvaluations":evaluations,"partitionSha256":sha(json.dumps(buckets,sort_keys=True).encode()),"result":"PROVED"}
def check_lsb(text):
 statements=parse_yul(text,"leastSignificantBit")
 require(len(statements)==3,"LSB program shape changed")
 require(statements[0]==("x",("and","x",("sub",0,"x"))),"isolation expression changed")
 require([a for a,_ in statements[1:]]==["r","r"],"LSB tail must preserve isolated input")
 x=z3.BitVec("x",256); isolated=x & -x
 solver=z3.Solver();solver.set(timeout=30000)
 solver.add(x!=0,z3.Or(isolated==0,(isolated&(isolated-1))!=0,(isolated&x)!=isolated,(x&(isolated-1))!=0))
 query=solver.to_smt2();result=solver.check()
 require(result==z3.unsat,"isolation theorem did not prove UNSAT: "+str(result))
 # Isolation theorem reduces every nonzero uint256 to exactly one of these 256 values.
 for index in range(256):
  env={"x":1<<index,"r":0}
  for name,expr in statements:env[name]=evaluate(expr,env)
  require(env["r"]==index,"LSB exact source tail differs from independent one-hot index")
 return {"completeInputDomain":"all nonzero uint256","isolationSolverResult":str(result),"isolationQuerySha256":sha(query.encode()),"exhaustiveIsolatedInputs":256,"result":"PROVED"},query
def poly_add(a,b):
 out=dict(a)
 for monomial,value in b.items():out[monomial]=out.get(monomial,0)+value
 return {k:v for k,v in out.items() if v}
def poly_mul(a,b):
 out={}
 for (da,ia),ca in a.items():
  for (db,ib),cb in b.items():
   key=(da+db,ia+ib);out[key]=out.get(key,0)+ca*cb
 return {k:v for k,v in out.items() if v}
def check_inverse(text, name):
 function=body(clean(text),"mulDiv")
 require("unchecked {" in function,"modular arithmetic context changed")
 require(re.search(r"uint256 "+name+r"\s*=\s*\(3 \* denominator\) \^ 2;",function) is not None,"exact XOR seed changed")
 require(len(re.findall(name+r" \*= 2 - denominator \* "+name+r";",function))==6,"six exact Newton refinements required")
 require("denominator := div(denominator, twos)" in function,"odd-denominator reduction changed")
 d=z3.BitVec("denominator",4)
 solver=z3.Solver();solver.add((d&1)==1,d*((3*d)^2)!=1)
 seed_query=solver.to_smt2();result=solver.check();require(result==z3.unsat,"four-bit inverse seed not universal")
 # Exact polynomial certificate: 1 - d*[i*(2-d*i)] == (1-d*i)^2 over Z,
 # therefore over every 2^n modular ring. This proves each precision doubling.
 one={(0,0):1};di={(1,1):1}
 error=poly_add(one,{k:-v for k,v in di.items()})
 square=poly_mul(error,error)
 updated=poly_mul({(0,1):1},poly_add({(0,0):2},{(1,1):-1}))
 lhs=poly_add(one,{k:-v for k,v in poly_mul({(1,0):1},updated).items()})
 require(lhs==square,"Newton error-squaring polynomial identity failed")
 bits=4
 for _ in range(6):bits*=2
 require(bits==256,"not enough refinements")
 return {"completeSeedDomain":"all eight odd residues modulo16; therefore all odd uint256 denominators","seedSolverResult":str(result),"seedQuerySha256":sha(seed_query.encode()),"refinements":6,"finalInverseBits":bits,"identity":"1-d*(i*(2-d*i))=(1-d*i)^2","result":"PROVED"},seed_query
def run():
 raw=gzip.decompress(INPUT.read_bytes());require(sha(raw)==PIN,"complete compiler input pin changed")
 sources=json.loads(raw)["sources"];require(len(sources)==66,"source closure size changed")
 for path,digest in SOURCES.items():require(sha(sources[path]["content"].encode())==digest,"dependency bytes changed: "+path)
 bit=sources["lib/v4-core/src/libraries/BitMath.sol"]["content"]
 lsb,lsb_query=check_lsb(bit)
 full,full_query=check_inverse(sources["lib/v4-core/src/libraries/FullMath.sol"]["content"],"inv")
 oz,oz_query=check_inverse(sources["lib/v4-core/lib/openzeppelin-contracts/contracts/utils/math/Math.sol"]["content"],"inverse")
 result={"schemaVersion":1,"sourceCommit":"78a76feb592ac136dbf74d4823c21db64a6d0313","inputSha256":PIN,"sourceDigests":SOURCES,"z3Version":z3.get_version_string(),"pythonVersion":sys.version.split()[0],"proofScriptSha256":sha(Path(__file__).read_bytes()),"msb":check_msb(bit),"lsb":lsb,"fullMathInverse":full,"openZeppelinInverse":oz,"reportedExpressionsIndependentlyDisproven":4,"statefulFindingsCleared":0,"rawHighFindingCountUnchanged":22,"rawStrictScannerExitUnchanged":1,"financialGate":"BLOCKED_NO_BROADCAST","limits":["This proves the four reported expressions only, not whole dependency implementations, compiler correctness, source-to-deployed identity or all protocol properties.","The 18 stateful balance findings remain unresolved in this new stage-specific disposition; finite passing synthetic tests are supporting evidence, not a proof of absence."]}
 if "--write" in sys.argv:
  (HERE/"arithmetic-proof-result.json").write_text(json.dumps(result,indent=2)+"\n")
  for name,query in [("lsb-isolation.smt2",lsb_query),("fullmath-seed.smt2",full_query),("openzeppelin-seed.smt2",oz_query)]:(HERE/name).write_text(query)
 print(json.dumps(result,indent=2))
 return result
if __name__=="__main__":run()
