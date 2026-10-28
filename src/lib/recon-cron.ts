const FIELD_BOUNDS = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

function normalizeDow(value: number): number {
  return value === 7 ? 0 : value;
}

function expandPart(part: string, min: number, max: number, isDow: boolean): number[] | null {
  const [base, stepRaw] = part.split("/");
  if (!base || (stepRaw !== undefined && !/^\d+$/.test(stepRaw))) return null;
  const step = stepRaw === undefined ? 1 : Number(stepRaw);
  if (step < 1 || step > max - min + 1) return null;

  let start: number;
  let end: number;
  if (base === "*") {
    start = min;
    end = max;
  } else if (/^\d+-\d+$/.test(base)) {
    [start, end] = base.split("-").map(Number);
  } else if (/^\d+$/.test(base)) {
    start = Number(base);
    end = stepRaw === undefined ? start : max;
  } else {
    return null;
  }
  if (start < min || end > max || start > end) return null;

  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(isDow ? normalizeDow(value) : value);
  }
  return values;
}

function parseField(field: string, index: number): Set<number> | null {
  const [min, max] = FIELD_BOUNDS[index];
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const expanded = expandPart(part, min, max, index === 4);
    if (!expanded) return null;
    expanded.forEach((value) => values.add(value));
  }
  return values.size ? values : null;
}

export function isValidReconCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field, index) => parseField(field, index));
}

export function reconCronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const parsed = fields.map((field, index) => parseField(field, index));
  if (parsed.some((field) => field === null)) return false;

  const minute = parsed[0]!.has(date.getUTCMinutes());
  const hour = parsed[1]!.has(date.getUTCHours());
  const month = parsed[3]!.has(date.getUTCMonth() + 1);
  const dayOfMonth = parsed[2]!.has(date.getUTCDate());
  const dayOfWeek = parsed[4]!.has(date.getUTCDay());
  const domRestricted = fields[2] !== "*";
  const dowRestricted = fields[4] !== "*";
  const dayMatches = domRestricted && dowRestricted ? dayOfMonth || dayOfWeek : dayOfMonth && dayOfWeek;
  return minute && hour && month && dayMatches;
}

export function dueReconCronMinutes(
  expression: string,
  afterExclusive: Date,
  throughInclusive: Date,
  limit = 20,
): Date[] {
  if (!isValidReconCron(expression) || limit < 1) return [];
  const cursor = new Date(afterExclusive);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const end = new Date(throughInclusive);
  end.setUTCSeconds(0, 0);
  const due: Date[] = [];
  while (cursor <= end && due.length < limit) {
    if (reconCronMatches(expression, cursor)) due.push(new Date(cursor));
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return due;
}
