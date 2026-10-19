import { GoogleGenAI } from '@google/genai';
import { DRAFT_SCHEMA } from './prompts.ts';
import type { DraftText } from './fallback.ts';

/** The only thing the rest of the app knows about the model. Swap providers by writing another one. */
export interface AiClient {
  readonly model: string;
  generateDraft(input: { system: string; prompt: string }): Promise<DraftText>;
}

// gemini-3.6-flash is GA per Google's changelog; override with GEMINI_MODEL if needed.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const TIMEOUT_MS = 20_000;

export function createGeminiClient(apiKey: string, model = DEFAULT_GEMINI_MODEL): AiClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    model,
    async generateDraft({ system, prompt }) {
      const call = ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: DRAFT_SCHEMA,
          temperature: 0.6,
        },
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`AI timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      );
      const response = await Promise.race([call, timeout]);
      return parseDraft(response.text ?? '');
    },
  };
}

/** Rejects anything that isn't a usable draft, so the caller falls back to a template. */
export function parseDraft(raw: string): DraftText {
  const data = JSON.parse(raw) as Partial<DraftText>;
  const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  if (!subject || !body) throw new Error('AI returned an empty subject or body');
  return { subject, body };
}
