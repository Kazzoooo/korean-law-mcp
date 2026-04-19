import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createMcpServer } from "./create-server.js"
import { requestContext } from "./lib/session-state.js"
import { VERSION } from "./version.js"
import { parseProfile } from "./lib/tool-profiles.js"

interface Env {
  LAW_OC?: string
  KOREAN_LAW_API_KEY?: string
  LAW_API_BASE?: string
  CORS_ORIGIN?: string
  RATE_LIMIT_RPM?: string
  MCP_PROFILE?: string
}

const RATE_LIMIT_BUCKETS = new Map<string, number>()

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

function applyCorsHeaders(headers: Headers, env: Env): void {
  headers.set("access-control-allow-origin", env.CORS_ORIGIN ?? "*")
  headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS")
  headers.set("access-control-allow-headers", "content-type, mcp-session-id, last-event-id, authorization, x-api-key, x-law-oc, law-oc, law_oc, apikey")
  headers.set("vary", "origin")
}

function withCors(response: Response, env: Env): Response {
  applyCorsHeaders(response.headers, env)
  return response
}

function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")
    ?? "anonymous"
}

function checkRateLimit(request: Request, env: Env): boolean {
  const maxRequests = Number(env.RATE_LIMIT_RPM ?? 60)
  const ip = getClientIp(request)
  const now = Date.now()
  const bucketKey = `${ip}:${Math.floor(now / 60_000)}`
  const current = RATE_LIMIT_BUCKETS.get(bucketKey) ?? 0
  RATE_LIMIT_BUCKETS.set(bucketKey, current + 1)

  for (const key of RATE_LIMIT_BUCKETS.keys()) {
    const minute = Number(key.split(":").pop())
    if (minute < Math.floor(now / 60_000) - 2) {
      RATE_LIMIT_BUCKETS.delete(key)
    }
  }

  return current < maxRequests
}

function methodNotAllowed(env: Env): Response {
  return withCors(jsonResponse({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Server runs in stateless mode.",
    },
    id: null,
  }, 405), env)
}

function extractRequestApiKey(request: Request): string | undefined {
  const url = new URL(request.url)
  return url.searchParams.get("oc")
    ?? request.headers.get("apikey")
    ?? request.headers.get("law_oc")
    ?? request.headers.get("law-oc")
    ?? request.headers.get("x-api-key")
    ?? request.headers.get("x-law-oc")
    ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function redactSecret(value: string, secret: string): string {
  if (!secret) return value
  return value
    .replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]")
    .replace(new RegExp(escapeRegExp(encodeURIComponent(secret)), "g"), "[REDACTED]")
}

async function handleDebugLawSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const query = url.searchParams.get("query") ?? "민법"
  const protocol = url.searchParams.get("protocol") === "https" ? "https" : "http"
  const mode = url.searchParams.get("mode")
  const apiKey = env.LAW_OC || env.KOREAN_LAW_API_KEY

  if (!apiKey) {
    return withCors(jsonResponse({
      ok: false,
      error: "LAW_OC or KOREAN_LAW_API_KEY is not configured.",
    }, 500), env)
  }

  const base = env.LAW_API_BASE || `${protocol}://www.law.go.kr/DRF`
  const targetUrl = new URL(`${base}/lawSearch.do`)
  targetUrl.searchParams.set("OC", apiKey)
  targetUrl.searchParams.set("target", "law")
  targetUrl.searchParams.set("type", "XML")
  targetUrl.searchParams.set("query", query)

  try {
    const headers: Record<string, string> = {
      "user-agent": "korean-law-mcp-worker/3.4.0",
      "accept": "application/xml,text/xml;q=0.9,*/*;q=0.1",
    }

    if (mode === "gpters") {
      headers["Host"] = "www.law.go.kr"
      headers["X-Real-IP"] = request.headers.get("CF-Connecting-IP") ?? ""
      headers["X-Forwarded-For"] = ""
      headers["X-Forwarded-Host"] = ""
      headers["X-Forwarded-Proto"] = ""
      headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      headers["Content-Type"] = "application/xml"
      headers["Accept"] = "application/xml"
    }

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers,
    })

    const body = await response.text()
    return withCors(jsonResponse({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      protocol,
      mode: mode ?? "default",
      query,
      base,
      targetUrl: redactSecret(targetUrl.toString(), apiKey),
      contentType: response.headers.get("content-type"),
      cfRay: response.headers.get("cf-ray"),
      server: response.headers.get("server"),
      bodyPreview: redactSecret(body.slice(0, 500), apiKey),
    }, response.ok ? 200 : 502), env)
  } catch (error) {
    return withCors(jsonResponse({
      ok: false,
      protocol,
      mode: mode ?? "default",
      query,
      base,
      targetUrl: redactSecret(targetUrl.toString(), apiKey),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, 502), env)
  }
}

export async function handleWorkerRequest(request: Request, env: Env = {}): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), env)
  }

  if (request.method === "GET" && url.pathname === "/") {
    return withCors(jsonResponse({
      name: "Korean Law MCP Server",
      version: VERSION,
      status: "running",
      transport: "streamable-http (stateless)",
      runtime: "cloudflare-workers",
      endpoints: {
        mcp: "/mcp",
        health: "/health",
      },
    }), env)
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return withCors(jsonResponse({
      status: "ok",
      timestamp: new Date().toISOString(),
      runtime: "cloudflare-workers",
    }), env)
  }

  if (request.method === "GET" && url.pathname === "/debug/law-search") {
    return handleDebugLawSearch(request, env)
  }

  if (url.pathname !== "/mcp") {
    return withCors(jsonResponse({ error: "Not found" }, 404), env)
  }

  if (!checkRateLimit(request, env)) {
    return withCors(jsonResponse({ error: "Too many requests. Try again later." }, 429), env)
  }

  if (request.method === "GET" || request.method === "DELETE") {
    return methodNotAllowed(env)
  }

  if (request.method !== "POST") {
    return withCors(jsonResponse({ error: "Not found" }, 404), env)
  }

  const requestedProfile = parseProfile(url.searchParams.get("profile") ?? env.MCP_PROFILE)
  const fallbackApiKey = env.LAW_OC || env.KOREAN_LAW_API_KEY || ""
  const requestApiKey = extractRequestApiKey(request)

  const server = createMcpServer({
    profile: requestedProfile,
    apiKey: fallbackApiKey,
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  try {
    await server.connect(transport)
    const response = await requestContext.run({ apiKey: requestApiKey }, async () => {
      return await transport.handleRequest(request)
    })
    return withCors(response, env)
  } catch (error) {
    console.error("[worker:/mcp] error", error)
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
    return withCors(jsonResponse({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
      },
      id: null,
    }, 500), env)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleWorkerRequest(request, env)
  },
}
