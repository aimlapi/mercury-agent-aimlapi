import { AIMLAPI_SOURCE } from '../../providers/aimlapi-attribution.js';
import { registerSecretValue } from '../../utils/redact.js';
import type { McpConfig, McpServerConfig } from './types.js';

/**
 * AI/ML API's hosted MCP server, built in. It needs no entry in
 * `mercury.yaml`: it turns on when an AI/ML API key is set (the same key the
 * `aimlapi` provider uses) and stays off without one, so nothing connects or
 * bills unless the owner has that key.
 *
 * The key goes in a header to exactly one origin, fixed here. The URL is not
 * configurable on purpose: a setting that moves it would move the key too.
 * An owner who wants something else writes their own `aimlapi` entry, which
 * replaces this one completely.
 */
export const AIMLAPI_MCP_ID = 'aimlapi';
export const AIMLAPI_MCP_HOST = 'mcp.aimlapi.com';
export const AIMLAPI_MCP_URL = `https://${AIMLAPI_MCP_HOST}/mcp`;

/**
 * The tools the server documents as free. They run without asking; every
 * other tool is visible but asks first, because it bills the owner's balance:
 * chat, embeddings, generation, OCR, `tools_run`, and the two `jev_*`
 * searches, which are read-only but cost per search.
 */
export const AIMLAPI_MCP_FREE_TOOLS = [
  'ping',
  'account_balance',
  'account_usage',
  'models_list',
  'models_search',
  'models_compare',
  'model_get',
  'models_find_best',
  'job_status',
  'job_result',
  'tools_search',
  'tools_inspect',
  'tools_run_status',
] as const;

export interface BuiltinMcpSource {
  mcp?: McpConfig;
  providers?: { aimlapi?: { apiKey?: string } };
}

/** HTTPS on the exact host: `mcp.aimlapi.com.example.test` is someone else. */
export function isAimlapiMcpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname.toLowerCase() === AIMLAPI_MCP_HOST;
}

/** The environment wins, as it does for the provider; then the key `mercury setup` saved. */
export function aimlapiMcpKey(source: BuiltinMcpSource, env: NodeJS.ProcessEnv = process.env): string {
  return (env.AIMLAPI_API_KEY || source.providers?.aimlapi?.apiKey || '').trim();
}

function aimlapiMcpServer(apiKey: string): McpServerConfig {
  return {
    transport: 'http',
    url: AIMLAPI_MCP_URL,
    headers: { Authorization: `Bearer ${apiKey}`, 'X-AIMLAPI-Source': AIMLAPI_SOURCE },
    tools: { allow: ['*'], autoApprove: [...AIMLAPI_MCP_FREE_TOOLS] },
  };
}

/**
 * Servers Mercury adds on its own, keyed by id, to be listed before the
 * owner's: `{ ...builtinMcpServers(config), ...configured }`. Empty without a
 * key, and empty when the owner already has an `aimlapi` entry (including the
 * off switch) or any other server pointing at the same endpoint.
 */
export function builtinMcpServers(source: BuiltinMcpSource, env: NodeJS.ProcessEnv = process.env): Record<string, McpServerConfig> {
  const apiKey = aimlapiMcpKey(source, env);
  if (!apiKey) return {};
  const configured = source.mcp?.servers ?? {};
  if (configured[AIMLAPI_MCP_ID]) return {};
  if (Object.values(configured).some((server) => server?.transport === 'http' && isAimlapiMcpUrl(server.url ?? ''))) return {};
  registerSecretValue(apiKey);
  return { [AIMLAPI_MCP_ID]: aimlapiMcpServer(apiKey) };
}

/** The entry `mercury mcp disable aimlapi` writes: it holds no key, only the switch. */
export function aimlapiOffSwitch(): McpServerConfig {
  return { transport: 'http', url: AIMLAPI_MCP_URL, enabled: false };
}

export function isAimlapiOffSwitch(server: McpServerConfig): boolean {
  const off = aimlapiOffSwitch();
  const keys = Object.keys(server);
  return keys.length === Object.keys(off).length
    && server.transport === off.transport
    && server.url === off.url
    && server.enabled === false;
}
