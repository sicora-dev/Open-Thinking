import { SkillManager } from "../components/SkillManager";

export function Skills() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <p className="text-xs text-ink-400 mb-5">
        Stored in <code className="text-ink-300">~/.openthk/skills/</code>
      </p>
      <SkillManager
        title="Global skills"
        description="These skills are available from the global ~/.openthk scope."
        emptyDescription="Create a global skill under ~/.openthk/skills."
      />
    </div>
  );
}
