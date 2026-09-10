const EVENT = "studio:before-navigate";

/** Explicit SPA navigation must consult editors before unmounting them. */
export function requestWorkspaceNavigation(target: EventTarget = window): boolean {
  return target.dispatchEvent(new Event(EVENT, { cancelable: true }));
}

export function registerWorkspaceNavigationGuard(canLeave: () => boolean, target: EventTarget = window) {
  const listener = (event: Event) => { if (!canLeave()) event.preventDefault(); };
  target.addEventListener(EVENT, listener);
  return () => target.removeEventListener(EVENT, listener);
}
