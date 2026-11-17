export const ROUTINES = [
    {
        key: 'mobility', title: 'Mobility', category: 'Stretching', duration: 'About 5 min',
        steps: [
            'Shoulder rolls · 1 minute. Sit tall in a stable chair. Slowly roll your shoulders backward 10 times, then forward 10 times.',
            'Seated turns · 2 minutes. Cross your arms and turn gently to one side. Hold for 5 seconds, then return to center. Alternate sides for 5 turns each.',
            'Chest stretch · 1 minute. Open your arms out to the sides until you feel a gentle stretch. Hold for 15 seconds, relax for 5 seconds, and repeat twice.',
            'Ankle pumps · 1 minute. Lift one foot slightly. Point your toes away, then pull them toward your shin. Do 10 pumps per foot.',
        ],
    },
    {
        key: 'light-cardio', title: 'Light Cardio', category: 'Light', duration: 'About 10 min',
        steps: [
            'Warm-up · 2 minutes. Walk on level ground, march in place, or pedal a stationary bike at an easy pace.',
            'Easy pace · 6 minutes. Continue the same movement at a pace that lets you have a conversation comfortably.',
            'Cool-down · 2 minutes. Gradually slow down before stopping.',
        ],
    },
    {
        key: 'steady-cardio', title: 'Steady Cardio', category: 'Moderate', duration: 'About 15 min',
        steps: [
            'Warm-up · 3 minutes. Walk, march in place, or pedal a stationary bike. Start easy and increase your pace gradually.',
            'Steady effort · 9 minutes. Keep a pace that makes you breathe faster while you can still speak in full sentences.',
            'Cool-down · 3 minutes. Gradually ease back to a slow walk or easy pedal.',
        ],
    },
    {
        key: 'resistance', title: 'Resistance', category: 'Strength', duration: 'About 10 min',
        steps: [
            'Warm-up · 2 minutes. March in place at an easy pace and loosen your shoulders with slow rolls.',
            'Chair sit-to-stands · 2 sets of 8. Sit on a stable chair with your feet flat. Stand, then lower slowly to the seat. Rest 30 seconds between sets.',
            'Wall push-ups · 2 sets of 8. Place your palms on the wall at shoulder height. Bend your elbows to move toward the wall, then press away. Rest 30 seconds between sets.',
            'Calf raises · 2 sets of 8. Hold a stable chair for balance. Lift both heels, pause briefly, then lower slowly. Rest 30 seconds between sets.',
            'Cool-down · 2 minutes. Walk or march slowly and let your breathing settle.',
        ],
    },
] as const;

export const routineTitle = new Map<string, string>(ROUTINES.map(routine => [routine.key, routine.title]));
