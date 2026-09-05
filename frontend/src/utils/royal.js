/**
 * Royal personalization — the voice of the kingdom.
 *
 * Shared across the whole app so every screen greets the guest the same
 * regal, time-aware way. Honorifics are gender-neutral by design.
 */

// Gender-neutral royal honorifics.
const HONORIFICS = ["Your Highness", "Your Majesty", "Your Grace"];

// Rotating royal blessings — a daily flourish under the greeting.
export const ROYAL_BLESSINGS = [
  "Your treasury stands guarded and ready.",
  "The court awaits your command.",
  "May your coffers only ever rise.",
  "Every coin in your name, accounted for.",
  "The kingdom moves at your word.",
  "Fortune favours the well-counted.",
];

export const HOST = "Akshay Dhankhar";

/** First name only — feels personal, never a clunky full name or handle. */
export function firstNameOf(name) {
  return String(name || "Guest").trim().split(/\s+/)[0] || "Guest";
}

/** Time-aware greeting + a matching icon. */
export function timeOfDay(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return { greeting: "Still awake", icon: "🌙" };
  if (h < 12) return { greeting: "Good morning", icon: "🌅" };
  if (h < 17) return { greeting: "Good afternoon", icon: "🌤️" };
  if (h < 21) return { greeting: "Good evening", icon: "🌇" };
  return { greeting: "Good night", icon: "🌙" };
}

/** Stable honorific for a given name (won't flicker between renders). */
export function honorificFor(name = "") {
  const sum = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return HONORIFICS[sum % HONORIFICS.length];
}

/** A blessing that changes once per day, stable through the day. */
export function blessingOfDay(d = new Date()) {
  const dayIndex = Math.floor(d.getTime() / 86400000);
  return ROYAL_BLESSINGS[dayIndex % ROYAL_BLESSINGS.length];
}

/**
 * One call → everything a screen needs to greet the guest royally.
 * @param {string} name  the guest's name or username
 */
export function royalGreeting(name) {
  const first = firstNameOf(name);
  const { greeting, icon } = timeOfDay();
  return {
    first,
    greeting,
    icon,
    honorific: honorificFor(first),
    blessing: blessingOfDay(),
    host: HOST,
  };
}
