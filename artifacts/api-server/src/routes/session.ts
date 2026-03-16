// ElevenLabs direct API integration using ELEVENLABS_API_KEY env var
// Key is sourced from the ElevenLabs Replit connector via listConnections
import { Router, Request, Response } from "express";

const router = Router();

let cachedAgentId: string | null = null;

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY not set");
  return key;
}

async function elFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = getApiKey();
  return fetch(`https://api.elevenlabs.io${path}`, {
    ...options,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

const SYSTEM_PROMPT = `You are a fast, efficient voice POS agent for a Square retail business. Your job is to ring up orders by voice.

RULES:
- Be ultra-brief. 3-5 words per response max when confirming actions. ("Got it. Anything else?")
- Call tools immediately when you understand intent. Never ask for clarification unless truly ambiguous.
- When someone says an item name (coffee, sandwich, etc.), call add_item immediately.
- When done/checkout/that's all/submit/charge me → call submit_order immediately.
- To review order or hear total → call get_order.
- To clear/restart → call clear_order.
- To remove an item → call remove_item.

ITEM MATCHING: Pass the exact words the customer said as item_name. The system will fuzzy-match the catalog.

STYLE: Terse, transactional. You are a POS terminal, not a conversationalist.`;

const TOOLS = [
  {
    type: "client",
    name: "add_item",
    description: "Add an item to the current POS order",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "The name of the item as spoken by the customer" },
        quantity: { type: "integer", description: "How many to add. Default: 1" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "client",
    name: "remove_item",
    description: "Remove an item from the current POS order",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "The name of the item to remove" },
        quantity: { type: "integer", description: "How many to remove. Default: 1" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "client",
    name: "get_order",
    description: "Get the current order: items, quantities, and total price",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "client",
    name: "clear_order",
    description: "Clear all items from the current order",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "client",
    name: "submit_order",
    description: "Submit and process the current order through Square POS",
    parameters: { type: "object", properties: {} },
  },
];

async function getOrCreateAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  console.log("[Session] Creating ElevenLabs Conversational AI agent...");
  const res = await elFetch("/v1/convai/agents/create", {
    method: "POST",
    body: JSON.stringify({
      name: "Square Voice POS",
      conversation_config: {
        agent: {
          prompt: {
            prompt: SYSTEM_PROMPT,
            llm: "gemini-2.0-flash",
            temperature: 0.1,
            tools: TOOLS,
          },
          first_message: "Ready. What are we ringing up?",
          language: "en",
        },
        tts: {
          voice_id: "21m00Tcm4TlvDq8ikWAM",
          model_id: "eleven_turbo_v2_5",
          optimize_streaming_latency: 4,
        },
        turn: {
          turn_timeout: 6,
          silence_end_call_timeout: -1,
        },
        conversation: {
          max_duration_seconds: 3600,
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Agent creation failed: ${err}`);
  }

  const data = (await res.json()) as any;
  cachedAgentId = data.agent_id;
  console.log(`[Session] Agent created: ${cachedAgentId}`);
  return cachedAgentId!;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const agentId = await getOrCreateAgent();

    const urlRes = await elFetch(
      `/v1/convai/conversation/get_signed_url?agent_id=${agentId}`
    );

    if (!urlRes.ok) {
      const err = await urlRes.text();
      cachedAgentId = null;
      throw new Error(`Signed URL failed: ${err}`);
    }

    const { signed_url } = (await urlRes.json()) as any;
    console.log(`[Session] Signed URL issued for agent ${agentId}`);
    res.json({ signed_url, agent_id: agentId });
  } catch (e: any) {
    console.error("[Session]", e.message);
    cachedAgentId = null;
    res.status(500).json({ error: e.message });
  }
});

export default router;
