export class GenerationError extends Error {
  constructor(public statusCode: number, public code: string, message: string,
    public diagnostics: { file: string; line: number; column: number; reason: string }[] = []) {
    super(message); this.name = 'GenerationError';
  }
}
