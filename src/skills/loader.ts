import fs from 'node:fs';
import path from 'node:path';

export interface Skill {
  name: string;      // File name without extension, e.g. "frontend-design"
  content: string;   // The raw content of the skill file
  triggers: RegExp;  // Pattern to match against the task prompt
}

const CUSTOM_SKILL_TRIGGERS: Record<string, RegExp> = {
  // Trigger on coding/task patterns - model decides if planning is needed
  'create-plan': /(?:implement|build|create|add|refactor|update|modify|write|generate|make|feature|component|function|api|auth|theme|css|html|page|cli)\b/i,
};

export class SkillLoader {
  private static readonly BUILTIN_SKILLS_DIR = path.join(__dirname, '../../src/skills');

  /**
   * Discover and load all .skill.md files in the skills directory.
   */
  static discoverSkills(): Skill[] {
    const skills: Skill[] = [];
    let skillsDir = SkillLoader.BUILTIN_SKILLS_DIR;

    // Fallback support if __dirname is resolved differently in dev/dist
    if (!fs.existsSync(skillsDir)) {
      skillsDir = path.join(process.cwd(), 'src/skills');
    }

    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    try {
      const files = fs.readdirSync(skillsDir);
      for (const file of files) {
        if (file.endsWith('.skill.md')) {
          const name = path.basename(file, '.skill.md');
          const filePath = path.join(skillsDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Use custom triggers for specific skills, or build from name
          let triggers = CUSTOM_SKILL_TRIGGERS[name] ?? new RegExp(`\\b(${name})\\b`, 'i');

          skills.push({
            name,
            content,
            triggers
          });
        }
      }
    } catch (error) {
      // Gracefully handle file system errors to prevent CLI crashes
    }

    return skills;
  }

  /**
   * Match a task description against discovered skills and return the list of matched skills.
   */
  static matchSkills(task: string, skills: Skill[]): Skill[] {
    return skills.filter(skill => skill.triggers.test(task));
  }
}
