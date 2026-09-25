/* Event types: icon (Lucide, ISC licence), colour and name keywords.
   Used by the map (js/app.js) and the dashboard (js/admin.js). */
window.EVENT_TYPES = [
  { id: "update", label: "Update", color: "#64748b",
    keywords: /news|report|update|statement/i,
    svg: "<path d=\"M15 18h-5\" /> <path d=\"M18 14h-8\" /> <path d=\"M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2\" /> <rect width=\"8\" height=\"4\" x=\"10\" y=\"6\" rx=\"1\" />" },
  { id: "clash", label: "Clash", color: "#e5484d",
    keywords: /clash|fight|battle|attack|ambush|ውጊያ|ግጭት/i,
    svg: "<path d=\"m13 19 6-6\" /> <path d=\"M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5\" /> <path d=\"m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586\" /> <path d=\"m16 16 4 4\" /> <path d=\"m19 21 2-2\" /> <path d=\"m5 14 4 4\" /> <path d=\"m5 21-2-2\" /> <path d=\"M7.5 16.5 4 20\" />" },
  { id: "airstrike", label: "Airstrike", color: "#f97316",
    keywords: /air ?strike|airstrike|bomb(ing|ed) from|jet|የአየር/i,
    svg: "<path d=\"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z\" />" },
  { id: "drone", label: "Drone strike", color: "#eab308",
    keywords: /drone|uav|ድሮን/i,
    svg: "<path d=\"M10 10 7 7\" /> <path d=\"m10 14-3 3\" /> <path d=\"m14 10 3-3\" /> <path d=\"m14 14 3 3\" /> <path d=\"M14.205 4.139a4 4 0 1 1 5.439 5.863\" /> <path d=\"M19.637 14a4 4 0 1 1-5.432 5.868\" /> <path d=\"M4.367 10a4 4 0 1 1 5.438-5.862\" /> <path d=\"M9.795 19.862a4 4 0 1 1-5.429-5.873\" /> <rect x=\"10\" y=\"8\" width=\"4\" height=\"8\" rx=\"1\" />" },
  { id: "shelling", label: "Shelling", color: "#b45309",
    keywords: /shell|artillery|mortar|rocket|explosion|blast/i,
    svg: "<circle cx=\"11\" cy=\"13\" r=\"9\" /> <path d=\"M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95\" /> <path d=\"m22 2-1.5 1.5\" />" },
  { id: "captured", label: "Captured / control change", color: "#8b5cf6",
    keywords: /captur|taken|took control|seiz|control of|liberat|ተቆጣጠረ|ያዘ/i,
    svg: "<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\" />" },
  { id: "displacement", label: "Displacement", color: "#3b82f6",
    keywords: /displac|refugee|idp|fled|camp/i,
    svg: "<path d=\"M3.5 21 14 3\" /> <path d=\"M20.5 21 10 3\" /> <path d=\"M15.5 21 12 15l-3.5 6\" /> <path d=\"M2 21h20\" />" },
  { id: "protest", label: "Protest", color: "#ec4899",
    keywords: /protest|demonstrat|rally|ሰልፍ/i,
    svg: "<path d=\"M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z\" /> <path d=\"M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14\" /> <path d=\"M8 6v8\" />" },
  { id: "other", label: "Other", color: "#6b7280",
    keywords: null,
    svg: "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /> <path d=\"M12 9v4\" /> <path d=\"M12 17h.01\" />" }
];

window.eventType = function (id) {
  const key = String(id || '').toLowerCase();
  return window.EVENT_TYPES.find((t) => t.id === key || t.label.toLowerCase() === key) || null;
};

// Guess a type from a My Maps point: a "Type"/"Category" column first, then words in its name.
window.guessEventType = function (props) {
  const p = props || {};
  const column = p.Type || p.type || p.Category || p.category || p.Event || p.event;
  const byColumn = column && window.eventType(column);
  if (byColumn) return byColumn;
  if (column) {
    const hit = window.EVENT_TYPES.find((t) => t.keywords && t.keywords.test(column));
    if (hit) return hit;
  }
  const text = String(p.name || '');
  return window.EVENT_TYPES.find((t) => t.keywords && t.id !== 'update' && t.keywords.test(text)) || null;
};

window.eventIconHtml = function (type, size) {
  const t = type || window.eventType('other');
  const s = size || 30;
  return '<span class="event-pin" style="--c:' + t.color + ';width:' + s + 'px;height:' + s + 'px">' +
    '<svg viewBox="0 0 24 24" width="' + Math.round(s * 0.56) + '" height="' + Math.round(s * 0.56) + '" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + t.svg + '</svg></span>';
};
