type VisibilityCallback = (visible: boolean) => void;

const listeners = new Map<Element, VisibilityCallback>();
let sharedObserver: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return null;
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = listeners.get(entry.target);
          if (cb) {
            cb(entry.isIntersecting);
          }
        }
      },
      { rootMargin: '220px 0px', threshold: 0.01 }
    );
  }
  return sharedObserver;
}

export function observeElementVisibility(
  el: Element,
  callback: VisibilityCallback
): () => void {
  const observer = getObserver();
  if (!observer) {
    callback(true);
    return () => {};
  }
  listeners.set(el, callback);
  observer.observe(el);
  return () => {
    listeners.delete(el);
    observer.unobserve(el);
  };
}
