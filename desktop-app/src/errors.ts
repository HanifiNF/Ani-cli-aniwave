export function messageFrom(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "").replace(/^\w*Error: /, "");
}
