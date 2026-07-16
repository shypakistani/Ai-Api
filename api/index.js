import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

// Fast, reliable free model on OpenRouter. Switch to any ":free" model you prefer.
// llama-3.1-8b is one of the fastest free options available.
const FREE_MODEL = "meta-llama/llama-3.2-3b-instruct:free";

// Singleton client — created once, reused on every request (saves ~5–10 ms per call)
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

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const ChatSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  model: z.string().default(FREE_MODEL),
  // Lowered from 8192 → 1024. This is the single biggest speed lever:
  // the model stops as soon as it's done, but a high cap forces the API
  // to reserve time/compute for up to that many tokens.
  max_tokens: z.number().int().positive().max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(1),
});

// Health check
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Simple GET — pass your message as ?q=
// curl "https://your-project.replit.app/api/ask?q=hello+how+are+you"
app.get("/api/ask", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    return res.status(400).json({ error: "Missing ?q= parameter. Example: /api/ask?q=hello" });
  }

  const model = (typeof req.query.model === "string" && req.query.model) || FREE_MODEL;
  const max_tokens = parseInt(req.query.max_tokens) || 1024;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: q }],
      max_tokens,
    });
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

// /api/openrouter/free — always uses the fast free model
// GET:  /api/openrouter/free?q=your+question
// POST: /api/openrouter/free  { "messages": [...], "max_tokens": 1024, "temperature": 1 }

const FreeOnlySchema = z.object({
  messages: z.array(MessageSchema).min(1),
  max_tokens: z.number().int().positive().max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(1),
});

app.get("/api/openrouter/free", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    return res.status(400).json({ error: "Missing ?q= parameter. Example: /api/openrouter/free?q=hello" });
  }
  const max_tokens = parseInt(req.query.max_tokens) || 1024;
  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: FREE_MODEL,
      messages: [{ role: "user", content: q }],
      max_tokens,
    });
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

app.post("/api/openrouter/free", async (req, res) => {
  const parsed = FreeOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { messages, max_tokens, temperature } = parsed.data;
  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: FREE_MODEL,
      messages,
      max_tokens,
      temperature,
    });
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

// Non-streaming chat (POST with full control)
app.post("/api/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { messages, model, max_tokens, temperature } = parsed.data;

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({ model, messages, max_tokens, temperature });
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

// Streaming chat (SSE) — fastest perceived response since tokens arrive immediately
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

  try {
    const client = getClient();
    const stream = await client.chat.completions.create({ model, messages, max_tokens, temperature, stream: true });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default app;
