// Copyright (c) 2024-2026 EVtivity. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Full screen for the 3D layout stage. The Fullscreen API on the stage where
// the browser has it for elements; elsewhere (iPhone Safari, which only puts
// videos in full screen) an in-page overlay that fills the viewport. Escape
// leaves either: the browser handles it in native full screen, the overlay
// listens for it itself (`canEscape` lets an open popup take Escape first).

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type StageFullScreenMode = 'off' | 'native' | 'overlay';

/** Whether the browser can put an element (not only a video) in full screen. */
export function elementFullScreenSupported(el: HTMLElement | null): boolean {
  return (
    el != null &&
    typeof el.requestFullscreen === 'function' &&
    typeof document !== 'undefined' &&
    document.fullscreenEnabled
  );
}

export function useStageFullScreen(
  ref: RefObject<HTMLElement | null>,
  canEscape: () => boolean = () => true,
): { mode: StageFullScreenMode; enter: () => void; exit: () => void } {
  const [mode, setMode] = useState<StageFullScreenMode>('off');
  const canEscapeRef = useRef(canEscape);
  useEffect(() => {
    canEscapeRef.current = canEscape;
  });

  // Native full screen ends with Escape or the browser's own control too.
  useEffect(() => {
    if (mode !== 'native') return;
    const onChange = (): void => {
      if (document.fullscreenElement !== ref.current) setMode('off');
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [mode, ref]);

  // The overlay: Escape leaves it, and the page behind does not scroll.
  useEffect(() => {
    if (mode !== 'overlay') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented && canEscapeRef.current()) setMode('off');
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [mode]);

  // Leaving the page in full screen ends it.
  useEffect(
    () => () => {
      if (document.fullscreenElement != null && document.fullscreenElement === ref.current) {
        document.exitFullscreen().catch((err: unknown) => {
          console.warn('Could not leave full screen', err);
        });
      }
    },
    [ref],
  );

  const enter = useCallback(() => {
    const el = ref.current;
    if (el == null) return;
    if (!elementFullScreenSupported(el)) {
      setMode('overlay');
      return;
    }
    el.requestFullscreen().then(
      () => {
        setMode('native');
      },
      (err: unknown) => {
        // A refused request (no user gesture, a policy) falls back to the overlay.
        console.warn('Full screen was refused, filling the window instead', err);
        setMode('overlay');
      },
    );
  }, [ref]);

  const exit = useCallback(() => {
    if (document.fullscreenElement != null && document.fullscreenElement === ref.current) {
      document.exitFullscreen().catch((err: unknown) => {
        console.warn('Could not leave full screen', err);
      });
    }
    setMode('off');
  }, [ref]);

  return { mode, enter, exit };
}
