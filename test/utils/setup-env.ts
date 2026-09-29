// Loaded before any e2e module (jest `setupFiles`), so it runs before
// ConfigModule reads the environment. Only the global rate limit is relaxed —
// suites send many requests from one "IP"; per-route limits (login etc.) stay.
process.env.THROTTLE_GLOBAL_LIMIT = '10000';
