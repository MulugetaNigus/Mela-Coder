import fs from 'node:fs';
import path from 'node:path';

export interface Skill {
  name: string;      // File name without extension, e.g. "frontend-design"
  content: string;   // The raw content of the skill file
  triggers: RegExp;  // Pattern to match against the task prompt
}

const CUSTOM_SKILL_TRIGGERS: Record<string, RegExp> = {
  // Only enter explicit plan-only mode when the user asks for planning.
  // Broad coding verbs caused normal implementation requests to stop after a plan.
  'create-plan': /(?:^|\b)(?:\/plan|--plan|plan\s+(?:how|for|out)|create\s+(?:a\s+)?plan|implementation\s+plan|design\s+the\s+architecture|think\s+through|before\s+(?:you\s+)?(?:implement|coding|editing)|what'?s\s+the\s+best\s+way|review\s+my\s+approach|what\s+would\s+break)\b/i,
  'security-first': /\b(auth|authentication|authorization|login|signup|password|session|cookie|token|oauth|jwt|api key|secret|credential|permission|csrf|xss|sql injection|input validation|sanitize|external api|webhook|upload|ssl|tls)\b/i,
  'refactor-master': /\b(refactor|cleanup|clean up|simplify|legacy|technical debt|cyclomatic|complexity|duplicate|duplication|rename|extract method|long function|code smell)\b/i,
  'debug-ninja': /\b(debug|bug|broken|not working|doesn't work|does not work|failing|fails|failed|error|exception|crash|stack trace|test fail|hang|stuck|loop|wrong output)\b/i,
  'optimize-performance': /\b(performance|optimi[sz]e|slow|latency|bottleneck|profile|benchmark|memory|cpu|large dataset|real[- ]time|rendering|cache|n\+1|hot path|throughput)\b/i,
  'api-design': /\b(api|endpoint|route|rest|graphql|schema|sdk|openapi|swagger|webhook|contract|pagination|versioning|status code|error format)\b/i,
  'database-migration': /\b(database|db|migration|schema|model|table|column|index|constraint|relation|orm|backfill|rollback|seed|prisma|sequelize|typeorm|knex|sql)\b/i,
};

const SKILL_PRIORITY: Record<string, number> = {
  'security-first': 100,
  'database-migration': 90,
  'api-design': 80,
  'debug-ninja': 70,
  'optimize-performance': 60,
  'refactor-master': 50,
  'frontend-design': 40,
  'create-plan': 10,
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
    return skills
      .filter(skill => skill.triggers.test(task))
      .sort((a, b) => (SKILL_PRIORITY[b.name] ?? 0) - (SKILL_PRIORITY[a.name] ?? 0));
  }
}
