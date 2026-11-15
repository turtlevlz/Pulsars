import { HttpError } from '../../middleware/errors.js';

// Slows down password guessing: after MAX_FAILURES wrong passwords for one email from one
// address, further attempts are refused until the window has passed. In memory, so it resets
// when the server restarts and is per process; that is enough for a single-instance backend.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const MAX_ENTRIES = 10_000;

const failures = new Map<string, { count: number; since: number }>();

const keyFor = (ip: string | undefined, email: string) => `${ip ?? 'unknown'}|${email}`;

function prune(now: number) {
    for (const [key, entry] of failures) if (now - entry.since >= WINDOW_MS) failures.delete(key);
}

/** Throws 429 if this address has used up its attempts for this email. */
export function assertNotThrottled(ip: string | undefined, email: string, now = Date.now()): void {
    const entry = failures.get(keyFor(ip, email));
    if (!entry) return;
    if (now - entry.since >= WINDOW_MS) {
        failures.delete(keyFor(ip, email));
        return;
    }
    if (entry.count >= MAX_FAILURES) {
        const retryAfter = Math.ceil((entry.since + WINDOW_MS - now) / 1000);
        throw new HttpError(429, 'Too many failed sign-in attempts. Try again later.', { retryAfterSeconds: retryAfter }, {
            'Retry-After': String(retryAfter),
        });
    }
}

export function recordFailure(ip: string | undefined, email: string, now = Date.now()): void {
    if (failures.size >= MAX_ENTRIES) prune(now);
    const key = keyFor(ip, email);
    const entry = failures.get(key);
    if (!entry || now - entry.since >= WINDOW_MS) failures.set(key, { count: 1, since: now });
    else entry.count++;
}

export function clearFailures(ip: string | undefined, email: string): void {
    failures.delete(keyFor(ip, email));
}

/** For tests. */
export function resetThrottle(): void {
    failures.clear();
}
