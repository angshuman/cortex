import { describe, it, expect } from "vitest";
import { getSignaledSkillActivations, selectRelevantSkills } from "../server/agent";
import type { Skill } from "@shared/schema";

function mkSkill(partial: Partial<Skill> & Pick<Skill, "name">): Skill {
  return {
    name: partial.name,
    description: partial.description || partial.name,
    version: "1.0.0",
    instructions: partial.instructions || "",
    tools: partial.tools || [],
    enabled: partial.enabled ?? true,
    builtin: partial.builtin ?? false,
    triggerKeywords: partial.triggerKeywords || [],
    category: partial.category || "custom",
    instructionsOnly: partial.instructionsOnly ?? true,
    priority: partial.priority ?? 1,
    filePath: null,
  };
}

describe("selectRelevantSkills", () => {
  it("always includes priority 0 skills", () => {
    const skills = [
      mkSkill({ name: "core-a", priority: 0 }),
      mkSkill({ name: "normal-a", priority: 2, triggerKeywords: ["foobar"] }),
    ];
    const selected = selectRelevantSkills(skills, "hello world", [], []);
    expect(selected.some(s => s.skill.name === "core-a")).toBe(true);
    expect(selected.find(s => s.skill.name === "core-a")?.reason).toBe("always");
  });

  it("includes pinned skills regardless of keywords", () => {
    const skills = [
      mkSkill({ name: "research-pro", priority: 2, triggerKeywords: ["research"] }),
    ];
    const selected = selectRelevantSkills(skills, "hello world", [], ["research-pro"]);
    expect(selected.some(s => s.skill.name === "research-pro")).toBe(true);
    expect(selected.find(s => s.skill.name === "research-pro")?.reason).toBe("pinned");
  });

  it("matches keyword variants like investigate for research", () => {
    const skills = [
      mkSkill({ name: "research", priority: 2, triggerKeywords: ["research"] }),
    ];
    const selected = selectRelevantSkills(skills, "Please investigate this topic.", [], []);
    expect(selected.some(s => s.skill.name === "research")).toBe(true);
    const activation = selected.find(s => s.skill.name === "research");
    expect(activation?.reason).toBe("keyword");
    expect(activation?.matchedKeywords).toContain("research");
  });

  it("signals only keyword/pinned skills (not always-on defaults)", () => {
    const skills = [
      mkSkill({ name: "core-a", priority: 0 }),
      mkSkill({ name: "research", priority: 2, triggerKeywords: ["research"] }),
      mkSkill({ name: "no-keywords", priority: 2, triggerKeywords: [] }),
    ];
    const selected = selectRelevantSkills(skills, "investigate deeply", [], []);
    const signaled = getSignaledSkillActivations(selected);
    expect(signaled.some(s => s.skill.name === "research")).toBe(true);
    expect(signaled.some(s => s.skill.name === "core-a")).toBe(false);
    expect(signaled.some(s => s.skill.name === "no-keywords")).toBe(false);
  });
});

