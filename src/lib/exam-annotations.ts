export const ANNOTATION_SURFACES = ['stem', 'options', 'explanation'] as const;
export type AnnotationSurface = (typeof ANNOTATION_SURFACES)[number];

export const ANNOTATION_TOOLS = ['pencil', 'highlighter', 'eraser'] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

export const ANNOTATION_COLORS = ['yellow', 'red', 'blue', 'green', 'purple'] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export const DEFAULT_ANNOTATION_COLOR: AnnotationColor = 'yellow';
export const ANNOTATION_COLOR_STORAGE_KEY = 'royal.exam.annotationColor';

export type AnnotationPoint = readonly [number, number];

export interface AnnotationStroke {
  id: string;
  tool: 'pencil' | 'highlighter';
  width: number;
  points: AnnotationPoint[];
  // Optional for backward compatibility with marks saved before color support.
  // Legacy strokes render as DEFAULT_ANNOTATION_COLOR.
  color?: AnnotationColor;
}

export interface StoredQuestionAnnotation {
  surface: AnnotationSurface;
  contentHash: string;
  strokes: AnnotationStroke[];
  version: number;
  updatedAt: string;
}

export const MAX_ANNOTATION_STROKES = 500;
export const MAX_POINTS_PER_STROKE = 2000;
export const MAX_TOTAL_ANNOTATION_POINTS = 25000;
export const MAX_ANNOTATION_PAYLOAD_BYTES = 262144;

export function isAnnotationSurface(value: unknown): value is AnnotationSurface {
  return typeof value === 'string' && (ANNOTATION_SURFACES as readonly string[]).includes(value);
}

export function isAnnotationTool(value: unknown): value is AnnotationTool {
  return typeof value === 'string' && (ANNOTATION_TOOLS as readonly string[]).includes(value);
}

export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return typeof value === 'string' && (ANNOTATION_COLORS as readonly string[]).includes(value);
}

function isFiniteUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isValidAnnotationStroke(value: unknown): value is AnnotationStroke {
  if (!value || typeof value !== 'object') return false;
  const stroke = value as Partial<AnnotationStroke>;
  if (typeof stroke.id !== 'string' || stroke.id.length < 1 || stroke.id.length > 80) return false;
  if (stroke.tool !== 'pencil' && stroke.tool !== 'highlighter') return false;
  if (stroke.color !== undefined && !isAnnotationColor(stroke.color)) return false;
  if (typeof stroke.width !== 'number' || !Number.isFinite(stroke.width) || stroke.width < 0.5 || stroke.width > 48) {
    return false;
  }
  if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > MAX_POINTS_PER_STROKE) {
    return false;
  }

  return stroke.points.every((point) => (
    Array.isArray(point)
    && point.length === 2
    && isFiniteUnitNumber(point[0])
    && isFiniteUnitNumber(point[1])
  ));
}

export function isValidAnnotationStrokes(value: unknown): value is AnnotationStroke[] {
  if (!Array.isArray(value) || value.length > MAX_ANNOTATION_STROKES) return false;

  let totalPoints = 0;
  for (const stroke of value) {
    if (!isValidAnnotationStroke(stroke)) return false;
    totalPoints += stroke.points.length;
    if (totalPoints > MAX_TOTAL_ANNOTATION_POINTS) return false;
  }

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_ANNOTATION_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

export function createAnnotationStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function perpendicularDistance(point: AnnotationPoint, start: AnnotationPoint, end: AnnotationPoint): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  const t = Math.max(0, Math.min(1, (
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy)
    / (dx * dx + dy * dy)
  )));
  const projectionX = start[0] + t * dx;
  const projectionY = start[1] + t * dy;
  return Math.hypot(point[0] - projectionX, point[1] - projectionY);
}

export function simplifyAnnotationPoints(
  points: AnnotationPoint[],
  tolerance = 0.0015,
): AnnotationPoint[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= tolerance) return [start, end];

  const left = simplifyAnnotationPoints(points.slice(0, index + 1), tolerance);
  const right = simplifyAnnotationPoints(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function distanceToStroke(point: AnnotationPoint, stroke: AnnotationStroke): number {
  if (stroke.points.length === 0) return Number.POSITIVE_INFINITY;
  if (stroke.points.length === 1) {
    return Math.hypot(point[0] - stroke.points[0][0], point[1] - stroke.points[0][1]);
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < stroke.points.length; index += 1) {
    minimum = Math.min(
      minimum,
      perpendicularDistance(point, stroke.points[index - 1], stroke.points[index]),
    );
  }
  return minimum;
}
