import {expect} from '@playwright/test';

export async function openMenu(page,section='chat'){
  await expect(page.locator('#content')).toHaveAttribute('aria-busy','false');
  if(await page.getByTestId('assistant-drawer').isHidden())await page.getByTestId('assistant-drawer-open').click();
  const toggle=page.getByTestId('assistant-menu-toggle');
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  const category=page.locator(`[data-assistant-nav="${section}"]`);
  if(await category.getAttribute('aria-expanded')!=='true')await category.click();
}
