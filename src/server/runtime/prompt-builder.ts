import type { InferSelectModel } from 'drizzle-orm';
import type { agents, memories, skills } from '../db/schema.js';

type AgentRecord = InferSelectModel<typeof agents>;
type SkillRecord = InferSelectModel<typeof skills>;
type MemoryRecord = InferSelectModel<typeof memories>;

function limit(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
}

function bounded(value: string, max: number): { value: string; truncated: boolean } {
  if (value.length <= max) return { value, truncated: false };
  return { value: `${value.slice(0, Math.max(0, max - 28))}\n[context truncated]`, truncated: true };
}

export function buildEffectivePrompt(agent: AgentRecord, orderedSkills: SkillRecord[], memoryRows: MemoryRecord[]): string {
  const maxChars = limit('OAC_MAX_CONTEXT_CHARS', 100_000, 4_000, 500_000);
  const maxMemoryEntries = limit('OAC_MAX_MEMORY_ENTRIES', 100, 0, 10_000);
  const sections: string[] = [`# Agent Instructions\n${agent.instructions.trim()}`];

  const enabledSkills = orderedSkills.filter((skill) => skill.enabled);
  if (enabledSkills.length) {
    sections.push(`# Skills\n${enabledSkills.map((skill, index) => `## ${index + 1}. ${skill.name}\n${skill.instructions.trim()}`).join('\n\n')}`);
  }

  if (memoryRows.length) {
    sections.push(`# Long-term Memory\nUse these persisted facts only when relevant. Do not claim they came from the current conversation.\n${memoryRows.slice(0, maxMemoryEntries).map((memory) => `- ${memory.key ? `${memory.key}: ` : ''}${memory.content}`).join('\n')}`);
  }

  return bounded(sections.join('\n\n'), maxChars).value;
}
