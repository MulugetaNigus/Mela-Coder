import type { ToolDefinition, ToolResult } from '../registry';
import { cap } from './toolUtils';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and return top result snippets.',
  params: [
    { name: 'query', type: 'string', required: true, description: 'Search query.' },
    { name: 'limit', type: 'number', required: false, description: 'Number of results. Defaults to 5.' }
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.query !== 'string') throw new Error('query must be a string');
      const limit = typeof params.limit === 'number' ? params.limit : 5;
      const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`);
      const html = await response.text();
      const results = Array.from(html.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g))
        .slice(0, limit)
        .map((match, index) => `${index + 1}. ${stripHtml(match[2])}\n${match[1]}\n${stripHtml(match[3])}`);
      return { success: response.ok, output: results.length ? results.join('\n\n') : `No web results found for ${params.query}`, error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Web search failed' };
    }
  }
};

export const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch readable text content from a URL.',
  params: [{ name: 'url', type: 'string', required: true, description: 'URL to fetch.' }],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.url !== 'string') throw new Error('url must be a string');
      const response = await fetch(params.url);
      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      const output = contentType.includes('text/html') ? stripHtml(text) : text;
      return { success: response.ok, output: cap(output, 12000), error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to fetch URL' };
    }
  }
};

export const readGithubIssueTool: ToolDefinition = {
  name: 'read_github_issue',
  description: 'Fetch a GitHub issue or PR by URL, including comments.',
  params: [{ name: 'url', type: 'string', required: true, description: 'GitHub issue or PR URL.' }],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.url !== 'string') throw new Error('url must be a string');
      const match = params.url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/);
      if (!match) return { success: false, output: '', error: 'URL is not a GitHub issue or PR URL' };
      const [, owner, repo, number] = match;
      const issue = await (await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`)).json() as any;
      const comments = await (await fetch(issue.comments_url)).json() as any[];
      const output = [`# ${issue.title}`, `State: ${issue.state}`, `Labels: ${(issue.labels ?? []).map((label: any) => label.name).join(', ')}`, '', issue.body ?? '', '', ...comments.map(comment => `Comment by ${comment.user?.login}:\n${comment.body}`)].join('\n');
      return { success: true, output: cap(output, 16000) };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to read GitHub issue' };
    }
  }
};

export const readGithubFileTool: ToolDefinition = {
  name: 'read_github_file',
  description: 'Read a file directly from GitHub at a branch or commit.',
  params: [{ name: 'url', type: 'string', required: true, description: 'GitHub file URL.' }],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.url !== 'string') throw new Error('url must be a string');
      const match = params.url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
      if (!match) return { success: false, output: '', error: 'URL is not a GitHub blob file URL' };
      const [, owner, repo, ref, filePath] = match;
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
      const response = await fetch(rawUrl);
      return { success: response.ok, output: cap(await response.text(), 16000), error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to read GitHub file' };
    }
  }
};
