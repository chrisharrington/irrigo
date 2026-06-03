import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';

// Extend the timezone-aware plugins once, here, as a side effect of importing
// this module. Every file that needs `.utc()`, `.tz()`, or iso-week helpers
// should `import dayjs from '@/util/dayjs'` rather than re-running these extend
// calls. The calls are idempotent and order-insensitive, so importing this
// module from many places is safe.
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

export type { Dayjs } from 'dayjs';
export default dayjs;
