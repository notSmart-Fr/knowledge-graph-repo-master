import { fileURLToPath } from "node:url";
import { sdk } from './otel-bootstrap.ts';
import { loadMonorepoEnv } from "./load-env.ts";
loadMonorepoEnv();

import {
  AutoSubscribe,
  cli,
  defineAgent,
  type JobContext,
  ServerOptions,
  voice,
} from "@livekit/agents";
import * as cartesia from "@livekit/agents-plugin-cartesia";

import { OrchestratorService } from "@dtc/ai-core/orchestrator";
import { logger } from "@dtc/ai-core/logger";

const orchestrator = new OrchestratorService();

function sanitizeForTTS(text: string): string {
  return text
    .replace(/([.!?])([A-Z])/g, "$1 $2")  // add space between sentences if missing
    .replace(/["""]/g, "")                  // strip quotation marks
    .replace(/[*_~`#]/g, "")               // strip markdown formatting
    .replace(/\s{2,}/g, " ")               // collapse multiple spaces
    .trim();
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    logger.info({ room: ctx.room.name }, "Connecting to WebRTC Room");

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const participant = await ctx.waitForParticipant();
    const platformUserId = participant.identity;

    const session = new voice.AgentSession({
      stt: new cartesia.STT({ model: "ink-2" }),
      tts: new cartesia.TTS({ voice: "f786b574-daa5-4673-aa0c-cbe3e8534c02" }),
      turnHandling: { turnDetection: "stt" },
    });

    const agent = new voice.Agent({
      instructions:
        "You are a voice concierge for a minimalist apparel storefront. Keep responses brief and helpful.",
    });

    await session.start({ agent, room: ctx.room });

    logger.info("Real-time audio pipeline online. Listening...");

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (event) => {
      if (!event.isFinal) return;

      const transcribedText = event.transcript;
      if (!transcribedText.trim()) return;

      const sanitized = sanitizeForTTS(transcribedText);
      logger.info({ transcript: sanitized }, "Transcribed Input");

      try {
        const result = await orchestrator.processIntent({
          channel: "livekit_voice",
          platformUserId,
          text: transcribedText,
        });

        const aiReply = sanitizeForTTS(result.text);
        logger.info({ text: aiReply }, "Orchestrator Yielded text");

        await session.say(aiReply);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ err: msg }, "Voice Pipeline Error");
        await session.say("I encountered an error accessing our catalog.");
      }
    });
  },
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown initiated");
  try {
    await orchestrator.close();
    await sdk.shutdown();
    logger.info("Voice agent closed successfully");
    process.exit(0);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ err: msg }, "Error during voice agent shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
