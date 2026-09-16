import type { InferSelectModel } from 'drizzle-orm';
import type { agents, memories, skills } from '../db/schema.js';

type AgentRecord = InferSelectModel<typeof agents>;
type SkillRecord = InferSelectModel<typeof skills>;
type MemoryRecord = InferSelectModel<typeof memories>;

export function buildEffectivePrompt(agent: AgentRecord, orderedSkills: SkillRecord[], memoryRows: MemoryRecord[]): string {
  const sections: string[] = [`# Agent Instructions\n${agent.instructions.trim()}`];

  const enabledSkills = orderedSkills.filter((skill) => skill.enabled);
  if (enabledSkills.length) {
    sections.push(`# Skills\n${enabledSkills.map((skill, index) => `## ${index + 1}. ${skill.name}\n${skill.instructions.trim()}`).join('\n\n')}`);
  }

  if (memoryRows.length) {
    sections.push(`# Long-term Memory\nUse these persisted facts only when relevant. Do not claim they came from the current conversation.\n${memoryRows.map((memory) => `- ${memory.key ? `${memory.key}: ` : ''}${memory.content}`).join('\n')}`);
  }

  return sections.join('\n\n');
}
