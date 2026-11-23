class Workout {
  Workout(this.name, this.weight, this.reps);
  final String name;
  final double weight;
  final int reps;
}

/// In-memory stand-in for a real database; saving takes a little while like a network round trip.
class WorkoutRepository {
  final List<Workout> _items = [];
  Future<void> add(Workout w) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _items.add(w);
  }

  List<Workout> all() => List.unmodifiable(_items);
}
