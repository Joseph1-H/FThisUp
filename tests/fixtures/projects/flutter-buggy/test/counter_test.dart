import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_buggy/counter.dart';
void main() {
  test('increments', () { final c = Counter()..inc(); expect(c.value, 1); });
  test('ok', () { expect(1, 1); });
  test('throws', () { throw StateError('boom'); });
}
