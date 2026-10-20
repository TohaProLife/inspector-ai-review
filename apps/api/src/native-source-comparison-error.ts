export class NativeSourceComparisonError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}
