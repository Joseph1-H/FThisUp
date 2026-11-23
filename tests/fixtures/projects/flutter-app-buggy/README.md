# Workout Log

A tiny workout logger.

## Requirements
- Every workout needs an exercise name. An empty name must be rejected with an error message.
- Weight must be a positive number (kg). Zero or negative weights are rejected.
- Reps must be a positive whole number.
- A workout is saved exactly once per save request. While a save is in progress the Save button is disabled.
- Long exercise names must never break the layout of the history list.
- Leaving the screen while a save is in progress must not cause errors.
