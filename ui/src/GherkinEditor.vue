<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { dialects } from '@cucumber/gherkin';

const props = defineProps<{ modelValue: string; readonly?: boolean; label: string; placeholder?: string; testId?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const editorContainer = ref<HTMLDivElement | null>(null);
const editorInput = ref<HTMLTextAreaElement | null>(null);
const keywordGroups = computed(() => {
  const language = props.modelValue.match(/^\s*#\s*language:\s*([\w-]+)/m)?.[1] ?? 'en';
  const dialect = dialects[language];
  if (!dialect) return [];
  return [
    { names: [...dialect.feature, ...dialect.rule], className: 'gherkin-keyword--structure' },
    { names: [...dialect.background, ...dialect.scenario, ...dialect.scenarioOutline, ...dialect.examples], className: 'gherkin-keyword--scenario' },
    { names: [...dialect.given, ...dialect.when, ...dialect.then, ...dialect.and, ...dialect.but], className: 'gherkin-keyword--step' },
  ].flatMap(group => group.names.map(name => ({ name, className: group.className })))
    .sort((a, b) => b.name.length - a.name.length);
});
const highlighted = computed(() => props.modelValue.split('\n').map(line => {
  const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (/^\s*#/.test(line)) return `<span class="gherkin-comment">${escaped(line)}</span>`;
  if (/^\s*@/.test(line)) return `<span class="gherkin-tag">${escaped(line)}</span>`;
  if (/^\s*[|]/.test(line)) return `<span class="gherkin-table">${escaped(line)}</span>`;
  if (/^\s*"""/.test(line)) return `<span class="gherkin-docstring">${escaped(line)}</span>`;
  const keyword = keywordGroups.value.find(item => {
    const name = item.name.trimEnd();
    return new RegExp(`^\\s*${name.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')}(?=\\s|:|$)`).test(line);
  });
  if (!keyword) return escaped(line);
  const start = line.indexOf(keyword.name);
  return `${escaped(line.slice(0, start))}<span class="${keyword.className}">${escaped(keyword.name)}</span>${escaped(line.slice(start + keyword.name.length))}`;
}).join('\n'));
function resizeToContent() {
  const container = editorContainer.value;
  const input = editorInput.value;
  if (!container || !input) return;

  input.style.height = '0px';
  const style = getComputedStyle(container);
  const minimumHeight = Number.parseFloat(style.minHeight) || 0;
  const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  const nextHeight = `${Math.max(minimumHeight, input.scrollHeight + borderHeight)}px`;
  if (container.style.height !== nextHeight) container.style.height = nextHeight;
  input.style.height = '100%';
}

watch(() => props.modelValue, resizeToContent, { flush: 'post' });
onMounted(() => {
  resizeToContent();
  window.addEventListener('resize', resizeToContent);
});
onBeforeUnmount(() => window.removeEventListener('resize', resizeToContent));
</script>

<template>
  <div ref="editorContainer" class="gherkin-editor">
    <pre class="gherkin-highlight" aria-hidden="true" v-html="highlighted"></pre>
    <textarea ref="editorInput" :data-testid="testId" class="code-editor gherkin-input" :value="modelValue" :readonly="readonly" spellcheck="false" :aria-label="label" :placeholder="placeholder" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"></textarea>
  </div>
</template>

<style scoped>
.gherkin-editor {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: clamp(16rem, 68vh, 52rem);
  min-height: clamp(16rem, 68dvh, 52rem);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fcfdfb;
}

.gherkin-highlight,
.gherkin-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 1rem;
  border: 0;
  border-radius: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 1.125rem;
  font-kerning: none;
  font-variant-ligatures: none;
  font-weight: 400;
  line-height: 1.65;
  letter-spacing: normal;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.gherkin-highlight {
  overflow: hidden;
  color: var(--dark);
  background: transparent;
  pointer-events: none;
}

.gherkin-input {
  z-index: 1;
  overflow: hidden;
  resize: none;
  color: transparent;
  background: transparent;
  caret-color: var(--green);
  -webkit-text-fill-color: transparent;
}

.gherkin-input:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}

.gherkin-input::selection {
  background: var(--accent);
  color: var(--dark);
  -webkit-text-fill-color: var(--dark);
}

.gherkin-input::placeholder {
  color: #6a796d;
  opacity: 1;
  -webkit-text-fill-color: #6a796d;
}

:deep(.gherkin-keyword--structure) {
  color: #7a4e9b;
  font-weight: 700;
}

:deep(.gherkin-keyword--scenario) {
  color: #276f8d;
  font-weight: 650;
}

:deep(.gherkin-keyword--step) {
  color: #327b4b;
  font-weight: 650;
}

:deep(.gherkin-tag) {
  color: #875316;
}

:deep(.gherkin-comment) {
  color: #627366;
  font-style: italic;
}

:deep(.gherkin-table) {
  color: #4d735f;
}

:deep(.gherkin-docstring) {
  color: #a05e55;
}
</style>
