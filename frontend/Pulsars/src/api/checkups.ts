import type { Checkup } from "../components/Checkups";

// Placeholder data shared by the dashboard and the checkups page.
// Replace with API later.
export const INITIAL_CHECKUPS: Checkup[] = [
  {
    id: "sleep",
    title: "Sleep quality questionnaire",
    dueLabel: "Due Today",
    duration: "About 5 min",
    completed: false,
    dueToday: true,
    instructions: [
      "Find a quiet place and sit comfortably.",
      "Think about last night, from when you went to bed until you woke up.",
      "Answer honestly. There are no right or wrong answers.",
      "You can go back to change an answer before you finish.",
    ],
    questions: [
      {
        id: "hours",
        type: "number",
        prompt: "How many hours did you sleep last night?",
        unit: "hours",
        min: 0,
        max: 24,
      },
      {
        id: "quality",
        type: "scale",
        prompt: "How would you rate your sleep quality?",
        min: 1,
        max: 5,
        minLabel: "Very poor",
        maxLabel: "Excellent",
      },
      {
        id: "wakeups",
        type: "choice",
        prompt: "How many times did you wake up during the night?",
        options: ["Not at all", "1 or 2 times", "3 or more times"],
      },
      {
        id: "rested",
        type: "choice",
        prompt: "Do you feel rested this morning?",
        options: ["Yes", "Somewhat", "No"],
      },
      {
        id: "notes",
        type: "text",
        prompt: "Is there anything else you want to note about your sleep?",
        placeholder: "Optional",
        required: false,
      },
    ],
  },
  {
    id: "bp",
    title: "Blood pressure check",
    dueLabel: "Due Today",
    duration: "About 3 min",
    completed: true,
    instructions: [
      "Sit down and rest quietly for 5 minutes.",
      "Keep your feet flat and your back supported.",
      "Place the cuff on your bare upper arm, level with your heart.",
      "Stay still and do not talk while the reading is taken.",
    ],
    questions: [
      {
        id: "systolic",
        type: "number",
        prompt: "What is the top number (systolic)?",
        unit: "mmHg",
        min: 50,
        max: 250,
      },
      {
        id: "diastolic",
        type: "number",
        prompt: "What is the bottom number (diastolic)?",
        unit: "mmHg",
        min: 30,
        max: 150,
      },
      {
        id: "position",
        type: "choice",
        prompt: "What position were you in?",
        options: ["Sitting", "Standing", "Lying down"],
      },
    ],
  },
  {
    id: "sugar",
    title: "Blood sugar check",
    dueLabel: "Due 11/11",
    duration: "About 3 min",
    completed: true,
    instructions: [
      "Wash and dry your hands.",
      "Prepare your meter and a new test strip.",
      "Use the side of your fingertip for the sample.",
      "Wait for the reading to appear on the meter.",
    ],
    questions: [
      {
        id: "glucose",
        type: "number",
        prompt: "What does the meter show?",
        unit: "mg/dL",
        min: 20,
        max: 600,
      },
      {
        id: "timing",
        type: "choice",
        prompt: "When did you take this reading?",
        options: ["Fasting", "Before a meal", "After a meal", "Bedtime"],
      },
    ],
  },
  {
    id: "weight",
    title: "Weight check",
    dueLabel: "Due 11/10",
    duration: "About 3 min",
    completed: true,
    past: true,
    instructions: [
      "Place the scale on a flat, hard floor.",
      "Weigh yourself without shoes and in light clothing.",
      "Try to weigh yourself at the same time of day each time.",
    ],
    questions: [
      {
        id: "weight",
        type: "number",
        prompt: "What does the scale show?",
        unit: "kg",
        min: 20,
        max: 400,
      },
    ],
  },
];