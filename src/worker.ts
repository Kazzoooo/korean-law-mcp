import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createMcpServer } from "./create-server.js"
import { requestContext } from "./lib/session-state.js"
import { VERSION } from "./version.js"
import { parseProfile } from "./lib/tool-profiles.js"

interface Env {
  LAW_OC?: string
  KOREAN_LAW_API_KEY?: string
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
