import { createGenerator } from './generator.js';
import { createLlmProvider } from './llm.js';
import { createCompletionValidator } from './validation.js';
import type { GenerationOptions } from './types.js';

export function createGenerationAdapters(options: GenerationOptions) {
  return { generator: { ...createGenerator(options), ...createCompletionValidator(options) }, llm: createLlmProvider(options) };
}
