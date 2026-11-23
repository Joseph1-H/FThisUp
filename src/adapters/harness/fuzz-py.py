# FThisUp function-level fuzz harness (Python). Runs INSIDE the OS sandbox when available.
# usage: python3 fuzz-py.py '<json config>'   (config: modules[], timeoutMs, maxCalls, maxFunctions, skip[], only[])
import importlib.util, inspect, json, os, re, signal, sys, traceback

cfg = json.loads(sys.argv[1])
DESTRUCTIVE = re.compile(r"(delete|remove|drop|kill|exit|reset|clear|write|save|send|publish|deploy|unlink|rmdir|destroy|truncate|format|install|exec|spawn|fetch|request|post|upload|connect)", re.I)

def out(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()

class _Timeout(BaseException):
    pass

def _alarm(signum, frame):
    raise _Timeout()

has_alarm = hasattr(signal, "setitimer")
if has_alarm:
    signal.signal(signal.SIGALRM, _alarm)

def nested(d):
    o = []
    for _ in range(d):
        o = [o]
    return o

POOL = [
    ("empty string", "", True, 0), ("single space", " ", True, 1), ("long string (100k)", "A" * 100000, True, 100000),
    ("unicode/emoji", "Ünïcödé 日本語 🚀🔥 👨‍👩‍👧‍👦", True, 20), ("NUL and control chars", "a\x00b\x01\x1f", True, 5), ("lone surrogate", "\ud800", True, 1),
    ("zero", 0, True, 0), ("negative one", -1, True, 0), ("2**63", 2 ** 63, True, 0), ("huge int (5000 digits)", 10 ** 5000, True, 5000),
    ("float nan", float("nan"), True, 0), ("float inf", float("inf"), True, 0), ("-0.0", -0.0, True, 0),
    ("None", None, False, 0), ("True", True, False, 0), ("empty list", [], False, 0), ("list [None]", [None], False, 1), ("empty dict", {}, False, 0), ("dict {'a':1}", {"a": 1}, False, 1),
    ("huge list (100k)", list(range(100000)), False, 100000), ("deeply nested list (2000)", nested(2000), False, 2000), ("bytes ff", b"\xff\xfe", False, 2), ("object()", object(), False, 0), ("lambda", lambda: 1, False, 0),
]

def calls_for(arity):
    k = max(1, min(arity, 3))
    for i in range(k):
        for (desc, val, edge, size) in POOL:
            args = [1] * k
            args[i] = val
            yield (args, ("arg%d=%s" % (i + 1, desc)) if k > 1 else desc, edge, size)
    if k > 1:
        for (desc, val, edge, size) in POOL:
            yield ([val] * k, "all args=" + desc, edge, size)

def arity_of(f):
    try:
        sig = inspect.signature(f)
    except (TypeError, ValueError):
        return 1
    n = 0
    for p in sig.parameters.values():
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is p.empty:
            n += 1
        elif p.kind == p.VAR_POSITIONAL:
            n = max(n, 1)
    return max(1, n)

only = set(cfg.get("only") or [])
skip = set(cfg.get("skip") or [])
total = 0
nfn = 0
for path in cfg["modules"]:
    name = "fthisup_target_" + re.sub(r"\W", "_", os.path.splitext(os.path.basename(path))[0])
    sys.path.insert(0, os.path.dirname(path))
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:
        out({"t": "load-error", "module": path, "name": type(e).__name__, "message": str(e)[:300]})
        continue
    fns = [(n, f) for n, f in inspect.getmembers(mod, inspect.isfunction) if not n.startswith("_") and f.__module__ == name]
    out({"t": "functions", "module": path, "names": [n for n, _ in fns]})
    for fname, f in fns:
        if nfn >= cfg["maxFunctions"]:
            break
        full = os.path.basename(path) + ":" + fname
        if only and full not in only:
            continue
        if DESTRUCTIVE.search(fname):
            out({"t": "skip-fn", "fn": full, "reason": "name suggests side effects (not fuzzed)"}); continue
        if inspect.iscoroutinefunction(f) or inspect.isgeneratorfunction(f):
            out({"t": "skip-fn", "fn": full, "reason": "async/generator functions are not fuzzed"}); continue
        nfn += 1
        allc = list(calls_for(arity_of(f)))
        stride = max(1, -(-len(allc) // cfg["maxCalls"]))
        hangs = 0
        for c in range(0, len(allc), stride):
            args, desc, edge, size = allc[c]
            key = "%s#%d" % (full, c)
            if key in skip:
                continue
            if hangs >= 2:
                break  # two hangs already prove the point; more would only burn time
            out({"t": "start", "fn": full, "key": key, "desc": desc, "edge": edge, "size": size})
            outcome, ename, emsg, recursion = "returned", None, None, False
            try:
                if has_alarm:
                    signal.setitimer(signal.ITIMER_REAL, cfg["timeoutMs"] / 1000.0)
                f(*args)
            except _Timeout:
                outcome = "hang"
            except RecursionError as e:
                outcome, ename, emsg = "threw", "RecursionError", str(e)[:200]
                try:
                    # is the PROJECT'S code recursing (same frame repeated many times), or a builtin (repr/str/json) hitting the limit?
                    counts = {}
                    for fr in traceback.extract_tb(e.__traceback__):
                        if fr.filename.startswith(os.path.dirname(path)):
                            k = (fr.filename, fr.lineno); counts[k] = counts.get(k, 0) + 1
                    recursion = bool(counts) and max(counts.values()) >= 20
                except BaseException:
                    recursion = False
            except BaseException as e:
                outcome, ename, emsg = "threw", type(e).__name__, str(e)[:240]
            finally:
                if has_alarm:
                    signal.setitimer(signal.ITIMER_REAL, 0)
            if outcome == "hang":
                hangs += 1
            total += 1
            out({"t": "end", "fn": full, "key": key, "outcome": outcome, "name": ename, "message": emsg, "recursion": recursion})
out({"t": "done", "calls": total})
