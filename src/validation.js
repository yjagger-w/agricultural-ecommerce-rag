'use strict';
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid identifier');
  return value;
}
function text(value, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008]/.test(value)) throw new Error('Invalid text');
  // Reject rather than silently publish credentials or local file paths. This is
  // a narrow technical guard, not a complete business-data anonymization tool.
  if (/(?:[a-z]:[\\/]|\\\\|sk-[a-z0-9_-]{12,}|(?:api[_ -]?key|authorization|access[_ -]?token)\s*[:=])/i.test(value)) throw new Error('Sensitive-looking text rejected');
  return value.trim();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return value;
}
function source(value) {
  if (!value || typeof value !== 'object') throw new Error('Source required');
  return { id: id(value.id), title: text(value.title, 200) };
}
module.exports = { id, text, date, source };
