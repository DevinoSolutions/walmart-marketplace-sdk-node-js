import type { ResolvedConfig } from "./config.js";

/**
 * Global API version pinned on every non-token call. Walmart routes CA/MX/CL sellers by this
 * header; omitting it silently falls back to the US-shaped contract.
 */
export const WM_GLOBAL_VERSION = "3.1";

/**
 * Headers for `POST /v3/token`: Basic auth over the key pair, no bearer token, no
 * `WM_GLOBAL_VERSION`, and a form-encoded body.
 */
export function buildTokenHeaders(config: ResolvedConfig, correlationId: string): Headers {
  return new Headers({
    Authorization: `Basic ${config.basicCredential}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "WM_SVC.NAME": config.svcName,
    "WM_QOS.CORRELATION_ID": correlationId,
    WM_MARKET: config.market,
    "User-Agent": config.userAgent,
  });
}

/**
 * Headers for every other call: the bearer token in `WM_SEC.ACCESS_TOKEN`, a FRESH correlation
 * id per request, the service name, the market and the global version.
 */
export function buildApiHeaders(
  config: ResolvedConfig,
  correlationId: string,
  accessToken: string,
): Headers {
  return new Headers({
    "WM_SEC.ACCESS_TOKEN": accessToken,
    "WM_QOS.CORRELATION_ID": correlationId,
    "WM_SVC.NAME": config.svcName,
    WM_MARKET: config.market,
    WM_GLOBAL_VERSION: WM_GLOBAL_VERSION,
    Accept: "application/json",
    "User-Agent": config.userAgent,
  });
}
