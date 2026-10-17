export class RuntimeAdapterError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeAdapterError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function invalid(message: string): never {
  throw new RuntimeAdapterError('INVALID_RUNTIME_INPUT', message);
}

export function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} must be a nonempty string`);
  return value;
}
