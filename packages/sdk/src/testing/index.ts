/**
 * Deterministic mock `fetch` for testing Walmart integrations without network access.
 *
 * Routes are matched by method plus path pattern, every call is recorded (headers, parsed JSON
 * body, and the multipart part names for feed uploads), and unmatched requests come back as
 * `501` so a misconfigured test fails loudly instead of hanging. Exported from
 * `@devino/walmart-marketplace-sdk/testing`.
 */

/** A single recorded request as observed by the mock. */
export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  bodyText?: string;
  bodyJson?: unknown;
  /** Part names present in a `multipart/form-data` body, in order. */
  formParts?: string[];
  /** Text content of each multipart part, keyed by part name. */
  formValues?: Record<string, string>;
}

/** The reply a route produces for a matched request. */
export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A route: matched by `method` plus `pathPattern` (string = substring of pathname, RegExp = tested against pathname+search). */
export interface MockRoute {
  method: string;
  pathPattern: RegExp | string;
  reply: (req: RecordedCall) => MockReply | Promise<MockReply>;
}

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

function toUrl(input: FetchInput): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return new URL(input.toString());
  return new URL(input.url);
}

function methodOf(input: FetchInput, init: FetchInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function headersOf(input: FetchInput, init: FetchInit): Headers {
  if (init?.headers) return new Headers(init.headers);
  if (input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

function matchPath(pattern: RegExp | string, url: URL): boolean {
  if (typeof pattern === "string") return url.pathname.includes(pattern);
  return pattern.test(`${url.pathname}${url.search}`);
}

function serializeBody(body: unknown): string {
  if (body === undefined) return "";
  return typeof body === "string" ? body : JSON.stringify(body);
}

async function readFormData(
  form: FormData,
): Promise<Pick<RecordedCall, "formParts" | "formValues">> {
  const formParts: string[] = [];
  const formValues: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    formParts.push(name);
    formValues[name] = value instanceof Blob ? await value.text() : String(value);
  }
  return { formParts, formValues };
}

/**
 * Builds a mock `fetch` plus the array it records calls into.
 *
 * @example
 * ```ts
 * const { fetch, calls } = createMockFetch([
 *   { method: "POST", pathPattern: "/v3/token", reply: () => ({ status: 200, body: token }) },
 * ]);
 * ```
 */
export function createMockFetch(routes: MockRoute[]): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    // Honor an already-aborted signal like a real fetch would (for cancellation tests).
    if (init?.signal?.aborted) {
      const reason = init.signal.reason;
      throw reason instanceof Error
        ? reason
        : new DOMException("The operation was aborted.", "AbortError");
    }
    const url = toUrl(input);
    const method = methodOf(input, init);

    const call: RecordedCall = { method, url, headers: headersOf(input, init) };
    if (init?.body instanceof FormData) {
      Object.assign(call, await readFormData(init.body));
    } else if (typeof init?.body === "string") {
      call.bodyText = init.body;
      try {
        call.bodyJson = JSON.parse(init.body);
      } catch {
        call.bodyJson = undefined;
      }
    }
    calls.push(call);

    const route = routes.find(
      (candidate) =>
        candidate.method.toUpperCase() === method && matchPath(candidate.pathPattern, url),
    );
    if (!route) {
      return new Response(
        JSON.stringify({
          error: [
            {
              code: "MOCK_NO_ROUTE",
              description: `No mock route for ${method} ${url.pathname}`,
              severity: "ERROR",
            },
          ],
        }),
        { status: 501, headers: { "Content-Type": "application/json" } },
      );
    }

    const reply = await route.reply(call);
    return new Response(serializeBody(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  };

  return { fetch: mockFetch, calls };
}
