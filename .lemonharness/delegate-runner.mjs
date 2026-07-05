#!/usr/bin/env node
/**
 * LemonHarness Delegate Runner
 *
 * Standalone sub-agent script that uses the pi SDK to run a delegated task
 * with bounded authority, timeout, and structured result reporting.
 *
 * Usage:
 *   echo '{"task":"...","cwd":"...","budgetMs":120000}' | node .lemonharness/delegate-runner.mjs
 *
 * Input (JSON from stdin):
 *   task         — What to accomplish
 *   cwd          — Working directory
 *   budgetMs     — Max execution time in ms (default: 120000)
 *   context      — Additional context for the sub-agent
 *   constraint   — Additional constraints
 *   outputDir    — Where to write result files
 *
 * Output (JSON lines on stdout, final result on last line):
 *   {"type":"log","text":"..."}
 *   {"type":"result","success":true/false,"summary":"...","files":[],"messages":[]}
 */

const PI_SDK_PATH = '/home/james/.nvm/versions/node/v22.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
const PI_AI_PATH = '/home/james/.nvm/versions/node/v22.18.0/lib/node_modules/@earendil-works/pi-ai/dist/index.js';

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Dynamic imports for pi SDK (needs absolute path)
let createAgentSession, SessionManager, AuthStorage, ModelRegistry, DefaultResourceLoader, SettingsManager;
let getModel;

async function loadPiSDK() {
  const pi = await import(PI_SDK_PATH);
  createAgentSession = pi.createAgentSession;
  SessionManager = pi.SessionManager;
  AuthStorage = pi.AuthStorage;
  ModelRegistry = pi.ModelRegistry;
  DefaultResourceLoader = pi.DefaultResourceLoader;
  SettingsManager = pi.SettingsManager;
}

async function loadPiAI() {
  try {
    const ai = await import(PI_AI_PATH);
    getModel = ai.getModel;
  } catch {
    getModel = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  process.stdout.write(JSON.stringify({ type: 'log', text: msg }) + '\n');
}

function emitResult(result) {
  process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');
}

function extractTextFromMessages(messages) {
  return messages
    .filter(m => m.role === 'assistant')
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      }
      return '';
    })
    .join('\n\n');
}

