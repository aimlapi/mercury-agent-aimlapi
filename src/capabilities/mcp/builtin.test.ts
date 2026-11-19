import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../utils/redact.js';
import {
  AIMLAPI_MCP_FREE_TOOLS,
  AIMLAPI_MCP_URL,
  aimlapiMcpKey,
  aimlapiOffSwitch,
  builtinMcpServers,
  isAimlapiMcpUrl,
  isAimlapiOffSwitch,
} from './builtin.js';
import { validateMcpConfig } from './config.js';
import { isToolAllowed, isToolAutoApproved } from './manager.js';

const join = (...parts: string[]) => parts.join('');
const KEY = join('aiml', '-test-key-0123456789abcdef');
const noEnv = {} as NodeJS.ProcessEnv;

describe('builtinMcpServers', () => {
  it('adds nothing without an AI/ML API key', () => {
    expect(builtinMcpServers({}, noEnv)).toEqual({});
    expect(builtinMcpServers({ providers: { aimlapi: { apiKey: '' } } }, { AIMLAPI_API_KEY: '' } as NodeJS.ProcessEnv)).toEqual({});
    expect(builtinMcpServers({ providers: { aimlapi: { apiKey: '   ' } } }, noEnv)).toEqual({});
  });

  it('adds the AI/ML API server when AIMLAPI_API_KEY is set', () => {
    const servers = builtinMcpServers({}, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(Object.keys(servers)).toEqual(['aimlapi']);
    expect(servers.aimlapi).toMatchObject({ transport: 'http', url: 'https://mcp.aimlapi.com/mcp' });
    expect(servers.aimlapi!.headers?.Authorization).toBe(`Bearer ${KEY}`);
    expect(servers.aimlapi!.headers?.['X-AIMLAPI-Source']).toBe('agent/mercury-agent');
  });

  it('never sends a partner id from the MCP server', () => {
    const servers = builtinMcpServers({}, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(Object.keys(servers.aimlapi!.headers ?? {})).toEqual(['Authorization', 'X-AIMLAPI-Source']);
  });

  it('uses the provider key saved by mercury setup when the environment has none', () => {
    const servers = builtinMcpServers({ providers: { aimlapi: { apiKey: KEY } } }, noEnv);
    expect(servers.aimlapi!.headers?.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('prefers the environment over the saved provider key, as the provider does', () => {
    const env = { AIMLAPI_API_KEY: `${KEY}-env` } as NodeJS.ProcessEnv;
    expect(aimlapiMcpKey({ providers: { aimlapi: { apiKey: KEY } } }, env)).toBe(`${KEY}-env`);
  });

  it('sends the key only to the fixed AI/ML API endpoint', () => {
    const servers = builtinMcpServers({}, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(isAimlapiMcpUrl(servers.aimlapi!.url!)).toBe(true);
    expect(new URL(servers.aimlapi!.url!).host).toBe('mcp.aimlapi.com');
  });

  it('leaves the owner\'s other servers alone: the key is never added to them', () => {
    const docs = { transport: 'http' as const, url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${env:DOCS_TOKEN}' } };
    const config = { mcp: { servers: { docs } } };
    const servers = { ...builtinMcpServers(config, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv), ...config.mcp.servers };
    expect(servers.docs).toEqual(docs);
    expect(JSON.stringify(servers.docs)).not.toContain(KEY);
  });

  it('lets the owner\'s own aimlapi entry, or the off switch, replace it', () => {
    const env = { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv;
    expect(builtinMcpServers({ mcp: { servers: { aimlapi: aimlapiOffSwitch() } } }, env)).toEqual({});
    const own = { transport: 'http' as const, url: AIMLAPI_MCP_URL, headers: { Authorization: 'Bearer ${env:MY_KEY}' } };
    expect(builtinMcpServers({ mcp: { servers: { aimlapi: own } } }, env)).toEqual({});
    // Even when it points somewhere else entirely: the id is the owner's.
    const proxy = { transport: 'stdio' as const, command: 'my-aimlapi-proxy' };
    expect(builtinMcpServers({ mcp: { servers: { aimlapi: proxy } } }, env)).toEqual({});
  });

  it('does not connect twice when the owner added the endpoint under another id', () => {
    const env = { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv;
    const mine = { transport: 'http' as const, url: 'https://MCP.aimlapi.com/mcp' };
    expect(builtinMcpServers({ mcp: { servers: { aiml: mine } } }, env)).toEqual({});
  });

  it('shows every tool but runs only the free ones without asking', () => {
    const server = builtinMcpServers({}, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv).aimlapi!;
    for (const tool of ['models_list', 'account_balance', 'ping', 'llm_chat', 'image_generate', 'tools_run', 'jev_model_search']) {
      expect(isToolAllowed(server, tool)).toBe(true);
    }
    for (const tool of AIMLAPI_MCP_FREE_TOOLS) expect(isToolAutoApproved(server, tool)).toBe(true);
    for (const billed of ['llm_chat', 'embeddings_create', 'image_generate', 'image_edit', 'video_generate', 'audio_generate',
      'speech_generate', 'speech_transcribe', 'document_ocr', 'tools_run', 'jev_tool_search', 'jev_model_search']) {
      expect(isToolAutoApproved(server, billed)).toBe(false);
    }
  });

  it('passes Mercury\'s own config validation without warnings', () => {
    const servers = builtinMcpServers({}, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv);
    const { problems } = validateMcpConfig({ servers });
    expect(problems).toEqual([]);
  });

  it('registers the key so logs and errors redact it', () => {
    builtinMcpServers({}, { AIMLAPI_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(redactSecrets(`401 for ${KEY}`)).not.toContain(KEY);
  });
});

describe('isAimlapiMcpUrl', () => {
  it('matches the exact host over https only', () => {
    expect(isAimlapiMcpUrl('https://mcp.aimlapi.com/mcp')).toBe(true);
    expect(isAimlapiMcpUrl('http://mcp.aimlapi.com/mcp')).toBe(false);
    expect(isAimlapiMcpUrl('https://mcp.aimlapi.com.example.test/mcp')).toBe(false);
    expect(isAimlapiMcpUrl('https://evil.test/mcp.aimlapi.com')).toBe(false);
    expect(isAimlapiMcpUrl('https://api.aimlapi.com/v1')).toBe(false);
    expect(isAimlapiMcpUrl('not a url')).toBe(false);
  });
});

describe('aimlapi off switch', () => {
  it('holds no key and is recognised only in its exact shape', () => {
    expect(aimlapiOffSwitch()).toEqual({ transport: 'http', url: AIMLAPI_MCP_URL, enabled: false });
    expect(isAimlapiOffSwitch(aimlapiOffSwitch())).toBe(true);
    expect(isAimlapiOffSwitch({ ...aimlapiOffSwitch(), enabled: true })).toBe(false);
    expect(isAimlapiOffSwitch({ ...aimlapiOffSwitch(), headers: { Authorization: 'x' } })).toBe(false);
    expect(isAimlapiOffSwitch({ ...aimlapiOffSwitch(), url: 'https://mcp.example.com/mcp' })).toBe(false);
  });
});
