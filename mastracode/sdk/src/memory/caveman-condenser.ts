import type { MemoryMessage } from './types.js';

export const CAVEMAN_MEMORY_INSTRUCTION = `Respond terse like smart caveman. All technical substance stay. Only fluff die.
Use full caveman compression style.
Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK.
Pattern: \`[thing] [action] [reason]. [next step]\``;

const FILLER_PATTERNS = [
  /^(Sure|Certainly|Of course|Happy to help|I'd be happy to help|I would be happy to help|I'd be happy to help you with that|I would be happy to help you with that|I have|I will|Let me|I am|Agent did|Agent)\b[!.,\s]*/gi,
  /\b(I would be|I'd be|happy to help|you with that)\b[!.,\s]*/gi,
  /\b(a|an|the|just|really|basically|actually|simply|sure|certainly|of course|happy to|in order to|please|kindly)\b/gi,
];

/**
 * Heuristic caveman compressor function.
 * Strips articles, pleasantries, hedging, and filler words while retaining technical details, error messages, and code.
 */
export function compressToCaveman(text: string): string {
  if (!text || text.trim().length === 0) return '';

  const lines = text.split('\n');
  const compressedLines: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Do not compress code blocks or verbatim errors
    if (line.startsWith('```') || line.startsWith('🔴') || line.startsWith('🟡') || line.startsWith('✅')) {
      compressedLines.push(line);
      continue;
    }

    // Strip pleasantries and introductory fluff
    for (const pattern of FILLER_PATTERNS) {
      line = line.replace(pattern, '');
    }

    // Remove leading punctuation left over from removed pleasantries (e.g. "! ", ", ")
    let cleaned = line.replace(/^[!.,;:]+\s*/, '').replace(/\s{2,}/g, ' ').trim();

    if (cleaned.length > 0) {
      // Capitalize first character of fragment
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      compressedLines.push(cleaned);
    }
  }

  return compressedLines.join('\n');
}

/**
 * Automatically condenses a list of historical session messages into a single Caveman observation entry.
 */
export function condenseMessagesToCaveman(messages: MemoryMessage[]): {
  observation: string;
  reflection: string;
  count: number;
} {
  if (!messages || messages.length === 0) {
    return { observation: '', reflection: '', count: 0 };
  }

  const observationParts: string[] = [];

  for (const msg of messages) {
    const rolePrefix = msg.role === 'user' ? 'user ask:' : msg.role === 'assistant' ? 'did:' : 'tool:';
    const compressed = compressToCaveman(msg.content);
    if (compressed) {
      observationParts.push(`${rolePrefix} ${compressed}`);
    }
  }

  const observation = observationParts.join(' | ');
  const reflection = `Summary of ${messages.length} messages: ${compressToCaveman(
    messages.map(m => m.content).join(' '),
  )}`;

  return {
    observation,
    reflection,
    count: messages.length,
  };
}
