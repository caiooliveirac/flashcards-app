import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAiEnabled } from "@/lib/ai/config";
import { ASSISTANT_LIMITS } from "@/lib/ai/assistant/config";
import { checkRateLimit } from "@/lib/ai/assistant/rate-limit";
import { recordUsage } from "@/lib/ai/assistant/usage-store";
import { streamAssistant } from "@/lib/ai/assistant/stream";

// Streaming SSE precisa de Node + rota dinâmica (§9.1). O heartbeat abaixo evita
// o corte do Cloudflare (524 após ~100s sem bytes) no perfil aprofundado.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20000),
      }),
    )
    .min(1)
    .max(40),
  forceDeep: z.boolean().optional(),
  context: z
    .object({
      deckName: z.string().max(200).optional(),
      cardText: z.string().max(20000).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "assistente indisponível" },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "requisição inválida" }, { status: 400 });
  }

  const userId = session.user.id;
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return NextResponse.json({ error: "sem pergunta" }, { status: 400 });
  }

  const gate = await checkRateLimit(userId, {
    messageChars: lastUser.content.length,
    contextChars:
      (body.context?.cardText?.length ?? 0) +
      (body.context?.deckName?.length ?? 0),
  });
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.message, code: gate.code },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // controller já fechado — ignorado no finally
        }
      }, 15_000);

      try {
        for await (const ev of streamAssistant({
          history: body.messages.slice(-ASSISTANT_LIMITS.maxHistoryTurns * 2),
          forceDeep: body.forceDeep,
          context: body.context,
        })) {
          if (ev.type === "meta") {
            send("meta", { tier: ev.tier, model: ev.model });
          } else if (ev.type === "delta") {
            send("delta", { text: ev.text });
          } else if (ev.type === "draft") {
            send("draft", ev.draft);
          } else {
            await recordUsage(userId, {
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              costUsd: ev.costUsd,
            });
            send("done", { costUsd: ev.costUsd });
          }
        }
      } catch {
        send("error", { message: "Falha ao responder. Tente de novo." });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
