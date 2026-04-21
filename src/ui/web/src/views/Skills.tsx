import { Icons } from "../components/Icons";
import { SkillManager } from "../components/SkillManager";

export function Skills() {
  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>Skills</h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            Reusable prompts + tool permissions &middot; <span className="mono">~/.openthk/skills/</span>
          </p>
        </div>
      </div>

      <SkillManager
        title="Global skills"
        description="These skills are available from the global ~/.openthk scope."
        emptyDescription="Create a global skill under ~/.openthk/skills."
      />
    </div>
  );
}
