// CSV CELLS THAT A SPREADSHEET CANNOT RUN.
//
// Entity names, agency names and award identifiers are text the source sent, and a spreadsheet
// that opens a CSV reads a cell starting with = + - or @ as a formula. So does a cell starting
// with a tab or a carriage return, and so does one that starts with spaces and then any of those,
// because several spreadsheets trim before they parse. This tool's own money text starts with a
// minus sign whenever a figure is negative, and deobligations make negative figures ordinary.
//
// THE RULE. Every text cell whose first character, or first character after leading whitespace,
// is one of = + - @ TAB CR gets a single quote in front of it, which every spreadsheet reads as
// "this is text". Every cell is quoted, and a double quote inside a cell is doubled.
//
// THE ONE EXCEPTION, AND WHY IT IS SAFE. A value column holds a finite JavaScript number that
// this tool serialised itself, never text from the source. Its only possible leading character
// outside a digit is a minus sign, and the whole cell matches a plain decimal number, which no
// spreadsheet can read as a formula that does anything. Quoting it as text would turn every
// deobligation into a string and break the one use a value column has, so it is written as the
// number it is. A string that merely looks numeric still gets the quote: the exception is by
// TYPE, not by appearance.
//
// A newline inside a cell becomes a space. Quoted newlines are legal CSV, but a cell that starts
// a new line on screen can pass for a row this tool never wrote.
//
// THE CELL IS SANITISED BEFORE IT IS JUDGED. The output sink strips control and invisible
// format characters from every line it writes. A cell judged before that step could start with
// a zero width space or a NUL, pass as harmless, and then begin with = once the sink removed the
// character in front. So the cell is made inert first, with the sink's own function, and the
// rule runs on exactly the characters a spreadsheet will receive.

import { sanitize } from './out.js';

/** The characters a spreadsheet reads as the start of a formula, after any leading whitespace. */
const FORMULA_LEAD = /^\s*[=+\-@\t\r]/;

/** A number exactly as this tool serialises one: optional minus, digits, optional fraction. */
const PLAIN_NUMBER = /^-?[0-9]+(?:\.[0-9]+)?$/;

/**
 * One CSV cell.
 * @param {unknown} value A string, a finite number, or null for an empty cell.
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('csvCell: a number cell must be finite. A value this tool could not '
        + 'obtain is an empty cell with a reason beside it, never a written out non number.');
    }
    const text = String(value);
    if (PLAIN_NUMBER.test(text)) return '"' + text + '"';
    return csvCell(text);
  }
  const raw = String(value);
  // A tab or a carriage return in first place is a formula lead in its own right, so it is judged
  // on the text as given, before the line break rule below turns a carriage return into a space.
  const leadsWithBreak = /^\s*[\t\r]/.test(raw);
  let s = sanitize(raw.replace(/\r\n|\r|\n/g, ' '));
  if (leadsWithBreak || FORMULA_LEAD.test(s)) s = String.fromCharCode(39) + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * One CSV row.
 * @param {unknown[]} cells
 * @returns {string}
 */
export function csvRow(cells) {
  return cells.map((c) => csvCell(c)).join(',');
}
