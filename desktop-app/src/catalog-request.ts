let sequence = 0;
export const catalogRequestId = (purpose: string) => `${purpose}:${Date.now()}:${++sequence}`;
