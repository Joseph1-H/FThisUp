import unittest
from calc import add, safe_div, first_word

class TestCalc(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_div(self):
        self.assertEqual(safe_div(6, 3), 2)

    def test_div_zero(self):
        with self.assertRaises(ValueError):
            safe_div(1, 0)

    def test_first_word(self):
        self.assertEqual(first_word("hello world"), "hello")
