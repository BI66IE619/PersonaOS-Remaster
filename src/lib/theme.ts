/**
 * The solid surfaces, for anything that has to sit above the frosted page.
 *
 * `.panel` and `.tile` are translucent and sit on the particle field. A dialog
 * cannot use them: the field keeps drifting behind it, so a frosted card in
 * front of a frosted page reads as two depths of the same surface and the dialog
 * stops reading as a dialog. SportForm and the habit confirmation both work
 * around this the same way, and this is where that workaround finally had a
 * second caller and became a token.
 *
 * Opaque, same shape as a panel, so the dialog still belongs to the app.
 */
export const solid = {
  overlay: { background: "var(--color-base)" },
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-hairline-strong)",
    borderRadius: "var(--radius-panel)",
  },
} as const;
