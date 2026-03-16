import { Router, type IRouter, Request, Response } from "express";
import multer from "multer";
import OpenAI from "openai";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Session store ─────────────────────────────────────────────────────────────

interface SessionMsg {
  role: "user" | "assistant";
  content: string;
}

interface SessionData {
  messages: SessionMsg[];
  lastAccess: number;
}

const sessions = new Map<string, SessionData>();

function getSession(id: string): SessionData {
  let s = sessions.get(id);
  if (!s) {
    s = { messages: [], lastAccess: Date.now() };
    sessions.set(id, s);
  }
  s.lastAccess = Date.now();
  return s;
}

// Prune old sessions every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of sessions) {
    if (v.lastAccess < cutoff) sessions.delete(k);
  }
}, 10 * 60 * 1000);

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_item",
      description: "Add an item to the customer's current order. Match item by name from the catalog.",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "Name of the item to add (matched from catalog)" },
          quantity: { type: "integer", description: "How many to add (default 1)", default: 1 },
        },
        required: ["item_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_item",
      description: "Remove an item from the current order by name.",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "Name of the item to remove" },
        },
        required: ["item_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order",
      description: "Get the current order summary with all items and total.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_order",
      description: "Clear all items from the current order.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_order",
      description: "Submit and process the current order through the POS system.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ── Order command types ───────────────────────────────────────────────────────

interface OrderCommand {
  action: "add" | "remove" | "clear" | "submit";
  item_id?: string;
  item_name?: string;
  quantity?: number;
  price?: number;
}

interface CatalogItem {
  id: string;
  name: string;
  price: number;
  category?: string;
}

interface OrderItem {
  id?: string;
  name: string;
  price: number;
  quantity: number;
}

function executeTool(
  name: string,
  params: Record<string, unknown>,
  catalog: CatalogItem[],
  currentOrder: OrderItem[]
): { result: string; command?: OrderCommand } {
  switch (name) {
    case "add_item": {
      const query = String(params.item_name ?? "").toLowerCase().trim();
      const qty = Number(params.quantity ?? 1);
      const found = catalog.find(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          query.includes(c.name.toLowerCase())
      );
      if (!found) {
        return { result: `Item "${params.item_name}" not found in catalog. Available: ${catalog.map((c) => c.name).join(", ")}` };
      }
      return {
        result: `Added ${qty}x ${found.name} at $${found.price.toFixed(2)} each. Total for this item: $${(found.price * qty).toFixed(2)}.`,
        command: { action: "add", item_id: found.id, item_name: found.name, quantity: qty, price: found.price },
      };
    }

    case "remove_item": {
      const query = String(params.item_name ?? "").toLowerCase().trim();
      const line = currentOrder.find((i) => i.name.toLowerCase().includes(query));
      if (!line) {
        return { result: `"${params.item_name}" is not in the current order.` };
      }
      return {
        result: `Removed ${line.name} from the order.`,
        command: { action: "remove", item_name: line.name },
      };
    }

    case "get_order": {
      if (currentOrder.length === 0) return { result: "The order is currently empty." };
      const lines = currentOrder.map(
        (i) => `${i.quantity}x ${i.name} ($${(i.price * i.quantity).toFixed(2)})`
      );
      const total = currentOrder.reduce((s, i) => s + i.price * i.quantity, 0);
      return { result: `Current order: ${lines.join(", ")}. Total: $${total.toFixed(2)}.` };
    }

    case "clear_order": {
      return { result: "Order cleared. Starting fresh.", command: { action: "clear" } };
    }

    case "submit_order": {
      if (currentOrder.length === 0) {
        return { result: "The order is empty — nothing to submit." };
      }
      const total = currentOrder.reduce((s, i) => s + i.price * i.quantity, 0);
      return {
        result: `Order submitted. Total charged: $${total.toFixed(2)}.`,
        command: { action: "submit" },
      };
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

function detectAudioFormat(mimetype: string): "wav" | "mp3" | "m4a" | "ogg" | "webm" | "flac" {
  if (mimetype.includes("webm")) return "webm";
  if (mimetype.includes("mp4") || mimetype.includes("m4a") || mimetype.includes("aac")) return "m4a";
  if (mimetype.includes("wav") || mimetype.includes("wave")) return "wav";
  if (mimetype.includes("ogg")) return "ogg";
  if (mimetype.includes("mp3") || mimetype.includes("mpeg")) return "mp3";
  if (mimetype.includes("flac")) return "flac";
  return "webm";
}

function buildSystemPrompt(catalog: CatalogItem[], currentOrder: OrderItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
      : "  (No catalog loaded — ask user to connect Square POS)";

  const orderStr =
    currentOrder.length > 0
      ? currentOrder.map((i) => `  - ${i.quantity}x ${i.name}: $${(i.price * i.quantity).toFixed(2)}`).join("\n")
      : "  (empty)";

  return `You are a fast, friendly voice POS assistant for a retail/food business.
Your job: ring up orders by voice — add, remove, and confirm items accurately.

Available catalog:
${catalogStr}

Current order:
${orderStr}

Rules:
- Be brief and conversational (1–2 short sentences max).
- Always confirm actions ("Added 2 coffees!", "Got it, removed the burger.").
- Use tools for every order action — never guess or describe without calling a tool.
- Match items by name flexibly (e.g. "large coffee" → "Coffee", "burger" → "Cheeseburger").
- If item not found, say so and suggest what's available.
- On submit, confirm the total.`;
}

// ── POST /api/voice/chat ──────────────────────────────────────────────────────

router.post(
  "/chat",
  upload.single("audio"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const audioFile = (req as any).file as Express.Multer.File | undefined;
      if (!audioFile) {
        res.status(400).json({ error: "No audio file — expected field name: 'audio'" });
        return;
      }

      const sessionId: string = (req.body.session_id as string) || "default";
      let catalog: CatalogItem[] = [];
      let currentOrder: OrderItem[] = [];
      try { catalog = JSON.parse(req.body.catalog || "[]"); } catch {}
      try { currentOrder = JSON.parse(req.body.current_order || "[]"); } catch {}

      const session = getSession(sessionId);
      const systemPrompt = buildSystemPrompt(catalog, currentOrder);
      const audioBase64 = audioFile.buffer.toString("base64");
      const audioFormat = detectAudioFormat(audioFile.mimetype || "audio/webm");

      console.log(`[Voice] session=${sessionId} audio=${audioFile.size}b format=${audioFormat} catalog=${catalog.length} order=${currentOrder.length}`);

      // Build messages: system + history (as text) + current audio turn
      const historyMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        session.messages.map((m) => ({ role: m.role, content: m.content }));

      const audioUserMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: audioBase64, format: audioFormat },
          } as any,
        ],
      };

      const messagesRound1: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...historyMsgs,
        audioUserMsg,
      ];

      // First LLM call: speech-in, may return tool calls or direct audio
      const resp1 = await openai.chat.completions.create({
        model: "gpt-audio-mini",
        modalities: ["text", "audio"],
        audio: { voice: "alloy", format: "wav" },
        messages: messagesRound1,
        tools: TOOLS,
        tool_choice: "auto",
        max_completion_tokens: 256,
      } as any);

      const msg1 = resp1.choices[0].message as any;
      const userTranscript: string = msg1.audio?.transcript ?? "";

      const orderCommands: OrderCommand[] = [];
      let finalAudioB64: string | null = null;
      let finalText = "";

      if (msg1.tool_calls && msg1.tool_calls.length > 0) {
        // Execute all tool calls
        const toolResultMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        for (const tc of msg1.tool_calls) {
          let params: Record<string, unknown> = {};
          try { params = JSON.parse(tc.function.arguments); } catch {}
          const { result, command } = executeTool(tc.function.name, params, catalog, currentOrder);
          if (command) orderCommands.push(command);
          toolResultMsgs.push({ role: "tool", tool_call_id: tc.id, content: result });
          console.log(`[Tool] ${tc.function.name}(${tc.function.arguments}) → ${result}`);
        }

        // Strip audio data from assistant message before storing in history
        const assistantMsgForHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
          role: "assistant",
          content: msg1.content ?? null,
          tool_calls: msg1.tool_calls,
        } as any;
        if (msg1.audio?.id) {
          (assistantMsgForHistory as any).audio = { id: msg1.audio.id };
        }

        // Second call: get spoken response to tool results
        const messagesRound2: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...historyMsgs,
          { role: "user", content: userTranscript || "(audio input)" },
          assistantMsgForHistory,
          ...toolResultMsgs,
        ];

        const resp2 = await openai.chat.completions.create({
          model: "gpt-audio-mini",
          modalities: ["text", "audio"],
          audio: { voice: "alloy", format: "wav" },
          messages: messagesRound2,
          max_completion_tokens: 200,
        } as any);

        const msg2 = resp2.choices[0].message as any;
        finalAudioB64 = msg2.audio?.data ?? null;
        finalText = msg2.audio?.transcript ?? (typeof msg2.content === "string" ? msg2.content : "") ?? "";
      } else {
        // Direct audio response
        finalAudioB64 = msg1.audio?.data ?? null;
        finalText = msg1.audio?.transcript ?? (typeof msg1.content === "string" ? msg1.content : "") ?? "";
      }

      // Persist text history (not audio blobs)
      if (userTranscript) session.messages.push({ role: "user", content: userTranscript });
      if (finalText) session.messages.push({ role: "assistant", content: finalText });
      if (session.messages.length > 40) session.messages = session.messages.slice(-40);

      console.log(`[Voice] user="${userTranscript}" agent="${finalText}" cmds=${orderCommands.length} audio=${finalAudioB64 ? "yes" : "no"}`);

      res.json({
        user_transcript: userTranscript,
        agent_text: finalText,
        audio_b64: finalAudioB64,
        audio_format: "wav",
        order_commands: orderCommands,
      });
    } catch (e: any) {
      console.error("[Voice] Error:", e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Voice processing failed" });
    }
  }
);

export default router;
