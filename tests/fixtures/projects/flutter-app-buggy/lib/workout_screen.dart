import 'package:flutter/material.dart';
import 'workout.dart';

class WorkoutScreen extends StatefulWidget {
  const WorkoutScreen({super.key});
  @override
  State<WorkoutScreen> createState() => _WorkoutScreenState();
}

class _WorkoutScreenState extends State<WorkoutScreen> {
  final _repo = WorkoutRepository();
  final _name = TextEditingController();
  final _weight = TextEditingController();
  final _reps = TextEditingController();
  String? _error;
  bool _saving = false;

  Future<void> _save() async {
    final name = _name.text;
    final weight = double.tryParse(_weight.text);
    final reps = int.tryParse(_reps.text);
    if (weight == null) {
      setState(() => _error = 'Enter a weight');
      return;
    }
    if (reps == null || reps <= 0) {
      setState(() => _error = 'Reps must be a positive whole number');
      return;
    }
    setState(() {
      _error = null;
      _saving = true;
    });
    await _repo.add(Workout(name, weight, reps));
    setState(() => _saving = false);
  }

  @override
  void dispose() {
    _name.dispose();
    _weight.dispose();
    _reps.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = _repo.all();
    return Scaffold(
      appBar: AppBar(title: const Text('Log workout')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(key: const Key('exercise_name'), controller: _name, decoration: const InputDecoration(labelText: 'Exercise')),
            TextField(key: const Key('weight'), controller: _weight, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Weight (kg)')),
            TextField(key: const Key('reps'), controller: _reps, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Reps')),
            if (_error != null) Text(_error!, key: const Key('error_text')),
            ElevatedButton(key: const Key('save_button'), onPressed: _save, child: const Text('Save workout')),
            if (_saving) const Text('Saving...'),
            Expanded(
              child: ListView(
                children: [
                  for (var i = 0; i < items.length; i++)
                    Row(key: ValueKey('entry_$i'), children: [Text(items[i].name), Text('  ${items[i].weight} kg x ${items[i].reps}')]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
