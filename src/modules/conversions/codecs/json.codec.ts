import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parser } from 'stream-json';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import {
  batched,
  FormatCodec,
  Intermediate,
  ParseOptions,
} from './format-codec';

interface Token {
  name: string;
  value?: string;
}

type Container = Record<string, unknown> | unknown[];

/**
 * Builds a value from stream-json tokens. Unlike stream-json's own Assembler it
 * defines keys as own properties (a `__proto__` key cannot replace the object
 * prototype — same as JSON.parse) and aborts once `maxDepth` is exceeded,
 * before a deeply nested document is fully read.
 */
class JsonAssembler {
  private readonly stack: Array<{ container: Container; key: string | null }> =
    [];
  private container: Container | null = null;
  private key: string | null = null;
  private hasValue = false;
  value: unknown = undefined;

  constructor(private readonly maxDepth: number) {}

  get done(): boolean {
    return this.hasValue && this.container === null;
  }

  consume(token: Token): void {
    switch (token.name) {
      case 'startObject':
        return this.open({});
      case 'startArray':
        return this.open([]);
      case 'endObject':
      case 'endArray':
        return this.close();
      case 'keyValue':
        this.key = token.value!;
        return;
      case 'stringValue':
        return this.save(token.value!);
      case 'numberValue':
        return this.save(Number(token.value));
      case 'nullValue':
        return this.save(null);
      case 'trueValue':
        return this.save(true);
      case 'falseValue':
        return this.save(false);
      default:
        // streamed string/number chunks — the packed values above suffice
        return;
    }
  }

  private open(container: Container): void {
    if (this.stack.length + (this.container ? 1 : 0) >= this.maxDepth) {
      throw new CodecError(
        ConversionErrorCode.DEPTH_EXCEEDED,
        `Nesting depth exceeds the limit of ${this.maxDepth}`,
      );
    }
    if (this.container) {
      this.stack.push({ container: this.container, key: this.key });
    }
    this.container = container;
    this.key = null;
  }

  private close(): void {
    const finished = this.container;
    const parent = this.stack.pop();
    this.container = parent?.container ?? null;
    this.key = parent?.key ?? null;
    this.save(finished);
  }

  private save(value: unknown): void {
    const target = this.container;
    if (target === null) {
      this.value = value;
      this.hasValue = true;
    } else if (Array.isArray(target)) {
      target.push(value);
    } else {
      Object.defineProperty(target, this.key!, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      this.key = null;
    }
  }
}

/**
 * JSON codec (RFC 8259). Parsing is a true streaming tokenizer (stream-json),
 * so memory is bounded by the resulting structure, not by the raw text.
 * Output is generated incrementally and is byte-identical to
 * `JSON.stringify(data, null, 2) + '\n'`.
 */
export class JsonCodec extends FormatCodec {
  readonly format = TextFormat.JSON;

  async parse(
    input: AsyncIterable<string>,
    { maxDepth }: ParseOptions,
  ): Promise<Intermediate> {
    const assembler = new JsonAssembler(maxDepth);
    try {
      await pipeline(
        input,
        parser({ packValues: true, streamValues: false }),
        async (tokens: AsyncIterable<Token>) => {
          for await (const token of tokens) {
            assembler.consume(token);
          }
        },
      );
    } catch (err) {
      if (err instanceof CodecError) {
        throw err;
      }
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid JSON: ${(err as Error).message}`,
      );
    }
    if (!assembler.done) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        'Invalid JSON: unexpected end of input',
      );
    }
    return assembler.value;
  }

  serialize(data: Intermediate): Readable {
    function* chunks(): Generator<string> {
      const top = toJsonValue(data);
      yield* stringify(top === undefined ? null : top, '');
      yield '\n';
    }
    return batched(chunks());
  }
}

/** Applies JSON.stringify's value conversions (toJSON, non-finite numbers). */
function toJsonValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === 'function') {
      return withToJson.toJSON();
    }
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return undefined;
  }
  return value;
}

/** Pretty-printed (2-space) JSON, one fragment at a time. */
function* stringify(value: unknown, indent: string): Generator<string> {
  if (value === null || typeof value !== 'object') {
    yield JSON.stringify(value);
    return;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      yield '[]';
      return;
    }
    yield '[\n';
    for (let i = 0; i < value.length; i++) {
      const item = toJsonValue(value[i]);
      yield inner;
      yield* stringify(item === undefined ? null : item, inner);
      yield i < value.length - 1 ? ',\n' : '\n';
    }
    yield `${indent}]`;
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, v]) => [key, toJsonValue(v)] as const)
    .filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    yield '{}';
    return;
  }
  yield '{\n';
  for (let i = 0; i < entries.length; i++) {
    const [key, v] = entries[i];
    yield `${inner}${JSON.stringify(key)}: `;
    yield* stringify(v, inner);
    yield i < entries.length - 1 ? ',\n' : '\n';
  }
  yield `${indent}}`;
}
