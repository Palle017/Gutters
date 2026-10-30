const DAY = 86400000;
export const metricNames = ['newRequests','requestsRepliedTo','estimatesDrafted','estimatesPublished','photosReceived'];
const zero = () => Object.fromEntries(metricNames.map(name => [name,0]));
// Fixed SQL only: no contact fields, message bodies, photo bytes or credentials are read.
const sources = {
  newRequests: ['conversations','created_at','COUNT(*)'],
  requestsRepliedTo: ['operations', 'created_at', 'COUNT(DISTINCT conversation_id)', " AND actor='owner'"],
  estimatesDrafted: ['estimates','created_at','COUNT(*)'],
  estimatesPublished: ['estimates','published_at','COUNT(*)'],
  photosReceived: ['photos','created_at','COUNT(*)']
};

export function readOwnerMetrics(db, timestamp) {
  const asOf = new Date(timestamp).toISOString();
  const today = Date.parse(asOf.slice(0,10)+'T00:00:00.000Z');
  // A deferred read transaction gives both windows a single SQLite snapshot.
  db.exec('BEGIN');
  try {
    const windows = {};
    for (const days of [7,30]) {
      const start = today-(days-1)*DAY;
      const startInclusive = new Date(start).toISOString();
      const perDay = Array.from({length:days},(_,index) => ({date:new Date(start+index*DAY).toISOString().slice(0,10),counts:zero()}));
      const byDate = new Map(perDay.map(row => [row.date,row.counts]));
      const totals = zero();
      for (const [name,[table,column,count,extra='']] of Object.entries(sources)) {
        const where = `${column}>=? AND ${column}<=?${extra}`;
        totals[name] = db.prepare(`SELECT ${count} AS n FROM ${table} WHERE ${where}`).get(startInclusive,asOf).n;
        for (const row of db.prepare(`SELECT substr(${column},1,10) AS day,${count} AS n FROM ${table} WHERE ${where} GROUP BY day`).all(startInclusive,asOf)) {
          byDate.get(row.day)[name] = row.n;
        }
      }
      windows['last'+days+'Days'] = {startInclusive,endInclusive:asOf,totals,perDay};
    }
    db.exec('COMMIT');
    return {ok:true,asOf,timeZone:'UTC',todayPartial:true,windows};
  } catch (error) {db.exec('ROLLBACK');throw error;}
}