function extractFileChanges(messages) {
  const files = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.name === 'write' || tc.function?.name === 'edit' || tc.function?.name === 'workspace_write') {
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.path) files.push(args.path);
          } catch {}
        }
      }
    }
    // Also check tool results
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result' && block.tool_call_id) {
          // Extract from tool call metadata
        }
      }
    }
  }
  return [...new Set(files)];
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await loadPiSDK();
    await loadPiAI();

    // Read input from stdin or argument
    let input;
    if (process.argv[2] && process.argv[2].startsWith('{')) {
      input = JSON.parse(process.argv[2]);
    } else {
      const stdin = readFileSync('/dev/stdin', 'utf8').trim();
      input = JSON.parse(stdin);
    }

    const cwd = input.cwd || process.cwd();
    const budgetMs = input.budgetMs || 120000;
    const taskText = input.task || 'No task specified';
    const context = input.context || '';
    const constraint = input.constraint || '';
    const outputDir = input.outputDir || '';

    log(`Delegate started: ${taskText.slice(0, 80)}`);
    log(`Budget: ${budgetMs}ms, CWD: ${cwd}`);

    // Setup auth and model
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const available = await modelRegistry.getAvailable();

    if (available.length === 0) {
      emitResult({ success: false, summary: 'No available models for sub-agent', messages: [] });
      process.exit(1);
    }

    // Find preferred model or use first available
    let model = available[0];
    if (input.modelProvider && input.modelId) {
      const preferred = available.find(m =>
        m.provider === input.modelProvider && m.id === input.modelId
      );
      if (preferred) model = preferred;
    }

    log(`Using model: ${model.provider}/${model.id}`);

    // Build sub-agent system prompt
    const systemPromptOverride = [
      'You are a DELEGATED SUB-AGENT working on a specific task within a larger project.',
      '',
      '## YOUR ROLE',
      'You are an expert software engineer working on a bounded, well-defined subtask.',
      'You have been delegated this work by a primary agent that oversees the overall project.',
      '',
      '## YOUR TASK',
      taskText,
      '',
      '## WORKING DIRECTORY',
      cwd,
      '',
      '## CONSTRAINTS',
      `- Budget: ${budgetMs / 1000} seconds (manage your time wisely)`,
      '- Focus only on the task above — do not expand scope',
      '- Read files to understand existing code before making changes',
      '- Use write/edit for file modifications',
      '- Use bash to run commands (tests, linting, etc.)',
      '- After completing the task, summarize what you did',
      constraint ? `- ${constraint}` : '',
      context ? `\n## CONTEXT\n${context}\n` : '',
      '',
      '## BEHAVIOR',
      '1. First, read relevant files to understand the existing codebase',
      '2. Plan your approach before implementing',
      '3. Implement the changes',
      '4. Verify your changes work',
      '5. Report a clear summary of what was accomplished',
      '',
      '## REPORTING FORMAT',
      'When done, output a structured summary like:',
      '=== DELEGATE RESULT ===',
      'SUMMARY: <what was accomplished>',
      'FILES: <list of files created or modified>',
      'DETAILS: <any important notes>',
      '=== END ===',
    ].join('\n');

    // Create resource loader with sub-agent system prompt
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: process.env.HOME + '/.pi/agent',
      settingsManager: SettingsManager.inMemory({}),
      systemPromptOverride: () => systemPromptOverride,
    });
    await resourceLoader.reload();

    // Create in-memory session for sub-agent
    const sessionManager = SessionManager.inMemory();

    log('Creating sub-agent session...');

    // Create agent session with limited tools
    const { session } = await createAgentSession({
      model,
      tools: ['read', 'bash', 'write', 'edit', 'grep', 'find', 'ls'],
      sessionManager,
      authStorage,
      modelRegistry,
      resourceLoader,
      settingsManager: SettingsManager.inMemory(),
    });

    log('Sub-agent session created, dispatching task...');

    // Track events for debugging
    const toolCalls = [];
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'tool_execution_start') {
        const argsStr = event.args ? JSON.stringify(event.args).slice(0, 120) : '';
        log(`Tool: ${event.toolName} ${argsStr}`);
        toolCalls.push({ tool: event.toolName, args: event.args, time: Date.now() });
      }
      if (event.type === 'tool_execution_end') {
        log(`Tool result: ${event.isError ? 'ERROR' : 'OK'}`);
      }
    });

    // Run with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Delegate timed out after ${budgetMs}ms`)), budgetMs)
    );

    try {
      await Promise.race([
        session.prompt(taskText),
        timeoutPromise,
      ]);
    } catch (err) {
      log(`Delegate error: ${err.message}`);
      try { await session.abort(); } catch {}
      const messages = session.messages || [];
      emitResult({
        success: false,
        summary: `Delegate failed: ${err.message}`,
        files: extractFileChanges(messages),
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content.slice(0, 500) : '[non-text content]',
        })),
        toolCalls: toolCalls.length,
      });
      process.exit(1);
    } finally {
      unsubscribe();
    }

    // Collect results
    const messages = session.messages || [];
    const assistantText = extractTextFromMessages(messages);
    const files = extractFileChanges(messages);

    // Extract summary from the last assistant message
    let summary = 'Delegate completed';
    const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
    if (lastAssistant) {
      const text = typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : Array.isArray(lastAssistant.content)
          ? lastAssistant.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : '';
      // Try to extract structured summary
      const resultMatch = text.match(/=== DELEGATE RESULT ===\n([\s\S]*?)=== END ===/);
      if (resultMatch) {
        summary = resultMatch[1].trim();
      } else {
        summary = text.slice(0, 1000);
      }
    }

    // Write output files if outputDir specified
    if (outputDir) {
      const outPath = resolve(cwd, outputDir);
      await mkdir(outPath, { recursive: true });
      await writeFile(join(outPath, 'summary.txt'), summary, 'utf8');
      await writeFile(join(outPath, 'messages.json'), JSON.stringify(messages, null, 2), 'utf8');
      if (files.length > 0) {
        await writeFile(join(outPath, 'files.json'), JSON.stringify(files, null, 2), 'utf8');
      }
    }

    log('Delegate completed successfully');
    emitResult({
      success: true,
      summary,
      files,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 300) : '[content]',
      })),
      toolCalls: toolCalls.length,
    });

    await session.dispose();
    process.exit(0);

  } catch (err) {
    log(`Fatal error: ${err.message}`);
    console.error(err.stack);
    emitResult({ success: false, summary: `Fatal: ${err.message}`, messages: [] });
    process.exit(1);
  }
}

main();
