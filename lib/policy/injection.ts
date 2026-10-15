export interface InjectionFinding {
  rule: string;
  excerpt: string;
}

// Heuristics for instruction-like text inside merchant messages. These are a
// tripwire for quarantine and the UI, NOT the security boundary: authority only
// ever comes from the signed mandate row, so a missed injection still cannot spend.
const RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "system_override", pattern: /\b(system|admin|developer)\s*(override|prompt|message|mode|note)\b/i },
  { rule: "ignore_instructions", pattern: /\b(ignore|disregard|forget)\b.{0,30}\b(instructions|rules|mandate|guardrails|policy|previous)\b/i },
  { rule: "role_hijack", pattern: /\b(you are now|act as|new instructions|from now on you)\b/i },
  { rule: "fake_authorization", pattern: /\b(pre-?\s?authori[sz]ed|already (approved|authori[sz]ed)|has authori[sz]ed|authorization granted)\b/i },
  { rule: "payment_command", pattern: /\b(proceed|go ahead|continue)\s+(to|with)\s+(the\s+)?(capture|charge|payment|payout|checkout)\b/i },
  { rule: "limit_tampering", pattern: /\b(budget|mandate|limit|cap|threshold)\b.{0,40}\b(raised|increased|updated|overridden|removed|waived|is now)\b/i },
  { rule: "markup_injection", pattern: /<\/?\s*(system|instructions?|assistant|tool)\s*>|\[\s*(system|inst)\s*\]/i },
  { rule: "tool_call_injection", pattern: /\b(call|invoke|execute)\s+(the\s+)?(tool|function)\b|"(tool|function)_?call"/i },
];

export function scanForInjection(text: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { rule, pattern } of RULES) {
    const match = pattern.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 20);
      findings.push({ rule, excerpt: text.slice(start, match.index + match[0].length + 20).trim() });
    }
  }
  return findings;
}
