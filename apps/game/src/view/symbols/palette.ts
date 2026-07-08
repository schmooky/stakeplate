// Lucky Magnet visual language — flat, sharp, SVG-like. No textures, no
// gradients-as-art: just primitives, a tiny palette, and motion.

export const PALETTE = {
  bg: 0x1d1d1d, // Stake flat field
  cellWell: 0x141414, // recessed cell background
  cellEdge: 0x2b2b2b, // thin cell separator
  rail: 0x000000, // outer frame shadow
  railHi: 0x3a3a3a, // inner frame highlight
  // Blue pyramidal gem (the blank cell) — four facets, lit from the top.
  gemTop: 0x66c2f0, // top-right facet, lightest (catches the light)
  gemLeft: 0x3f93cc,
  gemRight: 0x2b6fa6,
  gemBottom: 0x1c4a72, // shadow facet, darkest
  gemEdge: 0x8fd6f5, // crisp outline / ridge
  digit: 0xeaf2ff,
  digitWin: 0xffd23b,
  magnetBody: 0xe2202d, // deep magnet red
  magnetHi: 0xff7a82, // glossy top sheen
  magnetPole: 0xced4df, // silver pole pieces
  magnetSteel: 0x7c8595, // steel seam
  field: 0x46e6ff,
  glow: 0x46e6ff,
  gold: 0xffd23b,
} as const;

export const DIGIT_FONT = '"Roboto Condensed", "Arial Narrow", "Arial Black", system-ui, sans-serif';
