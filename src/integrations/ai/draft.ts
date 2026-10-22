/**
 * Calls an OpenAI-compatible chat endpoint to draft quote lines.
 *
 * Configuration comes from env vars only (AI_BASE_URL, AI_API_KEY, AI_MODEL),
 * so no key or private URL ever lives in the code. When no key is set, or the
 * call fails, the offline keyword matcher is used instead and the person is
 * told which one produced the draft.
 */
import OpenAI from "openai";
import {
  DRAFT_SYSTEM_PROMPT,
  keywordDraft,
  parseAiReply,
  priceListForPrompt,
  redactPersonalDetails,
  type DraftPriceItem,
  type DraftResult,
} from "@/domain/draft";

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL);
}

export async function draftLines(input: {
  description: string;
  priceItems: DraftPriceItem[];
  /** Customer name, address and similar, removed before sending. */
  personalTerms: string[];
}): Promise<DraftResult> {
  const fallback = () => keywordDraft(input.description, input.priceItems);
  if (!aiConfigured()) return fallback();

  const client = new OpenAI({
    apiKey: process.env.AI_API_KEY,
    baseURL: process.env.AI_BASE_URL,
    timeout: 20_000,
    maxRetries: 1,
  });
  const description = redactPersonalDetails(input.description, input.personalTerms);

  try {
    // Instructions go in the user message: some gateways drop system messages
    // for some models. No temperature: reasoning models reject or ignore it.
    const response = await client.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-5-nano",
      max_tokens: Number(process.env.AI_MAX_TOKENS || 400),
      messages: [
        {
          role: "user",
          content: `${DRAFT_SYSTEM_PROMPT}\n\nPrice list:\n${priceListForPrompt(input.priceItems)}\n\nJob description:\n${description}`,
        },
      ],
    });
    const reply = response.choices[0]?.message?.content ?? "";
    const parsed = parseAiReply(reply, input.priceItems);
    if (parsed) return parsed;
    const result = fallback();
    result.notes.unshift(
      "The AI reply couldn't be used, so this draft comes from keyword matching.",
    );
    return result;
  } catch (error) {
    // Never surface provider error text (it can include request details).
    console.error("AI draft failed:", error instanceof Error ? error.name : "unknown error");
    const result = fallback();
    result.notes.unshift(
      "The AI service didn't respond, so this draft comes from keyword matching.",
    );
    return result;
  }
}
