<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import MarkdownIt from 'markdown-it';

const props = defineProps<{ source: string }>();
const preview = ref<HTMLElement | null>(null);
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const renderedMarkdown = computed(() => markdown.render(props.source));

let mermaidApi: typeof import('mermaid').default | undefined;
let mermaidPromise: Promise<typeof import('mermaid')> | undefined;
let renderGeneration = 0;
let diagramSequence = 0;

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => {
      module.default.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
      mermaidApi = module.default;
      return module;
    });
  }
  await mermaidPromise;
  return mermaidApi;
}

function showDiagramError(container: HTMLElement, source: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const notice = document.createElement('p');
  notice.className = 'mermaid-error-message';
  notice.textContent = `Mermaid 無法渲染：${message}`;
  const sourceBlock = document.createElement('pre');
  sourceBlock.className = 'mermaid-error-source';
  sourceBlock.textContent = source;
  container.replaceChildren(notice, sourceBlock);
  container.classList.add('has-error');
}

async function renderDiagrams() {
  const generation = ++renderGeneration;
  await nextTick();
  const root = preview.value;
  if (!root || !props.source.trim()) return;

  const codeBlocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  if (!codeBlocks.length) return;

  try {
    const mermaid = await loadMermaid();
    if (!mermaid || generation !== renderGeneration || !preview.value) return;

    for (const code of codeBlocks) {
      if (generation !== renderGeneration) return;
      const container = code.parentElement;
      if (!container) continue;
      const source = code.textContent ?? '';
      try {
        const { svg } = await mermaid.render(`sd-mermaid-${++diagramSequence}`, source);
        if (generation !== renderGeneration || !container.isConnected) return;
        const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
        if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
          throw new Error('Mermaid 回傳了無效的 SVG。');
        }
        const figure = document.createElement('div');
        figure.className = 'mermaid-diagram';
        figure.setAttribute('role', 'img');
        figure.setAttribute('aria-label', 'Mermaid 圖表');
        figure.append(document.importNode(parsed.documentElement, true));
        container.replaceWith(figure);
      } catch (error) {
        if (generation !== renderGeneration || !container.isConnected) return;
        showDiagramError(container, source, error);
      }
    }
  } catch (error) {
    if (generation !== renderGeneration) return;
    const message = error instanceof Error ? error.message : String(error);
    for (const code of codeBlocks) {
      const container = code.parentElement;
      if (container?.isConnected) showDiagramError(container, code.textContent ?? '', error);
    }
    console.error('載入 Mermaid 失敗', message);
  }
}

watch(() => props.source, () => void renderDiagrams(), { flush: 'post', immediate: true });
onBeforeUnmount(() => { renderGeneration += 1; });
</script>

<template>
  <div class="markdown-preview" data-testid="sd-preview">
    <div v-if="!source.trim()" class="markdown-empty">尚無系統設計內容</div>
    <div v-else ref="preview" class="markdown-content" v-html="renderedMarkdown"></div>
  </div>
</template>

<style scoped>
.markdown-preview {
  flex: 1 1 auto;
  min-width: 0;
  min-height: clamp(16rem, 68vh, 52rem);
  min-height: clamp(16rem, 68dvh, 52rem);
  padding: clamp(1.25rem, 3vw, 3rem);
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: var(--dark);
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 1.6em 0 0.65em;
  color: #234b35;
  line-height: 1.3;
}

.markdown-content :deep(h1) { font-size: 1.8rem; }
.markdown-content :deep(h2) { font-size: 1.4rem; }
.markdown-content :deep(h3) { font-size: 1.15rem; }
.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(blockquote),
.markdown-content :deep(table),
.markdown-content :deep(pre) { margin: 0.85em 0; }

.markdown-content :deep(ul),
.markdown-content :deep(ol) { padding-left: 1.6em; }

.markdown-content :deep(blockquote) {
  padding: 0.2em 1em;
  border-left: 3px solid #9fc3a2;
  color: #536a59;
}

.markdown-content :deep(hr) {
  margin: 1.75em 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 0.6em 0.75em;
  border: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.markdown-content :deep(th) { background: #f4f8f3; }
.markdown-content :deep(code) { font-size: 0.92em; }

.markdown-content :deep(pre:not(.mermaid-error-source)) {
  padding: 1em;
  border-radius: 5px;
  background: #f4f7f3;
  overflow-x: auto;
}

.markdown-content :deep(.mermaid-diagram) {
  max-width: 100%;
  margin: 1.25em 0;
  overflow-x: auto;
  text-align: center;
}

.markdown-content :deep(.mermaid-diagram svg) {
  max-width: 100%;
  height: auto;
}

.markdown-content :deep(.mermaid-error-message) {
  margin: 0;
  padding: 0.75em 1em;
  border: 1px solid #ecc4bc;
  border-bottom: 0;
  border-radius: 5px 5px 0 0;
  color: #8f3328;
  background: #fff4f1;
  font-size: 0.9rem;
  text-align: left;
}

.markdown-content :deep(.mermaid-error-source) {
  margin: 0;
  padding: 0.85em 1em;
  border: 1px solid #ecc4bc;
  border-radius: 0 0 5px 5px;
  background: #fffafa;
  text-align: left;
}

.markdown-empty { color: #718176; }
</style>
