// Follows the system light/dark setting as reactive state.
import { canvasColors } from '@nook/tokens';

const query = window.matchMedia('(prefers-color-scheme: dark)');

export const theme = $state({ dark: query.matches });
query.addEventListener('change', e => { theme.dark = e.matches; });

/** Colours for the canvas in the current mode. */
export const canvasTheme = () => (theme.dark ? canvasColors.dark : canvasColors.light);
