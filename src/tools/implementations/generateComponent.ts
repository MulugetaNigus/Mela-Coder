import type { ToolDefinition, ToolResult } from '../registry';

export const generateComponentTool: ToolDefinition = {
  name: 'generate_component',
  description: 'Scaffold a new UI component with states, types, accessibility, and a story.',
  params: [
    { name: 'name', type: 'string', required: true, description: 'PascalCase component name.' },
    { name: 'framework', type: 'string', required: true, description: 'Target framework: react, vue, svelte.' },
    { name: 'hasLoading', type: 'boolean', required: false, description: 'Include loading state.' },
    { name: 'hasError', type: 'boolean', required: false, description: 'Include error state.' },
    { name: 'hasEmpty', type: 'boolean', required: false, description: 'Include empty state.' },
  ],
  async execute(params): Promise<ToolResult> {
    const name = typeof params.name === 'string' ? params.name : '';
    const framework = typeof params.framework === 'string' ? params.framework : 'react';
    if (!name) return { success: false, output: '', error: 'name is required' };
    if (!['react', 'vue', 'svelte'].includes(framework)) {
      return { success: false, output: '', error: `Unknown framework: ${framework}. Use react, vue, or svelte.` };
    }
    const hasLoading = params.hasLoading === true;
    const hasError = params.hasError === true;
    const hasEmpty = params.hasEmpty === true;

    const states = ['idle'].concat(hasLoading ? ['loading'] : [], hasError ? ['error'] : [], hasEmpty ? ['empty'] : []);

    let componentCode = '';
    if (framework === 'react') {
      componentCode = `import { useState } from 'react';

interface ${name}Props {
  data?: string[];
  onAction?: () => void;
  className?: string;
}

type ${name}State = 'idle'${states.includes('loading') ? " | 'loading'" : ''}${states.includes('error') ? " | 'error'" : ''}${states.includes('empty') ? " | 'empty'" : ''};

export function ${name}({ data, onAction, className }: ${name}Props) {
  const [state, setState] = useState<${name}State>('idle');

  if (state === 'loading') {
    return <div role="status" aria-label="Loading">${name} is loading...</div>;
  }

  if (state === 'error') {
    return <div role="alert">Something went wrong. Please try again.</div>;
  }

  if (state === 'empty' || (data && data.length === 0)) {
    return <div>No data available.</div>;
  }

  return (
    <div className={className}>
      <h2>${name}</h2>
      <button onClick={onAction} aria-label="Trigger action">
        Action
      </button>
    </div>
  );
}
`;
    } else if (framework === 'vue') {
      componentCode = `<template>
  <div v-if="state === 'loading'" role="status" aria-label="Loading">
    ${name} is loading...
  </div>
  <div v-else-if="state === 'error'" role="alert">
    Something went wrong. Please try again.
  </div>
  <div v-else-if="state === 'empty' || (data && data.length === 0)">
    No data available.
  </div>
  <div v-else :class="className">
    <h2>${name}</h2>
    <button @click="onAction" aria-label="Trigger action">Action</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  data?: string[];
  onAction?: () => void;
  className?: string;
}>();

type ${name}State = 'idle'${states.includes('loading') ? " | 'loading'" : ''}${states.includes('error') ? " | 'error'" : ''}${states.includes('empty') ? " | 'empty'" : ''};

const state = ref<${name}State>('idle');
</script>
`;
    } else {
      // svelte
      componentCode = `<script lang="ts">
  let { data = [], onAction, className = '' }: {
    data?: string[];
    onAction?: () => void;
    className?: string;
  } = $props();

  type ${name}State = 'idle'${states.includes('loading') ? " | 'loading'" : ''}${states.includes('error') ? " | 'error'" : ''}${states.includes('empty') ? " | 'empty'" : ''};
  let state: ${name}State = 'idle';
</script>

{#if state === 'loading'}
  <div role="status" aria-label="Loading">${name} is loading...</div>
{:else if state === 'error'}
  <div role="alert">Something went wrong. Please try again.</div>
{:else if state === 'empty' || data.length === 0}
  <div>No data available.</div>
{:else}
  <div class={className}>
    <h2>${name}</h2>
    <button onclick={onAction} aria-label="Trigger action">Action</button>
  </div>
{/if}
`;
    }

    return {
      success: true,
      output: `Generated ${name} component for ${framework}.\nStates: ${states.join(', ')}.\n\n\`\`\`\n${componentCode}\n\`\`\`\n\nUse write_file to save this component to disk.`,
    };
  }
};
