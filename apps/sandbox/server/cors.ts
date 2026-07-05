import * as config from "./config";

function headers(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": config.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
}

function withCors(res: Response): Response {
  const merged = new Headers(res.headers);
  for (const [key, value] of headers()) merged.set(key, value);
  return new Response(res.body, { status: res.status, headers: merged });
}

type RouteHandler = (...args: never[]) => Response | Promise<Response>;

/**
 * Wraps a Bun route method-map so every response carries CORS headers and
 * `OPTIONS` preflight requests are answered automatically. The frontend is
 * deployed to Cloudflare Pages (a different origin from this API), so every
 * `/api/*` route needs this.
 */
export function cors<T extends Record<string, RouteHandler>>(
  handlers: T,
): T & { OPTIONS: () => Response } {
  const wrapped = {
    OPTIONS: () => new Response(null, { status: 204, headers: headers() }),
  } as T & {
    OPTIONS: () => Response;
  };
  for (const [method, handler] of Object.entries(handlers)) {
    (wrapped as Record<string, RouteHandler>)[method] = async (...args: never[]) =>
      withCors(await handler(...args));
  }
  return wrapped;
}
