import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_clean/counter.dart';
void main() {
  test('increments', () { final c = Counter()..inc(); expect(c.value, 1); });
  test('skipped', () {}, skip: true);
}
