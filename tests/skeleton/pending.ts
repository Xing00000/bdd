export function pendingStep(sourceRef: string): never {
  const error = new Error(`PENDING_IMPLEMENTATION: ${sourceRef}; codegen skeleton only`);
  error.name = 'UnimplementedStepError';
  throw error;
}
