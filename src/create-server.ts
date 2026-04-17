import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { LawApiClient } from "./lib/api-client.js"
import { registerTools } from "./tool-registry.js"
import { VERSION } from "./version.js"
import { type ToolProfile } from "./lib/tool-profiles.js"

export interface CreateMcpServerOptions {
  profile?: ToolProfile
  apiKey?: string
}

export function createMcpServer(options: CreateMcpServerOptions = {}): Server {
  const apiClient = new LawApiClient({ apiKey: options.apiKey || "" })
  const server = new Server(
    { name: "korean-law", version: VERSION },
    { capabilities: { tools: {} } }
  )
  registerTools(server, apiClient, options.profile ?? "full")
  return server
}
