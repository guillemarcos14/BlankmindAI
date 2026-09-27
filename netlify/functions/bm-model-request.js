"use strict";

const ERROR_NAMES = new Set(["Error", "TimeoutError", "AbortError", "TypeError", "SyntaxError", "RangeError"]);
const CAUSE_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET", "UND_ERR_ABORTED", "UND_ERR_RESPONSE_STATUS_CODE",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
]);

function nonnegativeNumber(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function usageCounts(usage) {
  const values = {
    input_tokens: usage?.input_tokens,
    output_tokens: usage?.output_tokens,
    total_tokens: usage?.total_tokens,
    cached_input_tokens: usage?.input_tokens_details?.cached_tokens,
    reasoning_tokens: usage?.output_tokens_details?.reasoning_tokens,
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => Number.isSafeInteger(value) && value >= 0));
}

// Metrics contain only allowlisted transport facts. Never retain request bodies,
// generated text, credentials, provider error bodies or arbitrary error messages.
async function readModelJson({ request, timeoutMs, fetchImpl = fetch, errorPrefix, signal, observeMetrics }) {
  const started = Date.now();
  let headersAt = null;
  const metrics = { phase: "headers", budget_ms: timeoutMs, elapsed_ms: 0 };
  const publishMetrics = () => {
    // Observability must never change request success or failure behavior.
    try { if (typeof observeMetrics === "function") observeMetrics(metrics); } catch (_) {}
  };
  publishMetrics();
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      // Native fetch retains this signal while consuming the response body.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    headersAt = Date.now();
    metrics.headers_ms = Math.max(0, headersAt - started);
    metrics.elapsed_ms = metrics.headers_ms;
    if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) metrics.http_status = response.status;
    const requestId = response.headers?.get?.("x-request-id");
    if (typeof requestId === "string" && /^[A-Za-z0-9_-]{1,159}$/.test(requestId)) metrics.request_id = requestId;
    const processingMs = nonnegativeNumber(response.headers?.get?.("openai-processing-ms"));
    if (processingMs != null) metrics.processing_ms = processingMs;
    publishMetrics();
    if (!response.ok) {
      // Release the connection without consuming or copying the error payload.
      // A cancellation error must not hide the original HTTP failure.
      try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch (_) {}
      throw new Error(`${errorPrefix}_http_${response.status}`);
    }
    metrics.phase = "body";
    publishMetrics();
    const body = await response.json();
    metrics.body_ms = Math.max(0, Date.now() - headersAt);
    metrics.phase = "complete";
    metrics.elapsed_ms = Math.max(0, Date.now() - started);
    const usage = usageCounts(body?.usage);
    if (Object.keys(usage).length) metrics.usage = usage;
    publishMetrics();
    return { body, metrics };
  } catch (caught) {
    const error = caught && typeof caught === "object" ? caught : new Error("model_request_failed");
    metrics.elapsed_ms = Math.max(0, Date.now() - started);
    if (headersAt != null && metrics.phase === "body") metrics.body_ms = Math.max(0, Date.now() - headersAt);
    metrics.error_name = ERROR_NAMES.has(error.name) ? error.name : "Error";
    const causeCode = error.cause?.code || error.code;
    if (CAUSE_CODES.has(causeCode)) metrics.cause_code = causeCode;
    publishMetrics();
    error.model_request_metrics = { ...metrics };
    throw error;
  }
}


