def add(a, b):
    return a - b   # BUG: wrong operator

def safe_div(a, b):
    return a / b   # BUG: no zero check -> ZeroDivisionError

def first_word(s):
    return s.split()[0]
