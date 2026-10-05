// The owner removed the duplicate "Any activity" filter control. Broad-inventory
// assertions still exercise the supported legacy view=all deep link. Wait for
// hydration, and clear workspace URL context before sending a history event.
export async function restoreAllActivityDeepLink(page) {
  await page.waitForFunction(() => {
    const trigger = document.querySelector('.rmtExploreTrigger');
    const props = trigger && Object.keys(trigger).find(key => key.startsWith('__reactProps$'));
    return props && typeof trigger[props]?.onClick === 'function'
      && document.querySelectorAll('.rmtPrimaryViews button').length === 4;
  });
  await page.evaluate(() => {
    const url = new URL(location.href);
    for (const key of ['market', 'side', 'panel']) url.searchParams.delete(key);
    url.searchParams.set('view', 'all');
    history.pushState({ rmtTerminalContext: 'markets' }, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => {
    const root = document.querySelector('.rmtMobileTerminal, .rmtDesktopTerminal');
    const buttons = [...document.querySelectorAll('.rmtPrimaryViews button')];
    return root?.getAttribute('data-terminal-context') === 'markets'
      && buttons.length === 4
      && buttons.every(button => button.getAttribute('aria-pressed') !== 'true');
  });
}
