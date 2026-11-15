export const ROUTINES = [
    {
        key: 'mobility', title: 'Mobility', category: 'Stretching', duration: 'About 5 min',
        steps: [
            'Start in a stable, comfortable position.',
            'Move your shoulders, wrists, and ankles gently through a comfortable range.',
            'Finish with a few relaxed stretches.',
        ],
    },
    {
        key: 'light-cardio', title: 'Light Cardio', category: 'Light', duration: 'About 10 min',
        steps: [
            'Choose a comfortable walk or stationary cycle.',
            'Build up to an easy pace, then keep it steady for the session.',
            'Slow down and cool down before finishing.',
        ],
    },
    {
        key: 'steady-cardio', title: 'Steady Cardio', category: 'Moderate', duration: 'About 15 min',
        steps: [
            'Warm up at an easy pace.',
            'Walk or cycle at a steady, comfortable effort.',
            'Return to an easy pace to cool down.',
        ],
    },
    {
        key: 'resistance', title: 'Resistance', category: 'Strength', duration: 'About 10 min',
        steps: [
            'Set up a resistance band or other familiar equipment.',
            'Perform the resistance movements in your routine with controlled form.',
            'Put the equipment away and finish with gentle movement.',
        ],
    },
] as const;

export const routineTitle = new Map<string, string>(ROUTINES.map(routine => [routine.key, routine.title]));
