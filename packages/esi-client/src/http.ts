import { logger } from "@eve-market-scout/shared";

export const ESI_BASE_URL = "https://esi.evetech.net/latest";

const MAX_RETRIES = 3;

/**
 * ESI publishes a rolling "error budget" via response headers:
 *   X-Esi-Error-Limit-Remain: how many errors you can still make this window
 *   X-Esi-Error-Limit-Reset:  seconds until the window resets
 * If we get close to zero, we back off proactively instead of waiting to get
 * banned for a window. This matters more once we poll many regions/types —
 * for a handful of trade hubs every 3-4h we will rarely get close.
 */
function checkErrorBudget(headers: Headers): void {
  const remain = headers.get("x-esi-error-limit-remain");
  const reset = headers.get("x-esi-error-limit-reset");
  if (remain !== null && Number(remain) < 10) {
    logger.warn("ESI error budget getting low", { remain, reset });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EsiFetchOptions {
  userAgent?: string;
  signal?: AbortSignal;
  /** e.g. { Authorization: `Bearer ${accessToken}` } for authenticated
   * endpoints like structure markets. */
  extraHeaders?: Record<string, string>;
}

/**
 * ESI versions its entire API via this header instead of per-route URL
 * versions (e.g. /v4/, /v6/) — see
 * https://developers.eveonline.com/blog/changing-versions-v42-was-getting-out-of-hand
 * Pin ESI_COMPATIBILITY_DATE once you've reviewed a given date's behavior;
 * otherwise default to "yesterday in UTC" so we never accidentally request
 * a date ESI considers still in the future (their rollover happens at
 * 11:00 UTC, so "today" can be ambiguous close to that boundary).
 */
function resolveCompatibilityDate(): string {
  const configured = process.env.ESI_COMPATIBILITY_DATE;
  const safeNow = new Date(Date.now() - 12 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (!configured) return safeNow;
  // Never send a configured date later than our safe "now" fallback.
  return configured < safeNow ? configured : safeNow;
}

/**
 * Fetch a single ESI page with retry/backoff for transient failures
 * (429 rate limit, 420 error-limited, 5xx). Throws on non-recoverable errors.
 */
export async function esiFetch(
  url: string,
  options: EsiFetchOptions = {}
): Promise<Response> {
  const userAgent =
    options.userAgent ??
    process.env.ESI_USER_AGENT ??
    "eve-market-scout/0.1 (no contact configured - set ESI_USER_AGENT)";

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
          "X-Compatibility-Date": resolveCompatibilityDate(),
          ...options.extraHeaders,
        },
        signal: options.signal,
      });

      checkErrorBudget(res.headers);

      if (res.status === 420 || res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "5");
        logger.warn("ESI rate/error limited, backing off", {
          status: res.status,
          retryAfter,
          attempt,
        });
        await sleep(retryAfter * 1000);
        continue;
      }

      if (res.status >= 500) {
        logger.warn("ESI server error, retrying", {
          status: res.status,
          attempt,
        });
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        throw new Error(`ESI request failed: ${res.status} ${url}`);
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`ESI request failed after retries: ${url}`);
}

/**
 * Fetch every page of a paginated ESI endpoint. ESI reports the total page
 * count via the X-Pages header on the *first* response.
 */
export async function esiFetchAllPages<T>(
  buildUrl: (page: number) => string,
  options: EsiFetchOptions = {}
): Promise<T[]> {
  const firstRes = await esiFetch(buildUrl(1), options);
  const totalPages = Number(firstRes.headers.get("x-pages") ?? "1");
  const firstPage = (await firstRes.json()) as T[];

  if (totalPages <= 1) return firstPage;

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => i + 2).map(
      async (page) => {
        const res = await esiFetch(buildUrl(page), options);
        return (await res.json()) as T[];
      }
    )
  );

  return [firstPage, ...remainingPages].flat();
}
