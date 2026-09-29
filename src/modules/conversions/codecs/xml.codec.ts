import { Readable } from 'node:stream';

import { SaxesParser, SaxesTagPlain } from 'saxes';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import {
  batched,
  FormatCodec,
  Intermediate,
  ParseOptions,
} from './format-codec';

const ATTR_PREFIX = '@_';
const TEXT_NODE = '#text';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const INDENT = '  ';

interface Frame {
  name: string;
  attributes: Record<string, string>;
  children: Record<string, unknown>;
  hasChildren: boolean;
  text: string;
}

/**
 * XML codec (XML 1.0). Parsing uses the streaming SAX parser saxes; output is
 * generated element by element.
 *
 * Security: a `<!DOCTYPE ...>` is rejected as soon as it is seen, which blocks
 * XML external entity (XXE) injection and entity-expansion ("billion laughs")
 * attacks. saxes never resolves external resources, and only the five
 * predefined entities and character references are decoded.
 *
 * Mapping rules (documented, implementation-defined):
 *  - XML→JSON: the root element becomes the single top-level key; attributes
 *    are surfaced as `@_`-prefixed keys (string values); text is trimmed and,
 *    when the element also has attributes or child elements, stored under
 *    `#text`; repeated elements become arrays; an empty element becomes "".
 *    Text that is exactly a JSON number or `true`/`false` is converted
 *    (so "007" or "1e" stay strings). Comments, processing instructions and
 *    the XML declaration are ignored; CDATA is treated as text.
 *  - JSON→XML: a single-key object is emitted with that key as the root
 *    element; an array or multi-key/primitive value is wrapped in a `<root>`
 *    element (arrays nested under `<item>` entries). Keys that are not valid
 *    XML names have invalid characters replaced with `_`.
 */
export class XmlCodec extends FormatCodec {
  readonly format = TextFormat.XML;

  async parse(
    input: AsyncIterable<string>,
    { maxDepth }: ParseOptions,
  ): Promise<Intermediate> {
    const sax = new SaxesParser();
    const stack: Frame[] = [];
    let result: Record<string, unknown> | undefined;

    sax.on('error', (err) => {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid XML: ${err.message}`,
      );
    });
    sax.on('doctype', () => {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        'XML DOCTYPE declarations are not allowed',
      );
    });
    sax.on('opentag', (tag: SaxesTagPlain) => {
      // The IR nests one level deeper than the element tree ({root: ...}).
      if (stack.length + 1 >= maxDepth) {
        throw new CodecError(
          ConversionErrorCode.DEPTH_EXCEEDED,
          `Nesting depth exceeds the limit of ${maxDepth}`,
        );
      }
      if (stack.length > 0) {
        stack[stack.length - 1].hasChildren = true;
      }
      stack.push({
        name: tag.name,
        attributes: tag.attributes,
        children: {},
        hasChildren: false,
        text: '',
      });
    });
    const onText = (text: string) => {
      if (stack.length > 0) {
        stack[stack.length - 1].text += text;
      }
    };
    sax.on('text', onText);
    sax.on('cdata', onText);
    sax.on('closetag', () => {
      const frame = stack.pop()!;
      const value = frameValue(frame);
      if (stack.length === 0) {
        result = { [frame.name]: value };
      } else {
        addChild(stack[stack.length - 1].children, frame.name, value);
      }
    });

    try {
      for await (const chunk of input) {
        sax.write(chunk);
      }
      sax.close();
    } catch (err) {
      if (err instanceof CodecError) {
        throw err;
      }
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid XML: ${(err as Error).message}`,
      );
    }
    return result ?? null;
  }

  serialize(data: Intermediate): Readable {
    const [rootName, rootValue] = wrapRoot(data);
    function* chunks(): Generator<string> {
      yield XML_DECLARATION;
      yield* element(rootName, rootValue, '');
    }
    return batched(chunks());
  }
}

// ---- XML → IR ----

function frameValue(frame: Frame): unknown {
  const text = frame.text.trim();
  const attrNames = Object.keys(frame.attributes);
  if (attrNames.length === 0 && !frame.hasChildren) {
    return text === '' ? '' : coerce(text);
  }
  const value: Record<string, unknown> = {};
  for (const name of attrNames) {
    defineKey(value, `${ATTR_PREFIX}${name}`, frame.attributes[name]);
  }
  for (const [name, child] of Object.entries(frame.children)) {
    defineKey(value, name, child);
  }
  if (text !== '') {
    defineKey(value, TEXT_NODE, coerce(text));
  }
  return value;
}

function addChild(
  children: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  if (!Object.prototype.hasOwnProperty.call(children, name)) {
    defineKey(children, name, value);
    return;
  }
  // Element values are never arrays themselves, so an array here always
  // means "this element name was already repeated".
  const existing = children[name];
  if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    children[name] = [existing, value];
  }
}

/** Own-property assignment that is safe for a `__proto__` element name. */
function defineKey(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function coerce(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (JSON_NUMBER.test(text)) {
    const number = Number(text);
    const isInteger = !/[.eE]/.test(text);
    // Integers beyond 2^53 would silently lose digits — keep them as text.
    if (
      Number.isFinite(number) &&
      (!isInteger || Number.isSafeInteger(number))
    ) {
      return number;
    }
  }
  return text;
}

// ---- IR → XML ----

/** Guarantees a single root element as required by XML. */
function wrapRoot(data: Intermediate): [string, unknown] {
  if (Array.isArray(data)) {
    return ['root', { item: data }];
  }
  if (isRecord(data)) {
    const keys = Object.keys(data);
    if (
      keys.length === 1 &&
      !keys[0].startsWith(ATTR_PREFIX) &&
      keys[0] !== TEXT_NODE
    ) {
      return [keys[0], data[keys[0]]];
    }
  }
  return ['root', data];
}

function* element(
  rawName: string,
  value: unknown,
  indent: string,
): Generator<string> {
  const name = xmlName(rawName);
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* element(rawName, item, indent);
    }
    return;
  }
  if (!isRecord(value)) {
    yield `${indent}<${name}>${escapeText(scalar(value))}</${name}>\n`;
    return;
  }

  let attributes = '';
  let text: string | undefined;
  const children: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith(ATTR_PREFIX) && key.length > ATTR_PREFIX.length) {
      attributes += ` ${xmlName(key.slice(ATTR_PREFIX.length))}="${escapeAttr(scalar(child))}"`;
    } else if (key === TEXT_NODE) {
      text = scalar(child);
    } else {
      children.push([key, child]);
    }
  }

  if (children.length === 0) {
    yield `${indent}<${name}${attributes}>${escapeText(text ?? '')}</${name}>\n`;
    return;
  }
  yield `${indent}<${name}${attributes}>\n`;
  if (text !== undefined && text !== '') {
    yield `${indent}${INDENT}${escapeText(text)}\n`;
  }
  for (const [key, child] of children) {
    yield* element(key, child, indent + INDENT);
  }
  yield `${indent}</${name}>\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  // An object in a text/attribute slot (e.g. `{"@_a": {...}}`) has no XML
  // form of its own — emit it as JSON rather than "[object Object]".
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value as string | number | boolean | bigint);
}

/** Makes an arbitrary key a valid XML element/attribute name. */
function xmlName(key: string): string {
  let name = key.replace(/[^\p{L}\p{N}_.:-]/gu, '_');
  if (!/^[\p{L}_:]/u.test(name)) {
    name = `_${name}`;
  }
  return name;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}
