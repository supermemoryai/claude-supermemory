const enabled = !process.env.NO_COLOR;
const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

// Mid-luminance tint of the brand blue (#3B35F3): terminals can't report
// their theme, so the glyph must clear both dark and light backgrounds.
const blue = wrap('38;2;124;120;250');
const bold = wrap('1');
const gray = wrap('38;5;245');
const red = wrap('31');

const MARK = blue(bold('◪'));
const BRAND = `${MARK} ${bold('supermemory')}`;

module.exports = { BRAND, MARK, blue, bold, gray, red };
