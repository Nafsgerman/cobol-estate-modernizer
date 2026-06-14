const RETRYABLE_MESSAGES = [
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "timeout exceeded when trying to connect",
  "Client has encountered a connection error",
  "server closed the connection unexpectedly",
];
const RETRYABLE_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED",
  "57P01", "08000", "08001", "08003", "08006",
]);

function isRetryable(err: unknown): boolean {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: string }).code;
    if (code && RETRYABLE_CODES.has(code)) return true;
    const msg = (cur as { message?: string }).message ?? "";
    if (RETRYABLE_MESSAGES.some((m) => msg.includes(m))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  const backoff = [200, 600];
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) throw err;
      console.warn(
        `[db] retryable error (attempt ${i + 1}/${attempts}), retrying:`,
        (err as { message?: string }).message,
      );
      await sleep(backoff[i] ?? 600);
    }
  }
  throw lastErr;
}