import { Injectable } from '@nestjs/common';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { FormatCodec, Intermediate } from './format-codec';

const ATTR_PREFIX = '@_';
const TEXT_NODE = '#text';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/**
 * XML codec (XML 1.0) built on fast-xml-parser.
 *
 * Security: a `<!DOCTYPE ...>` is rejected outright, which blocks XML external
 * entity (XXE) injection and entity-expansion ("billion laughs") attacks at the
 * source. fast-xml-parser does not resolve external resources, so no network or
 * file access can be triggered by a document.
 *
 * Mapping rules (documented, implementation-defined):
 *  - XML→JSON: attributes are surfaced as `@_`-prefixed keys; mixed text uses
 *    the `#text` key; repeated elements become arrays.
 *  - JSON→XML: a single-key object is emitted with that key as the root
 *    element; an array or multi-key/primitive value is wrapped in a `<root>`
 *    element (arrays nested under `<item>` entries).
 */
@Injectable()
export class XmlCodec extends FormatCodec {
  readonly format = TextFormat.XML;
  readonly contentType = 'application/xml; charset=utf-8';
  readonly extension = 'xml';

  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    textNodeName: TEXT_NODE,
    processEntities: false,
    parseTagValue: true,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
  });

  private readonly builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    textNodeName: TEXT_NODE,
    format: true,
    processEntities: false,
  });

  parse(input: string): Intermediate {
    if (/<!DOCTYPE/i.test(input)) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        'XML DOCTYPE declarations are not allowed',
      );
    }
    try {
      return this.parser.parse(input, true);
    } catch (err) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid XML: ${(err as Error).message}`,
      );
    }
  }

  serialize(data: Intermediate): string {
    const doc = this.wrapForBuild(data);
    return XML_DECLARATION + String(this.builder.build(doc));
  }

  /** Guarantees a single root element as required by XML. */
  private wrapForBuild(data: Intermediate): Record<string, unknown> {
    if (Array.isArray(data)) {
      return { root: { item: data } };
    }
    if (data !== null && typeof data === 'object') {
      const keys = Object.keys(data as Record<string, unknown>);
      if (keys.length === 1) {
        return data as Record<string, unknown>;
      }
      return { root: data };
    }
    return { root: data };
  }
}
