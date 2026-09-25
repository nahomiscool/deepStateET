/* Event marker types used by the dashboard (admin.html) and the map. */
window.EVENT_TYPES = [
  { id: 'Clash', color: '#e5484d' },
  { id: 'Airstrike', color: '#ff8a00' },
  { id: 'Drone strike', color: '#f5c400' },
  { id: 'Shelling', color: '#b5651d' },
  { id: 'Displacement', color: '#3b82f6' },
  { id: 'Protest', color: '#a855f7' },
  { id: 'Other', color: '#9aa3b2' }
];

window.eventColor = function (type) {
  const found = window.EVENT_TYPES.find((t) => t.id === type);
  return found ? found.color : '#9aa3b2';
};
