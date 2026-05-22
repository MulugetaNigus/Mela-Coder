import { ToolRegistry } from '../tools/registry';
import type { ToolDefinition } from '../tools/registry';
import { readFileTool } from '../tools/implementations/readFile';
import { writeFileTool } from '../tools/implementations/writeFile';
import { executeBashTool } from '../tools/implementations/executeBash';
import { listDirTool } from '../tools/implementations/listDir';
import { searchFilesTool } from '../tools/implementations/searchFiles';
import { findFilesTool, fileInfoTool } from '../tools/implementations/filesystemExtra';
import { webSearchTool, fetchUrlTool } from '../tools/implementations/webTools';
import { gitDiffTool, gitStatusTool } from '../tools/implementations/gitTools';
import { showDiffTool } from '../tools/implementations/uxTools';
import { findSymbolTool, getReferencesTool } from '../tools/implementations/codeIntel';
import { executeLongRunningTool, checkJobTool, readOutputTool } from '../tools/implementations/jobs';
import { globTool } from '../tools/implementations/globTool';
import { setOutputTool } from '../tools/implementations/setOutput';

function getTool(name: string): ToolDefinition | undefined {
  const toolMap: Record<string, ToolDefinition> = {
    'read_file': readFileTool,
    'write_file': writeFileTool,
    'execute_bash': executeBashTool,
    'list_dir': listDirTool,
    'search_files': searchFilesTool,
    'find_files': findFilesTool,
    'file_info': fileInfoTool,
    'web_search': webSearchTool,
    'fetch_url': fetchUrlTool,
    'git_diff': gitDiffTool,
    'git_status': gitStatusTool,
    'show_diff': showDiffTool,
    'find_symbol': findSymbolTool,
    'get_references': getReferencesTool,
    'execute_long_running': executeLongRunningTool,
    'check_job': checkJobTool,
    'read_output': readOutputTool,
    'glob': globTool,
    'set_output': setOutputTool
  };
  return toolMap[name];
}

export function createSubAgentRegistry(allowedTools: string[]): ToolRegistry {
  const registry = new ToolRegistry();

  for (const name of allowedTools) {
    const tool = getTool(name);
    if (tool) {
      registry.register(tool);
    }
  }

  return registry;
}
