import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

// Ordered by speed. If the first model returns 429 (provider overloaded),
// the request automatically falls through to the next one.
const FREE_MODELS = [
  "meta-llama/llama-3.2-3b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-2-9b-it:free",
  "qwen/qwen-2.5-7b-instruct:free",
];
const FREE_MODEL = FREE_MODELS[0];

// Singleton client — created once, reused on every request
let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. " +
      "Get a free key at https://openrouter.ai/settings/keys — free-tier models cost $0."
    );
  }
  _client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": process.env.SITE_URL ?? "http://localhost",
      "X-Title": process.env.SITE_NAME ?? "My App",
    },
  });
  return _client;
}

// Calls OpenRouter with automatic fallback through FREE_MODELS on 429/503.
// For non-free models (user-specified), no fallback is attempted.
async function chatWithFallback({ model, messages, max_tokens, temperature = 1, stream = false }) {
  const client = getClient();
  const isFreeModel = FREE_MODELS.includes(model);
  const candidates = isFreeModel ? FREE_MODELS : [model];

  let lastErr;
  for (const candidate of candidates) {
    try {
      const completion = await client.chat.completions.create({
        model: candidate,
        messages,
        max_tokens,
        temperature,
        stream,
      });
      return { completion, model: candidate };
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      // 429 = rate limited, 503 = provider unavailable — retry next model
      if (isFreeModel && (status === 429 || status === 503)) {
        lastErr = err;
        continue;
      }
      throw err; // non-retriable error — surface immediately
    }
  }
  throw lastErr; // all candidates exhausted
}

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const ChatSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  model: z.string().default(FREE_MODEL),
  max_tokens: z.number().int().positive().max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(1),
});

const FreeOnlySchema = z.object({
  messages: z.array(MessageSchema).min(1),
  max_tokens: z.number().int().positive().max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(1),
});

// Health check
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Simple GET — /api/ask?q=your+question
app.get("/api/ask", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    return res.status(400).json({ error: "Missing ?q= parameter. Example: /api/ask?q=hello" });
  }
  const model = (typeof req.query.model === "string" && req.query.model) || FREE_MODEL;
  const max_tokens = parseInt(req.query.max_tokens) || 1024;

  try {
    const { completion } = await chatWithFallback({ model, messages: [{ role: "user", content: q }], max_tokens });
    const content = completion.choices[0]?.message?.content ?? "";
    const usage = completion.usage;
    res.json({
      content,
      model: completion.model,
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: "OpenRouter request failed", message: err.message });
  }
});

// List free OpenRouter models only
app.get("/api/models", async (_req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` },
    });
    const data = await response.json();
    const freeModels = data?.data?.filter(
      (m) => m.id?.endsWith(":free") || (m.pricing?.prompt === "0" && m.pricing?.completion === "0")
    ) ?? [];
    res.json({ data: freeModels, total: freeModels.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/openrouter/free?q=your+question
app.get("/api/openrouter/free", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    return res.status(400).json({ error: "Missing ?q= parameter. Example: /api/openrouter/free?q=hello" });
  }
  const max_tokens = parseInt(req.query.max_tokens) || 1024;
  try {
    const { completion } = await chatWithFallback({ model: FREE_MODEL, messages: [{ role: "user", content: q }], max_tokens });
    const content = completion.choices[0]?.message?.content ?? "";
    const usage = completion.usage;
    res.json({
      content,
      model: completion.model,
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: "OpenRouter request failed", message: err.message });
  }
});

// POST /api/openrouter/free
app.post("/api/openrouter/free", async (req, res) => {
  const parsed = FreeOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { messages, max_tokens, temperature } = parsed.data;
  try {
    const { completion } = await chatWithFallback({ model: FREE_MODEL, messages, max_tokens, temperature });
    const content = completion.choices[0]?.message?.content ?? "";
    const usage = completion.usage;
    res.json({
      content,
      model: completion.model,
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: "OpenRouter request failed", message: err.message });
  }
});

// POST /api/chat — full control, non-streaming
app.post("/api/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { messages, model, max_tokens, temperature } = parsed.data;
  try {
    const { completion } = await chatWithFallback({ model, messages, max_tokens, temperature });
    const content = completion.choices[0]?.message?.content ?? "";
    const usage = completion.usage;
    res.json({
      content,
      model: completion.model,
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    });
  } catch (err) {
    res.status(502).json({ error: "OpenRouter request failed", message: err.message });
  }
});

// POST /api/chat/stream — SSE streaming (fastest perceived latency)
app.post("/api/chat/stream", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { messages, model, max_tokens, temperature } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // For streaming, try each candidate manually (stream=true can't be auto-retried mid-stream)
  const candidates = FREE_MODELS.includes(model) ? FREE_MODELS : [model];
  let streamed = false;
  for (const candidate of candidates) {
    try {
      const client = getClient();
      const stream = await client.chat.completions.create({
        model: candidate,
        messages,
        max_tokens,
        temperature,
        stream: true,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      streamed = true;
      break;
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      if (FREE_MODELS.includes(model) && (status === 429 || status === 503)) continue;
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return;
    }
  }
  if (!streamed) {
    res.write(`data: ${JSON.stringify({ error: "All free models are currently rate-limited. Try again in a moment." })}\n\n`);
    res.end();
  }
});

export default app;
