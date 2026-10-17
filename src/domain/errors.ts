export interface Diagnostic {
  file?: string;
  line: number;
  column: number;
  code: string;
  reason: string;
  testKey?: string;
  sourceCaseKey?: string;
}
export class CoreError extends Error {
  statusCode: number;
  code: string;
  file?: string;
  diagnostics?: Diagnostic[];
  constructor(statusCode: number, code: string, message: string, details: { file?: string; diagnostics?: Diagnostic[] } = {}) {
    super(message);
    this.name = 'CoreError';
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, details);
  }
}
export const fail = (status: number, code: string, message: string): never => { throw new CoreError(status, code, message); };
export function invalid(file: string, code: string, diagnostics: Omit<Diagnostic, 'code'>[]): never {
  throw new CoreError(422, code, diagnostics.map(d => d.reason).join('; '), {
    file, diagnostics: diagnostics.map(d => ({ ...d, file: d.file ?? file, code })),
  });
}
