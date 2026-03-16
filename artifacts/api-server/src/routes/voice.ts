import { Router, type IRouter, Request, Response } from "express";
import multer from "multer";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

// multer: keep file in memory as Buffer
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/voice/transcribe — STT via ElevenLabs Scribe
router.post("/transcribe", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "No audio file received. Expected field name: 'file'" });
    }

    console.log(`[STT] Received audio: ${file.originalname}, size=${file.size}, mime=${file.mimetype}`);

    // ElevenLabs Scribe expects multipart/form-data with:
    //   file   = audio buffer
    //   model_id = "scribe_v1"
    const modelId = (req.body?.model_id as string) || "scribe_v1";

    // Use native FormData + Blob (Node 18+)
    const fd = new FormData();
    const audioBlob = new Blob([file.buffer], { type: file.mimetype || "audio/webm" });
    fd.append("file", audioBlob, file.originalname || "recording.webm");
    fd.append("model_id", modelId);

    const response = await connectors.proxy("elevenlabs", "/v1/speech-to-text", {
      method: "POST",
      body: fd,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[STT] ElevenLabs error:", response.status, errText);
      return res.status(502).json({ error: "Transcription failed", details: errText });
    }

    const data = await response.json() as any;
    console.log("[STT] Success:", data.text?.slice(0, 80));
    res.json({ text: data.text || "" });
  } catch (e: any) {
    console.error("[STT] Error:", e);
    res.status(500).json({ error: e.message || "Transcription failed" });
  }
});

// POST /api/voice/chat — Streaming AI agent response
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { messages = [] } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const userMessage = messages[messages.length - 1]?.content || "";
    const { text, actions } = await generateAgentResponse(userMessage, messages);

    // Stream word by word for natural feel
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? "" : " ") + words[i];
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      await delay(15);
    }

    for (const action of actions) {
      res.write(`data: ${JSON.stringify({ action })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e: any) {
    console.error("[Chat] Error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || "Chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ content: "I encountered an error. Please try again." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

// POST /api/voice/synthesize — TTS via ElevenLabs
router.post("/synthesize", async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

    const ttsResponse = await connectors.proxy(
      "elevenlabs",
      `/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
          output_format: "mp3_22050_32",
        }),
      }
    );

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      console.error("[TTS] ElevenLabs error:", ttsResponse.status, errText);
      return res.status(502).json({ error: "TTS failed", details: errText });
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.byteLength.toString());
    res.send(Buffer.from(audioBuffer));
  } catch (e: any) {
    console.error("[TTS] Error:", e);
    res.status(500).json({ error: e.message || "Synthesis failed" });
  }
});

// ─── Agent Intelligence ──────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Action {
  type: string;
  itemName?: string;
  quantity?: number;
}

