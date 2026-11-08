import type {Page} from '@playwright/test';

export function openMenu(page: Page, section?: 'workspace' | 'chat' | 'settings'): Promise<void>;
