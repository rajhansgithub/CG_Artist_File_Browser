import { useEffect, useState } from 'react';

// Returns `value` once it has stopped changing for `delay` ms. The search box shows every keystroke straight away,
// but the folder is only re-read when the user pauses, so a big folder does not re-scan on each letter.
export function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
