const buckets = new Map();

export function enforceRateLimit(request, response, options) {
  const now = Date.now();
  const client = getClientKey(request);
  const key = `${options.name}:${client}`;
  const result = takeRateLimit(key, options.limit, options.windowMs, now);

  response.setHeader("RateLimit-Limit", String(options.limit));
  response.setHeader("RateLimit-Remaining", String(result.remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

  if (result.allowed) {
    return true;
  }

  response.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - now) / 1000))));
  response.status(429).json({ error: options.message || "Too many requests. Please try again shortly." });
  return false;
}

export function takeRateLimit(key, limit, windowMs, now = Date.now()) {
  const current = buckets.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  buckets.set(key, entry);

  if (buckets.size > 1000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(bucketKey);
      }
    }
  }

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt
  };
}

function getClientKey(request) {
  const forwarded = request.headers?.["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || request.socket?.remoteAddress || "unknown");
  return value.split(",")[0].trim().slice(0, 96) || "unknown";
}
