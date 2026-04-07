import { SkillManager } from "../components/SkillManager";

export function Skills() {
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-lg font-medium">Skills</h1>
        <p className="text-xs text-ink-400 mt-0.5">
          Global skills stored in <code>~/.openthk/skills/</code>.
        </p>
      </header>
      <SkillManager
        title="Global skills"
        description="These skills are available from the global ~/.openthk scope."
        emptyDescription="Create a global skill under ~/.openthk/skills."
      />
    </div>
  );
}
