/**
 * Per-page title surfaced in the global AppHeader.
 *
 * `AppHeader` lives in `/app/+layout.svelte`, so individual pages can't
 * pass props to it directly. Instead, pages set `pageTitle` on mount
 * (and clear it on destroy) and the header subscribes — yields one
 * top bar for the whole app whose label tracks whatever route is open.
 *
 * `pageTitleHref` is an optional companion: when set, the AppHeader
 * renders the title as a link instead of plain text. Used by the DM
 * chat to make the partner's name click into their profile.
 *
 * Set both to `null` when you don't want a title — the header falls
 * back to the wordmark.
 */
import { writable } from 'svelte/store';

export const pageTitle = writable(null);
export const pageTitleHref = writable(null);
