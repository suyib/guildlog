// Every view has its own address, so it can be shared and Back and Forward work.

/** Go to an address in the app without reloading (a new history entry, or the current one replaced). */
export function go(url: string, replace = false) {
  const here = window.location.pathname + window.location.search + window.location.hash;
  if (url === here) return;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

/** A value from the part after "?" in the hash (#/raids?raid=abc). */
export const hashParam = (key: string) => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get(key);