// The caller validates candidates before resolving attemptFn. Attempts never
// apply product state. A delayed read and any repair share the same two slots.
function runBoundedAttempts({ budgetMs, hedgeAfterMs, minRemainingMs = 1000,
  attemptFn, shouldRetry = () => false, repair = () => {}, isFatal = () => false }) {
  const started = Date.now(), deadline = started + budgetMs;
  const records = [], failures = [], active = new Map(), requestStarted = new Map();
  let settled = false, deadlineTimer, hedgeTimer;
  const remaining = () => deadline - Date.now();
  const clone = value => JSON.parse(JSON.stringify(value));
  const snapshot = () => records.map(record => clone(record));
  const timeoutError = () => new DOMException("Model request deadline exhausted", "TimeoutError");
  return new Promise((resolve, reject) => {
    function finish(error, winner, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(hedgeTimer);
      for (const [attempt, controller] of active) {
        const record = records[attempt - 1];
        record.elapsed_ms = Math.max(0, Date.now() - started - record.started_ms);
        record.outcome = error?.name === "TimeoutError" ? "timed_out" : "cancelled";
        record.cancel_reason = winner ? "winner_selected" : error?.name === "TimeoutError" ? "deadline" : "terminal_error";
        if (record.request_metrics) {
          // Snapshot before abort: native fetch may reject on a later microtask,
          // while an uncooperative transport may never reject at all.
          const metrics = clone(record.request_metrics);
          metrics.elapsed_ms = Math.max(0, Date.now() - requestStarted.get(attempt));
          if (metrics.phase === "body") metrics.body_ms = Math.max(0, metrics.elapsed_ms - (metrics.headers_ms || 0));
          metrics.error_name = record.outcome === "timed_out" ? "TimeoutError" : "AbortError";
          record.request_metrics = metrics;
        }
        if (record.outcome === "timed_out") failures.push({ attempt, error: timeoutError() });
        controller.abort(error?.name === "TimeoutError" ? timeoutError() : new DOMException("Model attempt no longer needed", "AbortError"));
      }
      active.clear();
      const execution = { winner_attempt: winner || null, attempts: snapshot() };
      if (error) {
        error.bounded_attempt_execution = execution;
        error.bounded_attempt_errors = [...failures];
        reject(error);
      } else resolve({ value, execution, errors: [...failures] });
    }
    function launch(trigger) {
      if (settled || records.length >= 2 || (records.length && remaining() < minRemainingMs)) return;
      const attempt = records.length + 1, controller = new AbortController();
      const record = { attempt, trigger, outcome: "running", started_ms: Math.max(0, Date.now() - started) };
      records.push(record);
      active.set(attempt, controller);
      const observeMetrics = metrics => {
        if (settled) return;
        if (!requestStarted.has(attempt)) requestStarted.set(attempt, Date.now() - metrics.elapsed_ms);
        record.request_metrics = metrics;
      };
      // Both fulfillment and rejection handlers remain installed after a winner
      // returns, including for transports that ignore abort or reject late.
      Promise.resolve().then(() => attemptFn({ attempt, trigger, timeoutMs: Math.max(1, remaining()), signal: controller.signal, observeMetrics }))
        .then(({ value, metrics }) => {
          if (settled) return;
          active.delete(attempt);
          record.elapsed_ms = Math.max(0, Date.now() - started - record.started_ms);
          if (metrics) record.request_metrics = metrics;
          if (remaining() <= 0) {
            record.outcome = "timed_out";
            const error = timeoutError(); failures.push({ attempt, error }); finish(error); return;
          }
          record.outcome = "succeeded";
          finish(null, attempt, value);
        }, error => {
          if (settled) return;
          active.delete(attempt);
          record.elapsed_ms = Math.max(0, Date.now() - started - record.started_ms);
          record.outcome = "failed";
          record.error_name = ERROR_NAMES.has(error?.name) ? error.name : "Error";
          if (error?.model_request_metrics) record.request_metrics = error.model_request_metrics;
          failures.push({ attempt, error });
          if (isFatal(error)) { finish(error); return; }
          if (!active.size && records.length < 2 && shouldRetry(error) && remaining() >= minRemainingMs) {
            clearTimeout(hedgeTimer);
            try { repair(error); launch("retry"); } catch (repairError) { finish(repairError); }
          } else if (!active.size) finish(error);
        }).catch(error => finish(error));
    }
    deadlineTimer = setTimeout(() => finish(timeoutError()), budgetMs);
    hedgeTimer = setTimeout(() => launch("hedge"), hedgeAfterMs);
    launch("primary");
  });
}

module.exports = { readModelJson, runBoundedAttempts };
