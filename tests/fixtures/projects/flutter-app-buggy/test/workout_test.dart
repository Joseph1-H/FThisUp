import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:workout_log/workout.dart';
import 'package:workout_log/workout_screen.dart';

void main() {
  test('repository stores a workout', () async {
    final r = WorkoutRepository();
    await r.add(Workout('Squat', 100, 5));
    expect(r.all().length, 1);
  });

  testWidgets('saves a valid workout and lists it', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: WorkoutScreen()));
    await tester.enterText(find.byKey(const Key('exercise_name')), 'Squat');
    await tester.enterText(find.byKey(const Key('weight')), '100');
    await tester.enterText(find.byKey(const Key('reps')), '5');
    await tester.tap(find.byKey(const Key('save_button')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const ValueKey('entry_0')), findsOneWidget);
  });

  testWidgets('rejects non-numeric reps', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: WorkoutScreen()));
    await tester.enterText(find.byKey(const Key('weight')), '100');
    await tester.enterText(find.byKey(const Key('reps')), 'abc');
    await tester.tap(find.byKey(const Key('save_button')));
    await tester.pump();
    expect(find.byKey(const Key('error_text')), findsOneWidget);
  });
}
