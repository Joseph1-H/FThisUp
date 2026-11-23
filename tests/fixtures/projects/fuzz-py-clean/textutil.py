"""A correct library."""

def first_word(s):
    parts = s.split() if isinstance(s, str) else []
    return parts[0] if parts else ""

def collatz_steps(n):
    if not isinstance(n, int) or n < 1:
        raise ValueError("n must be a positive integer")
    steps = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps

def depth(x):
    best, stack = 0, [(x, 1)]
    while stack:
        cur, d = stack.pop()
        if isinstance(cur, list):
            best = max(best, d)
            stack.extend((i, d + 1) for i in cur)
    return best

def normalize(s):
    return s.strip().lower() if isinstance(s, str) else ""

def shout(s):
    return (s.upper() if isinstance(s, str) else "") + "!"
