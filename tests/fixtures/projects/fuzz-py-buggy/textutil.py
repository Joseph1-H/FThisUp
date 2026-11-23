"""INTENTIONALLY BUGGY library used to test FThisUp."""
import ctypes

def first_word(s):
    return s.split()[0]                      # BUG: IndexError on '' / ' '

def collatz_steps(n):
    steps = 0
    while n != 1:                            # BUG: never terminates for n <= 0
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps

def depth(x):
    if isinstance(x, list):                  # BUG: recursion blows the stack on deeply nested input
        return 1 + max([depth(i) for i in x] or [0])
    return 0

def normalize(s):
    if s == "":
        ctypes.string_at(0)                  # BUG: native crash (segfault) on empty input
    return s.strip().lower()

def shout(s):
    return str(s).upper() + "!"
