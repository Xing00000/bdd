<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ modelValue: string; readonly?: boolean; label: string; placeholder?: string; testId?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const container = ref<HTMLDivElement | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);

function resizeToContent() {
  const editor = container.value;
  const textarea = input.value;
  if (!editor || !textarea) return;

  textarea.style.height = '0px';
  const style = getComputedStyle(editor);
  const minimumHeight = Number.parseFloat(style.minHeight) || 0;
  const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  const nextHeight = `${Math.max(minimumHeight, textarea.scrollHeight + borderHeight)}px`;
  if (editor.style.height !== nextHeight) editor.style.height = nextHeight;
  textarea.style.height = '100%';
}

watch(() => props.modelValue, resizeToContent, { flush: 'post' });
onMounted(() => {
  resizeToContent();
  window.addEventListener('resize', resizeToContent);
});
onBeforeUnmount(() => window.removeEventListener('resize', resizeToContent));
</script>

<template>
  <div ref="container" class="document-editor">
    <textarea
      ref="input"
      :data-testid="testId"
      class="code-editor document-editor-input"
      :value="modelValue"
      :readonly="readonly"
      spellcheck="false"
      :aria-label="label"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
  </div>
</template>

<style scoped>
.document-editor {
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

.document-editor-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 1rem;
  border: 0;
  border-radius: 0;
  color: var(--dark);
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 1.125rem;
  font-weight: 400;
  line-height: 1.65;
  letter-spacing: normal;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: hidden;
  resize: none;
  -webkit-text-fill-color: var(--dark);
}

.document-editor-input:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}

.document-editor-input::placeholder {
  color: #6a796d;
  opacity: 1;
  -webkit-text-fill-color: #6a796d;
}
</style>
