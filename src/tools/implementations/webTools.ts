import type { ToolDefinition, ToolResult } from '../registry';
import { cap } from './toolUtils';

function getApiKey(): string {
  const key = process.env.APIFY_KEY || process.env.APIFY_TOKEN;
  if (!key) throw new Error('APIFY_KEY not set in .env. Add APIFY_KEY=your_apify_api_token');
  return key;
}

async function runApifyActor(actorId: string, input: unknown, apiKey: string): Promise<any[]> {
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}&waitForFinish=60`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!runRes.ok) {
    const errText = await runRes.text();
    throw new Error(`Apify API error (${runRes.status}): ${errText.slice(0, 200)}`);
  }
  const runData = await runRes.json() as any;
  const datasetId = runData?.data?.defaultDatasetId;
  if (!datasetId) throw new Error('Apify run did not return a dataset ID');
  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&format=json`,
  );
  if (!itemsRes.ok) throw new Error(`Apify dataset error: ${itemsRes.status}`);
  return itemsRes.json() as Promise<any[]>;
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web using Apify Google Search. Returns title, URL, and snippet for each result. Set APIFY_KEY in .env.',
  params: [
    { name: 'query', type: 'string', required: true, description: 'Search query.' },
    { name: 'limit', type: 'number', required: false, description: 'Number of results. Defaults to 5. Max 20.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.query !== 'string') throw new Error('query must be a string');
      const limit = Math.min(typeof params.limit === 'number' ? params.limit : 5, 20);
      const apiKey = getApiKey();
      const items = await runApifyActor('apify~google-search-scraper', {
        queries: params.query,
        resultsPerPage: limit,
        maxPagesPerQuery: 1,
        mobileResults: false,
      }, apiKey);
       if (!Array.isArray(items) || items.length === 0) {
        return { success: true, output: `No results found for "${params.query}".` };
      }
      const organicResults = items[0]?.organicResults ?? items;
      if (!Array.isArray(organicResults) || organicResults.length === 0) {
        return { success: true, output: `No results found for "${params.query}".` };
      }
      const results = organicResults.slice(0, limit).map((item: any, idx: number) => {
        const title = item.title || 'No title';
        const url = item.url || '';
        const snippet = item.snippet || item.description || '';
        return `${idx + 1}. ${cap(title, 120)}\n${url}\n${cap(snippet, 300)}`;
      }).join('\n\n');
      return { success: true, output: results };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Web search failed' };
    }
  }
};

export const apifyScrapeTool: ToolDefinition = {
  name: 'apify_scrape',
  description: 'Extract clean text content from a URL using Apify Website Content Crawler. Set APIFY_KEY in .env.',
  params: [
    { name: 'url', type: 'string', required: true, description: 'URL to scrape.' },
    { name: 'maxChars', type: 'number', required: false, description: 'Max characters to return. Defaults to 12000.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.url !== 'string') throw new Error('url must be a string');
      const maxChars = typeof params.maxChars === 'number' ? params.maxChars : 12000;
      const apiKey = getApiKey();
      const items = await runApifyActor('apify~website-content-crawler', {
        startUrls: [{ url: params.url }],
        maxCrawlingDepth: 0,
        maxPagesPerCrawl: 1,
        extractMainContent: true,
      }, apiKey);
      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, output: '', error: `No content extracted from ${params.url}` };
      }
      const page = items[0];
      const title = page.title || page.metadata?.title || '';
      const text = page.text || page.content || '';
      const output = title ? `# ${title}\n\n${cap(text, maxChars)}` : cap(text, maxChars);
      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to scrape URL' };
    }
  }
};

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
