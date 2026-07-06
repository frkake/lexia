/**
 * Vite plugin: the thin server-side generation proxy (design.md "PassageGenerationService").
 *
 * It serves `/api/*` on both the dev and preview servers and loads the server-side
 * environment (`.env` / `.env.local`, including the non-VITE_ LLM keys) so credentials stay
 * off the client. This is the production-shaped seam for local use; a hosted edge proxy for
 * static deploys remains out of scope (design.md). There is no mock fallback — when the LLM
 * is missing or down, `/api/*` returns an error and the SPA shows it.
 *
 * Key precedence: `.env` files are AUTHORITATIVE here. Vite's `loadEnv` applies `process.env`
 * last, so a stale shell `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (or `.env.local` placeholder)
 * would silently shadow the key the developer wrote in `.env`. For a local dev/preview proxy
 * configured via `.env` (see `.env.example`), that is a footgun — so after `loadEnv` we
 * overlay the raw `.env`-file values, making them win over the shell environment.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Plugin, loadEnv } from 'vite';
import { createApiHandler } from './llm/handler';
import { type Env, describeImageConfig } from './llm/providers';

export function generationApiPlugin(): Plugin {
  let env: Env = {};
  const getEnv = (): Env => env;

  return {
    name: 'generation-api',
    config(_config, { mode, command }) {
      // Empty prefix => load every var (incl. OPENAI/ANTHROPIC keys); process.env wins here…
      env = loadEnv(mode, process.cwd(), '');
      // …then re-assert the .env-file values so a stale shell var can't shadow them.
      Object.assign(env, readEnvFiles(process.cwd(), mode));
      if (command === 'serve') logKeySource(env);
    },
    configureServer(server) {
      server.middlewares.use(createApiHandler(getEnv));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiHandler(getEnv));
    },
  };
}

/** Minimal KEY=VALUE parser (strips quotes/comments; no ${VAR} expansion — keys don't need it). */
function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/** Merge the .env files in Vite precedence order (later overrides earlier). */
function readEnvFiles(cwd: string, mode: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of ['.env', `.env.${mode}`, '.env.local', `.env.${mode}.local`]) {
    let text: string;
    try {
      text = readFileSync(join(cwd, file), 'utf8');
    } catch {
      continue; // file absent — skip
    }
    Object.assign(merged, parseEnvText(text));
  }
  return merged;
}

/** One masked line at dev/preview start so a missing/placeholder key is diagnosable without leaking secrets. */
function logKeySource(env: Env): void {
  const provider = (env.LLM_PROVIDER ?? 'openai').trim().toLowerCase();
  const keyName = provider === 'claude' || provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const key = env[keyName] ?? '';
  const flags: string[] = [];
  if (!key.trim()) flags.push('MISSING — set it in .env');
  else if (key.includes('...')) flags.push('looks like a placeholder');
  const detail = key.trim() ? `length ${key.length}` : 'not set';
  const suffix = flags.length ? ` [${flags.join('; ')}]` : '';
  console.log(`[generation-api] provider=${provider}, ${keyName}=${detail}${suffix} (source: .env files)`);
  logImageConfig(env);
}

/**
 * Second masked line for the image axis: which provider + key + model each use profile (fast/quality)
 * resolves to, so a typo'd IMAGE_PROVIDER or a missing image key is diagnosable at startup rather than
 * only at the first (silently-swallowed) illustration request.
 */
function logImageConfig(env: Env): void {
  const parts = describeImageConfig(env).map((c) => {
    if (c.status === 'unknown_provider') {
      return `${c.profile}=UNKNOWN "${c.rawProvider}" [typo? use openai|grok|gemini — image requests will 503]`;
    }
    const flags: string[] = [];
    if (c.status === 'missing_key') flags.push(`${c.keyEnvName} MISSING — set it in .env`);
    else if (c.status === 'placeholder_key') flags.push(`${c.keyEnvName} looks like a placeholder`);
    const keyDetail = c.keyLength ? `${c.keyEnvName}=length ${c.keyLength}` : `${c.keyEnvName}=not set`;
    const suffix = flags.length ? ` [${flags.join('; ')}]` : '';
    return `${c.profile}=${c.provider} (${keyDetail}, model=${c.model})${suffix}`;
  });
  console.log(`[generation-api] image: ${parts.join(' / ')} (source: .env files)`);
}