async function generateAgentResponse(
  userMessage: string,
  history: { role: string; content: string }[]
): Promise<{ text: string; actions: Action[] }> {
  const msg = userMessage.toLowerCase();
  const actions: Action[] = [];

  const qtyWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };

  // ── Add items ──────────────────────────────────────────────────────────────
  if (
    msg.includes("add") || msg.includes("put") || msg.includes("ring up") ||
    msg.includes("i'll have") || msg.includes("i want") || msg.includes("give me") ||
    msg.includes("get me") || msg.includes("can i get") || msg.includes("i'll take") ||
    msg.includes("i'd like") || msg.includes("i have") || msg.includes("i take")
  ) {
    let quantity = 1;
    const numericQty = msg.match(/\b(\d+)\s+/);
    if (numericQty) {
      quantity = parseInt(numericQty[1], 10);
    } else {
      for (const [word, val] of Object.entries(qtyWords)) {
        if (msg.includes(word + " ") || msg.endsWith(word)) { quantity = val; break; }
      }
    }

    const afterAction = msg
      .replace(/^(add|put|ring up|give me|get me|can i get|i'll have|i want|i'd like|i'll take|i have|i take)\s+/i, "")
      .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, "")
      .replace(/\s*(please|to (?:the )?(?:order|cart|tab))$/i, "")
      .replace(/\s+and\s+.*/i, "")
      .trim();

    const andMatch = userMessage.match(/\band\s+(.+?)(?:\s+please|$)/i);
    const hasMultiple = andMatch?.[1];

    if (afterAction) {
      actions.push({ type: "ADD_ITEM", itemName: afterAction, quantity });
      if (hasMultiple) {
        const secondItem = hasMultiple
          .replace(/\b(one|two|three|four|five|\d+)\s+/i, "")
          .replace(/\s*(please)$/i, "").trim();
        if (secondItem) actions.push({ type: "ADD_ITEM", itemName: secondItem, quantity: 1 });
      }
      const qtyStr = quantity === 1 ? "" : `${quantity} `;
      const itemsStr = hasMultiple
        ? `${afterAction} and ${hasMultiple.replace(/\b(one|two|three|four|five|\d+)\s+/i, "").trim()}`
        : afterAction;
      return { text: `Adding ${qtyStr}${itemsStr} to your order.`, actions };
    }
  }

  // ── Remove items ───────────────────────────────────────────────────────────
  if (msg.includes("remove") || msg.includes("take off") || msg.includes("delete") || msg.includes("cancel")) {
    const afterVerb = msg
      .replace(/^(remove|take off|delete|cancel)\s+/i, "")
      .replace(/\b(one|two|three|four|five|\d+)\s+/i, "")
      .replace(/\s*(please)$/i, "").trim();
    if (afterVerb) {
      actions.push({ type: "REMOVE_ITEM", itemName: afterVerb, quantity: 1 });
      return { text: `Removing ${afterVerb}.`, actions };
    }
  }

  // ── Show order ─────────────────────────────────────────────────────────────
  if ((msg.includes("show") || msg.includes("what") || msg.includes("review")) &&
      (msg.includes("order") || msg.includes("cart") || msg.includes("have so far"))) {
    actions.push({ type: "SHOW_ORDER" });
    return { text: "Here's your current order.", actions };
  }

  if (msg.includes("total") || msg.includes("how much") || msg.includes("what's the total")) {
    actions.push({ type: "SHOW_ORDER" });
    return { text: "Let me pull up the order total.", actions };
  }

  // ── Clear order ────────────────────────────────────────────────────────────
  if (msg.includes("clear") || msg.includes("start over") || msg.includes("reset") || msg.includes("empty")) {
    actions.push({ type: "CLEAR_ORDER" });
    return { text: "Order cleared. Starting fresh!", actions };
  }

  // ── Submit order ───────────────────────────────────────────────────────────
  if (
    msg.includes("submit") || msg.includes("process") || msg.includes("charge") ||
    msg.includes("checkout") || msg.includes("that's all") || msg.includes("thats all") ||
    msg.includes("done") || msg.includes("finish") || msg.includes("complete")
  ) {
    actions.push({ type: "SUBMIT_ORDER" });
    return { text: "Processing your order now.", actions };
  }

  // ── Greetings ──────────────────────────────────────────────────────────────
  if (msg.includes("hello") || msg.includes("hey") || msg.includes("hi")) {
    return { text: "Hey! Ready to take your order. What can I get you?", actions };
  }

  // ── Help ───────────────────────────────────────────────────────────────────
  if (msg.includes("help") || msg.includes("what can you")) {
    return {
      text: "I can add or remove items, show your order total, and process payment. Just tell me what you need!",
      actions,
    };
  }

  // ── Menu / catalog ─────────────────────────────────────────────────────────
  if (msg.includes("menu") || msg.includes("catalog") || msg.includes("available") || msg.includes("options")) {
    return { text: "Check the Catalog tab to browse everything. Just tell me what to add!", actions };
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return { text: "Got it! What would you like to add to the order?", actions };
}

export default router;
