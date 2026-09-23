import { ConversionErrorCode } from '../conversions.constants';
import { CodecError } from './codec-error';
import { Intermediate } from './format-codec';

/**
 * Rejects an intermediate representation whose nesting depth exceeds `maxDepth`.
 * Guards against resource-exhaustion attacks (deeply nested structures blowing
 * the stack or memory during serialization). Iterative to avoid recursing on
 * the very input it is trying to bound.
 */
export function assertWithinDepth(data: Intermediate, maxDepth: number): void {
  const stack: Array<{ node: unknown; depth: number }> = [
    { node: data, depth: 0 },
  ];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (node === null || typeof node !== 'object') {
      continue;
    }
    if (depth >= maxDepth) {
      throw new CodecError(
        ConversionErrorCode.DEPTH_EXCEEDED,
        `Nesting depth exceeds the limit of ${maxDepth}`,
      );
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      stack.push({ node: value, depth: depth + 1 });
    }
  }
}
